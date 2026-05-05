// Tests for `server/utils/dev-plugin-args.mjs` — the shared
// `--dev-plugin` parser used by the npm launcher
// (`packages/mulmoclaude/bin/mulmoclaude.js`).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { parseDevPluginArgs } from "../../server/utils/dev-plugin-args.mjs";

describe("parseDevPluginArgs — extraction", () => {
  it("returns no resolved entries when --dev-plugin is absent", () => {
    const result = parseDevPluginArgs(["--port", "3001", "--no-open"], "/tmp");
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.resolved, []);
  });

  it("extracts a single occurrence with the verbatim raw input + abs path", () => {
    const result = parseDevPluginArgs(["--dev-plugin", "/abs/foo"], "/tmp");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resolved.length, 1);
      assert.equal(result.resolved[0].rawInput, "/abs/foo");
      assert.equal(result.resolved[0].absPath, "/abs/foo");
    }
  });

  it("preserves multiple occurrences in argv order", () => {
    const result = parseDevPluginArgs(["--dev-plugin", "/abs/a", "--port", "3001", "--dev-plugin", "/abs/b"], "/tmp");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resolved.length, 2);
      assert.equal(result.resolved[0].rawInput, "/abs/a");
      assert.equal(result.resolved[1].rawInput, "/abs/b");
    }
  });

  it("ignores unrelated flags interleaved with --dev-plugin", () => {
    const result = parseDevPluginArgs(["--port", "3097", "--dev-plugin", "/abs/p", "--no-open"], "/tmp");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resolved.length, 1);
      assert.equal(result.resolved[0].absPath, "/abs/p");
    }
  });
});

describe("parseDevPluginArgs — path resolution", () => {
  it("resolves relative paths against the supplied cwd", () => {
    const cwd = "/Users/dev/project";
    const result = parseDevPluginArgs(["--dev-plugin", "./my-plugin"], cwd);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resolved[0].rawInput, "./my-plugin");
      assert.equal(result.resolved[0].absPath, path.join(cwd, "my-plugin"));
    }
  });

  it("resolves bare names against cwd (typo-protection: ../foo, foo, etc.)", () => {
    const cwd = "/Users/dev/project";
    const result = parseDevPluginArgs(["--dev-plugin", "../sibling"], cwd);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.resolved[0].absPath, path.resolve(cwd, "../sibling"));
    }
  });

  it("leaves absolute paths unchanged regardless of cwd", () => {
    const result = parseDevPluginArgs(["--dev-plugin", "/elsewhere/x"], "/Users/somewhere/else");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.resolved[0].absPath, "/elsewhere/x");
  });
});

describe("parseDevPluginArgs — error paths", () => {
  it("rejects --dev-plugin at end of argv", () => {
    const result = parseDevPluginArgs(["--port", "3001", "--dev-plugin"], "/tmp");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /requires a path argument/);
  });

  it("rejects --dev-plugin followed by another flag", () => {
    // `--dev-plugin --no-open` is a typo for `--dev-plugin <path>`;
    // catching it early prevents loading "--no-open" as a plugin path.
    const result = parseDevPluginArgs(["--dev-plugin", "--no-open"], "/tmp");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /requires a path argument/);
  });

  it("first invalid occurrence wins — does NOT silently accumulate later valid ones", () => {
    // Pre-empts a future refactor that would skip the bad flag and
    // continue. We bail eagerly so the user sees the typo before
    // mulmoclaude boots half-configured.
    const result = parseDevPluginArgs(["--dev-plugin", "--bogus", "--dev-plugin", "/abs/ok"], "/tmp");
    assert.equal(result.ok, false);
  });
});
