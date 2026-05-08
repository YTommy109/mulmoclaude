// End-to-end integration test for the Todo plugin (#1145). Mirrors
// `test_bookmarks_integration.ts`: loads the workspace-built
// `dist/index.js` through the real runtime loader with a real
// `makePluginRuntime`, then exercises both the LLM action path and
// the Vue UI dispatch path against an isolated tmp workspace.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPluginFromCacheDir } from "../../server/plugins/runtime-loader.js";
import { makePluginRuntime } from "../../server/plugins/runtime.js";
import { createTaskManager } from "../../server/events/task-manager/index.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import type { IPubSub } from "../../server/events/pub-sub/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_DIR = path.resolve(__dirname, "../../packages/todo-plugin");
const PLUGIN_DIST_INDEX = path.join(PLUGIN_DIR, "dist", "index.js");

const PKG_NAME = "@mulmoclaude/todo-plugin";
const VERSION = "0.1.0";

function makeRecordingPubSub(): { pubsub: IPubSub; published: { channel: string; data: unknown }[] } {
  const published: { channel: string; data: unknown }[] = [];
  return {
    pubsub: {
      publish(channel, data) {
        published.push({ channel, data });
      },
    },
    published,
  };
}

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  status?: string;
  labels?: string[];
}

interface StatusColumn {
  id: string;
  label: string;
  isDone?: boolean;
}

interface TodoResult {
  ok?: boolean;
  data?: { items?: TodoItem[]; columns?: StatusColumn[] };
  item?: TodoItem;
  message?: string;
  error?: string;
  status?: number;
}

