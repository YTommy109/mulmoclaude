// Regression tests for the plugin-META aggregator collision helpers.
//
// Aggregators in src/config/* and server/workspace/paths.ts merge
// plugin-owned records into host records. Two collision classes:
//
//   1. host-vs-plugin — a plugin's key matches a host's reserved key
//      (e.g. `apiNamespace: "agent"`). Filtered + reported by
//      `filterPluginKeys` AFTER the cross-plugin merge.
//   2. plugin-vs-plugin — two plugins claim the same key in the same
//      dimension. Detected DURING the merge by `buildPluginAggregate`
//      (first-write-wins). Codex iter-3+ on PR #1125 caught that
//      pre-buildPluginAggregate this was last-write-wins via
//      `Object.fromEntries` / `Object.assign`, with the diagnostic
//      message contradicting actual runtime — these tests pin the
//      first-write-wins contract.

import { test } from "node:test";
import assert from "node:assert/strict";

import { findHostPluginCollisions, buildPluginAggregate, filterPluginKeys, BUILT_IN_PLUGIN_METAS } from "../../src/plugins/metas.js";
import { BUILT_IN_SERVER_BINDINGS } from "../../src/plugins/server.js";
import type { PluginMeta } from "../../src/plugins/meta-types.js";

test("findHostPluginCollisions returns colliding keys", () => {
  const host = { agent: "/api/agent", roles: "/api/roles" };
  const plugin = { agent: "/api/some-plugin", brand: "/api/brand" };
  assert.deepEqual(findHostPluginCollisions(host, plugin), ["agent"]);
});

test("findHostPluginCollisions is empty when records are disjoint", () => {
  const host = { sessions: "sessions" };
  const plugin = { accountingBooks: "accounting:books" };
  assert.deepEqual(findHostPluginCollisions(host, plugin), []);
});

test("filterPluginKeys drops host-colliding keys and reports them attributed", () => {
  const hostKeys = new Set(["agent", "roles"]);
  const plugin = { agent: "x", brand: "y" };
  const owner = { agent: "manageX", brand: "manageY" };
  const { cleaned, dropped } = filterPluginKeys("API_ROUTES", hostKeys, plugin, owner);
  assert.deepEqual(cleaned, { brand: "y" });
  assert.deepEqual(dropped, [{ label: "API_ROUTES", key: "agent", plugin: "manageX" }]);
});

test("filterPluginKeys is a pass-through when there is no collision", () => {
  const hostKeys = new Set(["x"]);
  const plugin = { yyy: 1, zzz: 2 };
  const owner = { yyy: "a", zzz: "a" };
  const { cleaned, dropped } = filterPluginKeys("LBL", hostKeys, plugin, owner);
  assert.deepEqual(cleaned, plugin);
  assert.deepEqual(dropped, []);
});

test("buildPluginAggregate is first-write-wins on duplicate keys", () => {
  const first: PluginMeta = { toolName: "manageA", workspaceDirs: { shared: "data/a-shared", aOnly: "data/a-only" } };
  const second: PluginMeta = { toolName: "manageB", workspaceDirs: { shared: "data/b-shared", bOnly: "data/b-only" } };
  const { aggregate, owner, collisions } = buildPluginAggregate([first, second], (meta) => meta.workspaceDirs, "workspaceDirs");
  // First plugin's value wins.
  assert.equal(aggregate.shared, "data/a-shared");
  assert.equal(aggregate.aOnly, "data/a-only");
  assert.equal(aggregate.bOnly, "data/b-only");
  // Owner reflects first-write.
  assert.equal(owner.shared, "manageA");
  // Collision lists the second offender.
  assert.equal(collisions.length, 1);
  assert.deepEqual(collisions[0], { dimension: "workspaceDirs", key: "shared", plugins: ["manageA", "manageB"] });
});

test("buildPluginAggregate detects duplicate apiNamespace across plugins", () => {
  const dispatch = { method: "POST", path: "" } as const;
  const first: PluginMeta = { toolName: "manageA", apiNamespace: "shared", apiRoutes: { dispatch } };
  const second: PluginMeta = { toolName: "manageB", apiNamespace: "shared", apiRoutes: { dispatch } };
  const { aggregate, collisions } = buildPluginAggregate(
    [first, second],
    (meta) => (meta.apiRoutes !== undefined ? { [meta.apiNamespace ?? meta.toolName]: meta.apiRoutes } : undefined),
    "apiNamespace",
  );
  // First plugin wins.
  assert.deepEqual(aggregate.shared, { dispatch });
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.key, "shared");
  assert.deepEqual(collisions[0]?.plugins, ["manageA", "manageB"]);
});

