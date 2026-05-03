// Regression tests for the plugin-META aggregator collision helpers.
//
// Aggregators in src/config/* and server/workspace/paths.ts merge
// plugin-owned records into host records. Two collision classes:
//
//   1. host-vs-plugin — a plugin's key matches a host's reserved key
//      (e.g. `apiRoutesKey: "agent"`). Filtered + reported by
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

import { findHostPluginCollisions, buildPluginAggregate, filterPluginKeys } from "../../src/plugins/metas.js";
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

test("buildPluginAggregate detects duplicate apiRoutesKey across plugins", () => {
  const first: PluginMeta = { toolName: "manageA", apiRoutesKey: "shared", apiRoutes: { dispatch: "/api/a" } };
  const second: PluginMeta = { toolName: "manageB", apiRoutesKey: "shared", apiRoutes: { dispatch: "/api/b" } };
  const { aggregate, collisions } = buildPluginAggregate(
    [first, second],
    (meta) => (meta.apiRoutes !== undefined ? { [meta.apiRoutesKey ?? meta.toolName]: meta.apiRoutes } : undefined),
    "apiRoutesKey",
  );
  // First plugin wins.
  assert.deepEqual(aggregate.shared, { dispatch: "/api/a" });
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
