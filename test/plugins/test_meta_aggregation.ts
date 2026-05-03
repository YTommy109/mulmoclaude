// Regression tests for the plugin-META aggregator collision guard.
// Aggregators in src/config/* and server/workspace/paths.ts spread
// plugin-owned keys after host-owned keys, so without this check a
// plugin could silently shadow a host route / dir / channel.

import { test } from "node:test";
import assert from "node:assert/strict";

import { assertNoPluginCollision } from "../../src/plugins/metas.js";

test("assertNoPluginCollision throws when a plugin key shadows a host key", () => {
  const host = { agent: "/api/agent", roles: "/api/roles" };
  const plugin = { agent: "/api/some-plugin" };
  assert.throws(() => assertNoPluginCollision(host, plugin, "API_ROUTES"), /API_ROUTES.*agent/);
});

test("assertNoPluginCollision lists every colliding key", () => {
  const host = { a: 1, b: 2, c: 3 };
  const plugin = { a: 9, c: 9, d: 9 };
  assert.throws(
    () => assertNoPluginCollision(host, plugin, "TOOL_NAMES"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /a/);
      assert.match(err.message, /c/);
      assert.doesNotMatch(err.message, /\bd\b/);
      return true;
    },
  );
});

test("assertNoPluginCollision is a no-op when there is no overlap", () => {
  const host = { sessions: "sessions", debugBeat: "debug.beat" };
  const plugin = { accountingBooks: "accounting:books" };
  assert.doesNotThrow(() => assertNoPluginCollision(host, plugin, "PUBSUB_CHANNELS"));
});

test("assertNoPluginCollision is a no-op for an empty plugin record", () => {
  const host = { x: 1 };
  assert.doesNotThrow(() => assertNoPluginCollision(host, {}, "WORKSPACE_DIRS"));
});

// Importing the live aggregators triggers `assertNoPluginCollision`
// at module load. If any of these throws, the import itself fails,
// which is the contract — this test pins the contract so a future
// drift produces a fast, named test failure rather than a runtime
// surprise.
test("live aggregator modules load without collision", async () => {
  await assert.doesNotReject(async () => {
    await import("../../src/config/toolNames.js");
    await import("../../src/config/apiRoutes.js");
    await import("../../src/config/pubsubChannels.js");
    await import("../../server/workspace/paths.js");
  });
});