test("buildPluginAggregate is empty / collision-free for disjoint plugin records", () => {
  const first: PluginMeta = { toolName: "manageA", staticChannels: { aChan: "a:chan" } };
  const second: PluginMeta = { toolName: "manageB", staticChannels: { bChan: "b:chan" } };
  const { aggregate, owner, collisions } = buildPluginAggregate([first, second], (meta) => meta.staticChannels, "staticChannels");
  assert.deepEqual(aggregate, { aChan: "a:chan", bChan: "b:chan" });
  assert.deepEqual(owner, { aChan: "manageA", bChan: "manageB" });
  assert.deepEqual(collisions, []);
});

test("buildPluginAggregate skips plugins where extract returns undefined", () => {
  const withDirs: PluginMeta = { toolName: "manageA", workspaceDirs: { x: "data/x" } };
  const withoutDirs: PluginMeta = { toolName: "manageB" };
  const { aggregate, collisions } = buildPluginAggregate([withoutDirs, withDirs, withoutDirs], (meta) => meta.workspaceDirs, "workspaceDirs");
  assert.deepEqual(aggregate, { x: "data/x" });
  assert.deepEqual(collisions, []);
});

// Sync-invariant (one-way): every BUILT_IN_SERVER_BINDINGS entry
// for a *built-in* plugin must have a matching META in
// `BUILT_IN_PLUGIN_METAS`. Catches the "I added an MCP binding but
// forgot the META" footgun.
//
// Two directions intentionally NOT asserted:
//   - META → binding: GUI-only / deprecated plugins (wiki — MCP tool
//     removed #963 but the plugin entry stays for legacy chat replay)
//     have META without binding.
//   - external-package binding → META: plugins shipped as npm
//     packages (createMindMap from @gui-chat-plugin/mindmap, etc.)
//     are registered in BUILT_IN_SERVER_BINDINGS without a local
//     meta.ts because they aren't co-located in this source tree.
const EXTERNAL_PACKAGE_TOOL_NAMES = new Set(["createMindMap", "putQuestions", "present3D"]);

test("every built-in BUILT_IN_SERVER_BINDINGS entry has a matching toolName in BUILT_IN_PLUGIN_METAS", () => {
  const metaToolNames: ReadonlySet<string> = new Set(BUILT_IN_PLUGIN_METAS.map((meta) => meta.toolName));
  for (const binding of BUILT_IN_SERVER_BINDINGS) {
    if (EXTERNAL_PACKAGE_TOOL_NAMES.has(binding.def.name)) continue;
    assert.ok(
      metaToolNames.has(binding.def.name),
      `BUILT_IN_SERVER_BINDINGS row for "${binding.def.name}" has no matching META in BUILT_IN_PLUGIN_METAS. ` +
        `Either add the plugin's META to src/plugins/metas.ts, or drop the row from BUILT_IN_SERVER_BINDINGS.`,
    );
  }
});

test("apiNamespace defaults to toolName when omitted from META", () => {
  // Synthetic plugin without `apiNamespace` — the aggregator should
  // key it under `toolName`. This pins the documented default in
  // `src/plugins/meta-types.ts#PluginMeta.apiNamespace` so a future
  // refactor can't silently drop the fallback.
  const dispatch = { method: "POST", path: "" } as const;
  const meta: PluginMeta = {
    toolName: "manageWidget",
    apiRoutes: { dispatch },
  };
  const { aggregate } = buildPluginAggregate(
    [meta],
    (entry) => (entry.apiRoutes !== undefined ? { [entry.apiNamespace ?? entry.toolName]: entry.apiRoutes } : undefined),
    "apiNamespace",
  );
  assert.deepEqual(aggregate, { manageWidget: { dispatch } });
});

// Importing the live aggregators triggers `filterPluginKeys` +
// `buildPluginAggregate` at module load. They should not throw and
// the current built-in plugins should produce empty collision arrays.
test("live aggregator modules load without host-vs-plugin or intra-plugin collisions", async () => {
  const toolNames = await import("../../src/config/toolNames.js");
  const apiRoutes = await import("../../src/config/apiRoutes.js");
  const pubsub = await import("../../src/config/pubsubChannels.js");
  const paths = await import("../../server/workspace/paths.js");
  // Host-vs-plugin
  assert.deepEqual([...toolNames.TOOL_NAMES_HOST_COLLISIONS], []);
  assert.deepEqual([...apiRoutes.API_ROUTES_HOST_COLLISIONS], []);
  assert.deepEqual([...pubsub.PUBSUB_CHANNELS_HOST_COLLISIONS], []);
  assert.deepEqual([...paths.WORKSPACE_DIRS_HOST_COLLISIONS], []);
  // Intra-plugin
  assert.deepEqual([...toolNames.TOOL_NAMES_INTRA_COLLISIONS], []);
  assert.deepEqual([...apiRoutes.API_ROUTES_INTRA_COLLISIONS], []);
  assert.deepEqual([...pubsub.PUBSUB_CHANNELS_INTRA_COLLISIONS], []);
  assert.deepEqual([...paths.WORKSPACE_DIRS_INTRA_COLLISIONS], []);
});