describe("Todo plugin — end-to-end through the loader", () => {
  before(() => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      console.warn(`[todo integration] skipping: ${PLUGIN_DIST_INDEX} not built — run \`yarn build\` in packages/todo-plugin/`);
    }
  });

  let savedDataDescriptor: PropertyDescriptor | undefined;
  let savedConfigDescriptor: PropertyDescriptor | undefined;
  let dataRoot: string;
  let configRoot: string;

  beforeEach(() => {
    savedDataDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsData");
    savedConfigDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "pluginsConfig");
    dataRoot = mkdtempSync(path.join(tmpdir(), "todo-int-data-"));
    configRoot = mkdtempSync(path.join(tmpdir(), "todo-int-config-"));
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { ...savedDataDescriptor, value: dataRoot });
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { ...savedConfigDescriptor, value: configRoot });
  });

  afterEach(() => {
    if (savedDataDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsData", savedDataDescriptor);
    if (savedConfigDescriptor) Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", savedConfigDescriptor);
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configRoot, { recursive: true, force: true });
  });

  it("LLM path: add → show, persists to data root, publishes scoped events", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin, "plugin should load");
    assert.equal(plugin.definition.name, "manageTodoList");
    assert.ok(plugin.execute);

    // 1. show on empty workspace returns no items, no publish (read-only).
    let res = (await plugin.execute({}, { action: "show" })) as TodoResult;
    assert.equal(res.error, undefined, `show should not error: ${res.error}`);
    assert.equal(res.data?.items?.length ?? 0, 0);
    assert.equal(published.length, 0, "show is read-only and must not publish");

    // 2. add an item — should publish "changed" with reason llm-action.
    res = (await plugin.execute({}, { action: "add", text: "Write integration test" })) as TodoResult;
    assert.equal(res.error, undefined);
    assert.equal(res.data?.items?.length, 1);
    assert.equal(res.data?.items?.[0]?.text, "Write integration test");
    assert.equal(published.length, 1);
    assert.equal(published[0].channel, `plugin:${PKG_NAME}:changed`);
    assert.deepEqual(published[0].data, { reason: "llm-action", action: "add" });

    // 3. data file lands under the data root, not config.
    const sanitisedSeg = encodeURIComponent(PKG_NAME);
    const expectedDataFile = path.join(dataRoot, sanitisedSeg, "todos.json");
    assert.ok(existsSync(expectedDataFile), `expected ${expectedDataFile} to exist`);
    const expectedConfigFile = path.join(configRoot, sanitisedSeg, "todos.json");
    assert.ok(!existsSync(expectedConfigFile), "todos must not leak into the config root");
  });

  it("UI path: listAll seeds default columns on an empty workspace", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { kind: "listAll" })) as TodoResult;
    assert.equal(res.data?.items?.length ?? 0, 0);
    assert.ok((res.data?.columns?.length ?? 0) > 0, "listAll must return seeded default columns on empty workspace");
    assert.equal(published.length, 0, "listAll is read-only and must not publish");
  });

  it("UI path: itemCreate → itemPatch → itemDelete each publishes a scoped 'changed' event", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    let res = (await plugin.execute({}, { kind: "itemCreate", text: "Task 1" })) as TodoResult;
    const itemId = res.data?.items?.[0]?.id;
    assert.ok(itemId, "itemCreate must return an id");
    assert.equal(published[published.length - 1].channel, `plugin:${PKG_NAME}:changed`);
    assert.deepEqual(published[published.length - 1].data, { reason: "item-create" });

    res = (await plugin.execute({}, { kind: "itemPatch", id: itemId, text: "Task 1 (renamed)" })) as TodoResult;
    assert.equal(res.data?.items?.[0]?.text, "Task 1 (renamed)");
    assert.deepEqual(published[published.length - 1].data, { reason: "item-patch", id: itemId });

    res = (await plugin.execute({}, { kind: "itemDelete", id: itemId })) as TodoResult;
    assert.equal(res.data?.items?.length, 0);
    assert.deepEqual(published[published.length - 1].data, { reason: "item-delete", id: itemId });
  });

  it("UI path: columnsAdd appends to the seeded defaults and publishes 'column-add'", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const initial = (await plugin.execute({}, { kind: "listAll" })) as TodoResult;
    const initialLen = initial.data?.columns?.length ?? 0;
    const res = (await plugin.execute({}, { kind: "columnsAdd", label: "Review" })) as TodoResult;
    assert.equal(res.data?.columns?.length, initialLen + 1);
    assert.ok(
      res.data?.columns?.some((column) => column.label === "Review"),
      "added column should appear in the list",
    );
    assert.deepEqual(published[published.length - 1].data, { reason: "column-add" });
  });

  it("UI path: itemMove changes status and flips `completed` when moved into the done column", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Move me" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    const moved = (await plugin.execute({}, { kind: "itemMove", id: itemId, status: "done", position: 0 })) as TodoResult;
    assert.equal(moved.data?.items?.[0]?.status, "done");
    assert.equal(moved.data?.items?.[0]?.completed, true);
    assert.deepEqual(published[published.length - 1].data, { reason: "item-move", id: itemId });
  });

  it("UI path: itemMove clamps an out-of-range position rather than erroring", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Drag me" })) as TodoResult;
    const itemId = created.data?.items?.[0]?.id;
    assert.ok(itemId);
    const clamped = (await plugin.execute({}, { kind: "itemMove", id: itemId, status: "done", position: 9999 })) as TodoResult;
    assert.equal(clamped.error, undefined);
    assert.equal(clamped.data?.items?.find((entry) => entry.id === itemId)?.status, "done");
  });

  it("UI path: itemMove with an unknown id returns 404", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const missing = (await plugin.execute({}, { kind: "itemMove", id: "does-not-exist", status: "done" })) as TodoResult;
    assert.ok(missing.error);
    assert.equal(missing.status, 404);
  });

  it("UI path: columnPatch renames a column and publishes 'column-patch'", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { kind: "columnPatch", id: "todo", label: "Doing" })) as TodoResult;
    assert.equal(res.error, undefined);
    assert.equal(res.data?.columns?.find((column) => column.id === "todo")?.label, "Doing");
    assert.deepEqual(published[published.length - 1].data, { reason: "column-patch", id: "todo" });

    const missing = (await plugin.execute({}, { kind: "columnPatch", id: "ghost", label: "x" })) as TodoResult;
    assert.ok(missing.error);
    assert.equal(missing.status, 404);
  });

  it("UI path: columnDelete migrates orphaned items into a refuge column and publishes 'column-delete'", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    const created = (await plugin.execute({}, { kind: "itemCreate", text: "Stranded", status: "backlog" })) as TodoResult;
    const itemId = created.data?.items?.find((entry) => entry.text === "Stranded")?.id;
    assert.ok(itemId);

    const removed = (await plugin.execute({}, { kind: "columnDelete", id: "backlog" })) as TodoResult;
    assert.equal(removed.error, undefined);
    assert.equal(
      removed.data?.columns?.some((column) => column.id === "backlog"),
      false,
    );
    assert.notEqual(removed.data?.items?.find((entry) => entry.id === itemId)?.status, "backlog");
    assert.deepEqual(published[published.length - 1].data, { reason: "column-delete", id: "backlog" });
  });

  it("UI path: columnDelete refuses to delete the last remaining column", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    await plugin.execute({}, { kind: "columnDelete", id: "backlog" });
    await plugin.execute({}, { kind: "columnDelete", id: "todo" });
    await plugin.execute({}, { kind: "columnDelete", id: "in-progress" });
    const refused = (await plugin.execute({}, { kind: "columnDelete", id: "done" })) as TodoResult;
    assert.ok(refused.error);
    assert.equal(refused.status, 400);
  });

  it("UI path: columnsOrder validates the id set and applies the new order", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub, published } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    // Reverse the four default columns.
    const reversed = ["done", "in-progress", "todo", "backlog"];
    const res = (await plugin.execute({}, { kind: "columnsOrder", ids: reversed })) as TodoResult;
    assert.equal(res.error, undefined);
    assert.deepEqual(
      res.data?.columns?.map((column) => column.id),
      reversed,
    );
    assert.deepEqual(published[published.length - 1].data, { reason: "columns-order" });

    // Mismatched id set → 400 (handler enforces a permutation).
    const bad = (await plugin.execute({}, { kind: "columnsOrder", ids: ["todo", "backlog"] })) as TodoResult;
    assert.ok(bad.error);
    assert.equal(bad.status, 400);
  });

  it("UI path: unknown kind returns a 400 error", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { kind: "no-such-kind" } as never)) as TodoResult;
    assert.ok(res.error);
    assert.equal(res.status, 400);
  });

  it("Robustness: id-based UI patch mutates the right row when two items share a text prefix", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Pre-#1145 the View dispatched LLM-style `{ action: "update",
    // text: "..." }` calls that resolved by case-insensitive
    // substring match — two todos sharing a prefix would clobber
    // each other. The migrated View now uses `{ kind: "itemPatch",
    // id: ... }`, which the `handlePatch` handler resolves by
    // exact id. Pin that contract so a future regression to text-
    // based dispatch shows up here. Codex review iter on PR #1149.
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    const first = (await plugin.execute({}, { kind: "itemCreate", text: "Buy milk" })) as TodoResult;
    const second = (await plugin.execute({}, { kind: "itemCreate", text: "Buy milk and bread" })) as TodoResult;
    const idA = first.data?.items?.find((entry) => entry.text === "Buy milk")?.id;
    const idB = second.data?.items?.find((entry) => entry.text === "Buy milk and bread")?.id;
    assert.ok(idA);
    assert.ok(idB);
    assert.notEqual(idA, idB);

    // Patch only the second one. With a substring text match against
    // "Buy milk" the first one would also flip; with id-based dispatch
    // only the targeted row mutates.
    const patched = (await plugin.execute({}, { kind: "itemPatch", id: idB, completed: true })) as TodoResult;
    assert.equal(patched.data?.items?.find((entry) => entry.id === idA)?.completed, false, "first item must remain unchanged");
    assert.equal(patched.data?.items?.find((entry) => entry.id === idB)?.completed, true, "targeted item flipped");
  });

  it("Robustness: a malformed todos.json (object instead of array) degrades to an empty list", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Pre-fix, `loadTodos` would call `migrateItems({}, columns)`
    // which calls `rawItems.map(...)` on a non-array and TypeError-
    // outs, taking every dispatch with it. Codex review iter on PR
    // #1149.
    const sanitisedSeg = encodeURIComponent(PKG_NAME);
    const scopeDir = path.join(dataRoot, sanitisedSeg);
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(path.join(scopeDir, "todos.json"), JSON.stringify({ this: "is not an array" }));

    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    const empty = (await plugin.execute({}, { kind: "listAll" })) as TodoResult;
    assert.equal(empty.error, undefined, "dispatch must not throw on a non-array todos.json");
    assert.equal(empty.data?.items?.length ?? 0, 0);
  });

  it("Robustness: an array with mixed valid + garbage entries filters to just the well-formed ones", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    // Item-level filter: drops anything that doesn't carry
    // {id, text, completed, createdAt} in the right primitive types.
    const sanitisedSeg = encodeURIComponent(PKG_NAME);
    const scopeDir = path.join(dataRoot, sanitisedSeg);
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      path.join(scopeDir, "todos.json"),
      JSON.stringify([{ id: "good", text: "valid", completed: false, createdAt: 1 }, { not: "a todo item" }, "string item is not a todo either", null]),
    );

    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);

    const listed = (await plugin.execute({}, { kind: "listAll" })) as TodoResult;
    assert.equal(listed.error, undefined, "dispatch must not throw on a partly-corrupt array");
    assert.equal(listed.data?.items?.length, 1, "only the well-formed entry should survive");
    assert.equal(listed.data?.items?.[0]?.id, "good");
  });

  it("rejects args with neither `action` nor `kind`", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en", taskManager: createTaskManager() }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { foo: "bar" } as never)) as TodoResult;
    assert.ok(res.error);
    assert.equal(res.status, 400);
  });
});
