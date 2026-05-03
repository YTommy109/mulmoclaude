// Tests for `server/plugins/runtime.ts` (#1110).
//
// Covers:
//   - `normalizePluginPath`: POSIX normalisation, Windows backslash
//     repair, traversal rejection, scope-root anchoring.
//   - `sanitisePackageNameForFs`: scoped names produce a single safe
//     directory segment.
//   - `pluginChannelName`: produces the contracted `plugin:<pkg>:<event>`
//     shape (must stay in lockstep with the browser-side helper).
//   - `makePluginRuntime`: scoped pubsub publishes prefixed channels;
//     two plugins on the same host can't see each other's events;
//     `files.data` and `files.config` write into separate roots and
//     reject traversal.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { makePluginRuntime, normalizePluginPath, pluginChannelName, sanitisePackageNameForFs } from "../../server/plugins/runtime.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import type { IPubSub } from "../../server/events/pub-sub/index.js";

// In-memory pubsub double — captures every publish for inspection.
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

describe("normalizePluginPath", () => {
  const root = "/tmp/scope-root";

  it("returns the absolute path for a simple relative file", () => {
    assert.equal(normalizePluginPath(root, "foo.json"), `${root}/foo.json`);
  });

  it("accepts nested POSIX paths", () => {
    assert.equal(normalizePluginPath(root, "books/2026/journal.jsonl"), `${root}/books/2026/journal.jsonl`);
  });

  it("repairs Windows backslash separators", () => {
    // Plugin authors who slip up and use `node:path.join` on Windows
    // get `"books\\2026\\journal.jsonl"`. The platform should still
    // resolve that to a sane POSIX path under the scope root.
    assert.equal(normalizePluginPath(root, "books\\2026\\journal.jsonl"), `${root}/books/2026/journal.jsonl`);
  });

  it("folds redundant `.` and `//` segments", () => {
    assert.equal(normalizePluginPath(root, "./a//b/./c.json"), `${root}/a/b/c.json`);
  });

  it("rejects traversal that escapes the scope root", () => {
    assert.throws(() => normalizePluginPath(root, "../../etc/passwd"), /escapes plugin scope/);
    assert.throws(() => normalizePluginPath(root, "../sibling.json"), /escapes plugin scope/);
  });

  it("rejects encoded traversal mixed with legitimate segments", () => {
    assert.throws(() => normalizePluginPath(root, "books/../../etc/hosts"), /escapes plugin scope/);
  });

  it("treats absolute paths as anchored to scope root (lexical normalisation)", () => {
    // path.posix.resolve(root, "/foo") returns "/foo" — but our
    // ensureInsideBase check then rejects it because /foo is outside
    // the scope root. This protects against plugins that try to bypass
    // by passing absolute paths.
    assert.throws(() => normalizePluginPath(root, "/etc/passwd"), /escapes plugin scope/);
  });
});

describe("sanitisePackageNameForFs", () => {
  it("encodes scoped package names so the path stays one level deep", () => {
    const seg = sanitisePackageNameForFs("@example/bookmarks-plugin");
    // The slash inside the scope must not survive — otherwise readdir
    // on the parent would list `@example/` and the plugin name would
    // span two directory levels.
    assert.ok(!seg.includes("/"), `expected single-segment, got "${seg}"`);
    // And the encoded form must be reversible (so debug output is useful).
    assert.equal(decodeURIComponent(seg), "@example/bookmarks-plugin");
  });

  it("leaves unscoped names untouched (URL-safe characters)", () => {
    assert.equal(sanitisePackageNameForFs("weather"), "weather");
  });
});

describe("pluginChannelName", () => {
  it("produces the contracted format", () => {
    assert.equal(pluginChannelName("@example/foo", "changed"), "plugin:@example/foo:changed");
  });

  it("does not collide between plugins with the same event name", () => {
    const alpha = pluginChannelName("@a/p", "event");
    const beta = pluginChannelName("@b/p", "event");
    assert.notEqual(alpha, beta);
  });
});

