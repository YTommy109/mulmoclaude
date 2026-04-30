// Unit tests for runMemoryMigrationOnce's idempotency guards
// (#1029 PR-B). The Claude CLI summarize callback is not exercised
// here — these tests verify that the runner short-circuits in the
// states where re-running would cause harm:
//   - no legacy file
//   - legacy file too small to be real (placeholder threshold)
//   - typed dir already populated (post-migration / hand-edited)

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runMemoryMigrationOnce } from "../../../server/workspace/memory/run.js";

describe("memory/run — idempotency guards", () => {
  let scoped: string;

  before(async () => {
    scoped = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mem-run-"));
  });

  after(async () => {
    await rm(scoped, { recursive: true, force: true });
  });

  it("is a no-op when there is no legacy memory.md", async () => {
    await runMemoryMigrationOnce(scoped);
    // No legacy, no migration: nothing got written, no exception.
    const legacy = await stat(path.join(scoped, "conversations", "memory.md")).catch(() => null);
    const backup = await stat(path.join(scoped, "conversations", "memory.md.backup")).catch(() => null);
    assert.equal(legacy, null);
    assert.equal(backup, null);
  });

  it("is a no-op when the legacy file is below the placeholder threshold", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mem-run-tiny-"));
    try {
      const legacyPath = path.join(fresh, "conversations", "memory.md");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      // Below 64 bytes — looks like the historical placeholder.
      await writeFile(legacyPath, "# Memory\n", "utf-8");

      await runMemoryMigrationOnce(fresh);

      // Legacy file untouched (no rename to .backup).
      const legacy = await stat(legacyPath);
      assert.ok(legacy.isFile(), "tiny legacy file should be left in place");
      const backup = await stat(`${legacyPath}.backup`).catch(() => null);
      assert.equal(backup, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("is a no-op when typed entries are already present (post-migration / hand-edited)", async () => {
    // The legacy file is large enough to pass the placeholder
    // threshold, but the typed dir already has an entry — so the
    // workspace is already post-migration (or the user has been
    // editing typed entries directly). Re-classifying the legacy
    // bullets here would create duplicates.
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mem-run-postmig-"));
    try {
      const legacyPath = path.join(fresh, "conversations", "memory.md");
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, ["# Memory", "", "## Preferences", "- yarn を使う", "- Emacs", "## Travel", "- planning Egypt", ""].join("\n"), "utf-8");

      const memDir = path.join(fresh, "conversations", "memory");
      await mkdir(memDir, { recursive: true });
      await writeFile(path.join(memDir, "preference_yarn.md"), "---\nname: yarn を使う\ndescription: npm 不可\ntype: preference\n---\n\nyarn 固定\n", "utf-8");

      await runMemoryMigrationOnce(fresh);

      // Legacy file must NOT have been renamed to .backup — that
      // signals migration ran. The skip path leaves it alone.
      const legacy = await readFile(legacyPath, "utf-8");
      assert.match(legacy, /yarn を使う/, "legacy file should be left in place verbatim");
      const backup = await stat(`${legacyPath}.backup`).catch(() => null);
      assert.equal(backup, null, "skip path should not produce a backup");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
