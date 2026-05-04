// End-to-end integration test for the Todo plugin (#1145). Mirrors
// `test_bookmarks_integration.ts`: loads the workspace-built
// `dist/index.js` through the real runtime loader with a real
// `makePluginRuntime`, then exercises both the LLM action path and
// the Vue UI dispatch path against an isolated tmp workspace.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadPluginFromCacheDir } from "../../server/plugins/runtime-loader.js";
import { makePluginRuntime } from "../../server/plugins/runtime.js";
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
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
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
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
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
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
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
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
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

  it("UI path: unknown kind returns a 400 error", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { kind: "no-such-kind" } as never)) as TodoResult;
    assert.ok(res.error);
    assert.equal(res.status, 400);
  });

  it("rejects args with neither `action` nor `kind`", async (ctx) => {
    if (!existsSync(PLUGIN_DIST_INDEX)) {
      ctx.skip("dist not built");
      return;
    }
    const { pubsub } = makeRecordingPubSub();
    const plugin = await loadPluginFromCacheDir(PKG_NAME, VERSION, PLUGIN_DIR, {
      runtimeFactory: (pkgName) => makePluginRuntime({ pkgName, pubsub, locale: "en" }),
    });
    assert.ok(plugin?.execute);
    const res = (await plugin.execute({}, { foo: "bar" } as never)) as TodoResult;
    assert.ok(res.error);
    assert.equal(res.status, 400);
  });
});