describe("makePluginRuntime — scoped pubsub", () => {
  it("prefixes the plugin name on every publish", () => {
    const { pubsub, published } = makeRecordingPubSub();
    const runtime = makePluginRuntime({ pkgName: "@example/foo", pubsub, locale: "en" });
    runtime.pubsub.publish("changed", { id: 1 });
    assert.deepEqual(published, [{ channel: "plugin:@example/foo:changed", data: { id: 1 } }]);
  });

  it("isolates two plugins sharing the same host pubsub", () => {
    const { pubsub, published } = makeRecordingPubSub();
    const alpha = makePluginRuntime({ pkgName: "@a/p", pubsub, locale: "en" });
    const beta = makePluginRuntime({ pkgName: "@b/p", pubsub, locale: "en" });
    alpha.pubsub.publish("event", { from: "a" });
    beta.pubsub.publish("event", { from: "b" });
    assert.deepEqual(published, [
      { channel: "plugin:@a/p:event", data: { from: "a" } },
      { channel: "plugin:@b/p:event", data: { from: "b" } },
    ]);
  });
});

describe("makePluginRuntime — files.data and files.config", () => {
  // Each test creates a fresh fake workspace root so the writes
  // don't pile up.
  let savedDataRoot: string;
  let savedConfigRoot: string;
  let dataRoot: string;
  let configRoot: string;

  beforeEach(() => {
    savedDataRoot = WORKSPACE_PATHS.pluginsData;
    savedConfigRoot = WORKSPACE_PATHS.pluginsConfig;
    dataRoot = mkdtempSync(path.join(tmpdir(), "plugin-runtime-data-"));
    configRoot = mkdtempSync(path.join(tmpdir(), "plugin-runtime-config-"));
    // WORKSPACE_PATHS is a frozen const at import time, so we patch it
    // via Object.defineProperty for the lifetime of the test. The
    // alternative — refactoring `makePluginRuntime` to take roots as
    // arguments — would expose internals plugin authors don't need.
    Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { value: dataRoot, configurable: true });
    Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { value: configRoot, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(WORKSPACE_PATHS, "pluginsData", { value: savedDataRoot, configurable: true });
    Object.defineProperty(WORKSPACE_PATHS, "pluginsConfig", { value: savedConfigRoot, configurable: true });
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configRoot, { recursive: true, force: true });
  });

  function runtimeFor(pkgName: string) {
    const { pubsub } = makeRecordingPubSub();
    return makePluginRuntime({ pkgName, pubsub, locale: "en" });
  }

  it("write+read round-trip lands under files.data root", async () => {
    const runtime = runtimeFor("@example/foo");
    await runtime.files.data.write("state.json", "hello");
    assert.equal(await runtime.files.data.read("state.json"), "hello");
    assert.equal(await runtime.files.data.exists("state.json"), true);
  });

  it("data and config are physically separate roots", async () => {
    const runtime = runtimeFor("@example/foo");
    await runtime.files.data.write("same.json", "data-side");
    await runtime.files.config.write("same.json", "config-side");
    assert.equal(await runtime.files.data.read("same.json"), "data-side");
    assert.equal(await runtime.files.config.read("same.json"), "config-side");
  });

  it("two plugins do not share a directory", async () => {
    const alpha = runtimeFor("@a/p");
    const beta = runtimeFor("@b/p");
    await alpha.files.data.write("state.json", "a-state");
    await beta.files.data.write("state.json", "b-state");
    assert.equal(await alpha.files.data.read("state.json"), "a-state");
    assert.equal(await beta.files.data.read("state.json"), "b-state");
  });

  it("files.exists returns false for never-written paths (no throw)", async () => {
    const runtime = runtimeFor("@example/foo");
    assert.equal(await runtime.files.data.exists("missing.json"), false);
  });

  it("files.unlink is a no-op when the file does not exist", async () => {
    const runtime = runtimeFor("@example/foo");
    await runtime.files.data.unlink("missing.json"); // should not throw
  });

  it("files.readDir returns [] for a plugin that never wrote", async () => {
    const runtime = runtimeFor("@example/foo");
    assert.deepEqual(await runtime.files.data.readDir("."), []);
  });

  it("rejects traversal via files.data.write", async () => {
    const runtime = runtimeFor("@example/foo");
    await assert.rejects(runtime.files.data.write("../../escape.json", "x"), /escapes plugin scope/);
  });

  it("rejects traversal via files.config.read", async () => {
    const runtime = runtimeFor("@example/foo");
    await assert.rejects(runtime.files.config.read("../../escape.json"), /escapes plugin scope/);
  });

  it("accepts Windows-style backslash paths from misuse of node:path", async () => {
    const runtime = runtimeFor("@example/foo");
    // Plugin author uses `path.join("books", "2026", "journal.jsonl")` on Windows.
    await runtime.files.data.write("books\\2026\\journal.jsonl", "winpath");
    // Reads with the POSIX form because that's the contract.
    assert.equal(await runtime.files.data.read("books/2026/journal.jsonl"), "winpath");
  });
});
