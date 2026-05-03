// Regression tests for the plugin-META aggregator collision helpers.
//
// Aggregators in src/config/* and server/workspace/paths.ts spread
// plugin-owned keys after host-owned keys. Without filtering, a
// plugin would silently shadow a host route / dir / channel; with
// two plugins that both claim the same key, the second silently
// wins. The helpers below detect and drop such keys at module load
// time so server-side diagnostics can warn the user — without
// crashing the app, which is important once user-installed runtime
// plugins land.

import { test } from "node:test";
import assert from "node:assert/strict";

import { findHostPluginCollisions, findIntraPluginCollisions, filterPluginKeys, INTRA_PLUGIN_COLLISIONS } from "../../src/plugins/metas.js";
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

test("findIntraPluginCollisions detects duplicate toolName", () => {
  const first: PluginMeta = { toolName: "manageX" };
  const second: PluginMeta = { toolName: "manageX" };
  const collisions = findIntraPluginCollisions([first, second]);
  assert.equal(collisions.length, 1);
  assert.deepEqual(collisions[0], { dimension: "toolName", key: "manageX", plugins: ["manageX", "manageX"] });
});

test("findIntraPluginCollisions detects duplicate apiRoutesKey across plugins", () => {
  const first: PluginMeta = { toolName: "manageA", apiRoutesKey: "shared", apiRoutes: { dispatch: "/api/a" } };
  const second: PluginMeta = { toolName: "manageB", apiRoutesKey: "shared", apiRoutes: { dispatch: "/api/b" } };
  const collisions = findIntraPluginCollisions([first, second]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.dimension, "apiRoutesKey");
  assert.equal(collisions[0]?.key, "shared");
  assert.deepEqual(collisions[0]?.plugins, ["manageA", "manageB"]);
});

test("findIntraPluginCollisions detects duplicate workspaceDirs key across plugins", () => {
  const first: PluginMeta = { toolName: "manageA", workspaceDirs: { images: "data/a-images" } };
  const second: PluginMeta = { toolName: "manageB", workspaceDirs: { images: "data/b-images" } };
  const collisions = findIntraPluginCollisions([first, second]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.dimension, "workspaceDirs");
  assert.equal(collisions[0]?.key, "images");
});

test("findIntraPluginCollisions detects duplicate staticChannels key across plugins", () => {
  const first: PluginMeta = { toolName: "manageA", staticChannels: { events: "a:events" } };
  const second: PluginMeta = { toolName: "manageB", staticChannels: { events: "b:events" } };
  const collisions = findIntraPluginCollisions([first, second]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0]?.dimension, "staticChannels");
});

test("findIntraPluginCollisions returns empty for the live BUILT_IN_PLUGIN_METAS", () => {
  // The built-ins should never collide. This test pins the contract
  // so a future drift produces a fast, named test failure.
  assert.deepEqual(INTRA_PLUGIN_COLLISIONS, []);
});

// Importing the live aggregators triggers `filterPluginKeys` at
// module load. They should not throw and they should expose empty
// host-collision arrays for the current built-ins.
test("live aggregator modules load without host-vs-plugin collision", async () => {
  const toolNames = await import("../../src/config/toolNames.js");
  const apiRoutes = await import("../../src/config/apiRoutes.js");
  const pubsub = await import("../../src/config/pubsubChannels.js");
  const paths = await import("../../server/workspace/paths.js");
  assert.deepEqual([...toolNames.TOOL_NAMES_HOST_COLLISIONS], []);
  assert.deepEqual([...apiRoutes.API_ROUTES_HOST_COLLISIONS], []);
  assert.deepEqual([...pubsub.PUBSUB_CHANNELS_HOST_COLLISIONS], []);
  assert.deepEqual([...paths.WORKSPACE_DIRS_HOST_COLLISIONS], []);
});
