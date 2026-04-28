// Pure-function tests for the workspace `.gitignore` merge logic
// (codex review iter-4 #917). The runtime files `.session-token`
// and `.server-port` are regenerated on every startup; without
// them in the user's gitignore, every launch dirties the worktree.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextGitignoreContent, REQUIRED_GITIGNORE_LINES } from "../../server/workspace/workspace.js";

describe("nextGitignoreContent", () => {
  it("returns the fresh template when no .gitignore exists", () => {
    const out = nextGitignoreContent(null);
    assert.ok(out !== null);
    for (const line of REQUIRED_GITIGNORE_LINES) {
      assert.ok((out ?? "").includes(line), `expected fresh template to include ${line}`);
    }
  });

  it("returns null when every required line is already present", () => {
    const existing = ["github/", ".session-token", ".server-port", ""].join("\n");
    assert.equal(nextGitignoreContent(existing), null);
  });

  it("appends only the missing lines and preserves user content", () => {
    const userContent = ["# user preferences", "node_modules/", ".session-token", ""].join("\n");
    const out = nextGitignoreContent(userContent);
    assert.ok(out !== null);
    // User-specific entries survive intact.
    assert.ok((out ?? "").includes("node_modules/"));
    assert.ok((out ?? "").includes("# user preferences"));
    // Missing required lines are appended.
    assert.ok((out ?? "").includes(".server-port"));
    assert.ok((out ?? "").includes("github/"));
    // The line that was already present is NOT appended a second time.
    const occurrences = ((out ?? "").match(/\.session-token/g) ?? []).length;
    assert.equal(occurrences, 1, ".session-token should not be duplicated");
  });

  it("treats commented lines as 'not present' so a commented-out entry is restored", () => {
    const existing = ["# .session-token", "github/", ""].join("\n");
    const out = nextGitignoreContent(existing);
    assert.ok(out !== null);
    // The active (non-commented) `.session-token` should be appended.
    assert.match(out ?? "", /^\.session-token$/m);
  });

  it("handles existing content without trailing newline", () => {
    const existing = ".session-token";
    const out = nextGitignoreContent(existing);
    assert.ok(out !== null);
    assert.ok((out ?? "").startsWith(".session-token\n"));
    assert.ok((out ?? "").includes("github/"));
  });
});
