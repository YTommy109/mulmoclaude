// Pin the role-editor visibility contract for runtime plugins:
// every plugin returned by `/api/plugins/runtime/list` MUST surface
// in `getRuntimeToolNames()` regardless of whether the package
// ships a `dist/vue.js` bundle. Server-only plugins (no canvas
// surface — edgar is the reference case) used to disappear from
// the role-editor picker because the loader bailed out the moment
// the dynamic import failed; that's fixed by registering a
// listing-derived fallback before attempting the import.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { _resetRuntimeRegistryForTest, getRuntimePluginEntry, getRuntimeToolNames, loadOne } from "../../src/tools/runtimeLoader";

beforeEach(() => _resetRuntimeRegistryForTest());
afterEach(() => _resetRuntimeRegistryForTest());

describe("runtimeLoader.loadOne — fallback registration", () => {
  it("registers a fallback entry SYNCHRONOUSLY before the import resolves", () => {
    // The body up to the first `await` runs synchronously, so the
    // registry must contain the fallback the moment loadOne is
    // called — even if the import never resolves.
    void loadOne({
      name: "@fixture/server-only",
      version: "1.0.0",
      toolName: "myFakeTool",
      description: "fixture description",
      assetBase: "http://127.0.0.1:1/nowhere",
    });
    const entry = getRuntimePluginEntry("myFakeTool");
    assert.ok(entry, "fallback entry should be registered before any await");
    assert.equal(entry?.toolDefinition.name, "myFakeTool");
    assert.equal(entry?.toolDefinition.description, "fixture description");
    assert.equal(entry?.viewComponent, undefined, "no Vue View on the fallback");
    assert.equal(entry?.previewComponent, undefined, "no Vue Preview on the fallback");
  });

  it("fallback survives when the dynamic import fails (server-only plugin path)", async () => {
    // assetBase points to an unreachable URL; the dynamic import
    // throws; the fallback registered synchronously must remain.
    await loadOne({
      name: "@fixture/server-only",
      version: "1.0.0",
      toolName: "edgarLike",
      description: "server-only plugin",
      assetBase: "http://127.0.0.1:1/nowhere",
    });
    const names = getRuntimeToolNames();
    assert.ok(names.includes("edgarLike"), `expected "edgarLike" in registry; got: ${JSON.stringify(names)}`);
    const entry = getRuntimePluginEntry("edgarLike");
    assert.ok(entry, "registry entry must persist after the failed import");
    assert.equal(entry?.toolDefinition.description, "server-only plugin");
  });

  it("multiple server-only plugins all surface in getRuntimeToolNames", async () => {
    // Replays the production case where several runtime plugins
    // are loaded in parallel — each fallback must end up in the
    // registry even though the imports all fail.
    await Promise.all([
      loadOne({ name: "@x/a", version: "1.0.0", toolName: "toolA", description: "A", assetBase: "http://127.0.0.1:1/a" }),
      loadOne({ name: "@x/b", version: "1.0.0", toolName: "toolB", description: "B", assetBase: "http://127.0.0.1:1/b" }),
      loadOne({ name: "@x/c", version: "1.0.0", toolName: "toolC", description: "C", assetBase: "http://127.0.0.1:1/c" }),
    ]);
    const names = getRuntimeToolNames();
    for (const expected of ["toolA", "toolB", "toolC"]) {
      assert.ok(names.includes(expected), `${expected} missing from registry: ${JSON.stringify(names)}`);
    }
  });
});
