// Unit tests for the new wiki-pages choke-point write helper
// (#763 PR 1). The actual snapshot pipeline is no-op in PR 1 so the
// behaviours we lock in are:
//
//   - reads/writes hit the right path under the workspace root
//   - read returns null for missing files (no throw)
//   - writes are atomic (no leftover .tmp files after success)
//   - classifyAsWikiPage routes the generic file PUT correctly,
//     including refusing nested / non-md / outside-root paths

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { classifyAsWikiPage, readWikiPage, wikiPagePath, writeWikiPage } from "../../../server/workspace/wiki-pages/io.js";
import { WORKSPACE_DIRS } from "../../../server/workspace/paths.js";

describe("wiki-pages/io — wikiPagePath", () => {
  it("composes data/wiki/pages/<slug>.md under the given workspaceRoot", () => {
    const root = "/tmp/ws-test";
    const out = wikiPagePath("my-page", { workspaceRoot: root });
    // path.join collapses redundant separators and uses the platform
    // separator. Compare via path.normalize on both sides for
    // cross-platform safety.
    const expected = path.join(root, WORKSPACE_DIRS.wikiPages, "my-page.md");
    assert.equal(out, expected);
  });
});

describe("wiki-pages/io — readWikiPage", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "wiki-pages-read-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("returns the file content when the page exists", async () => {
    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    await mkdir(pagesDir, { recursive: true });
    await writeFile(path.join(pagesDir, "topic.md"), "# Topic\n\nbody\n", "utf-8");

    const out = await readWikiPage("topic", { workspaceRoot });
    assert.equal(out, "# Topic\n\nbody\n");
  });

  it("returns null when the page does not exist (no throw)", async () => {
    const out = await readWikiPage("nonexistent", { workspaceRoot });
    assert.equal(out, null);
  });
});

describe("wiki-pages/io — writeWikiPage", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "wiki-pages-write-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("creates a new page when none exists", async () => {
    await writeWikiPage("brand-new", "# Brand New\n\nfresh\n", { editor: "user" }, { workspaceRoot });

    const fileContent = await readFile(wikiPagePath("brand-new", { workspaceRoot }), "utf-8");
    assert.equal(fileContent, "# Brand New\n\nfresh\n");
  });

  it("overwrites an existing page", async () => {
    await writeWikiPage("topic-x", "v1\n", { editor: "user" }, { workspaceRoot });
    await writeWikiPage("topic-x", "v2\n", { editor: "user" }, { workspaceRoot });

    const fileContent = await readFile(wikiPagePath("topic-x", { workspaceRoot }), "utf-8");
    assert.equal(fileContent, "v2\n");
  });

  it("does not leave a .tmp staging file after a successful write", async () => {
    await writeWikiPage("clean", "content\n", { editor: "user" }, { workspaceRoot });

    const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);
    const entries = await readdir(pagesDir);
    const stragglers = entries.filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(stragglers, []);
  });

  it("accepts every editor identity without distinction (PR 1 no-op)", async () => {
    // PR 1 only consolidates the wiring; the snapshot stub is a
    // no-op regardless of editor. PR 2 will introduce semantics.
    await writeWikiPage("by-llm", "llm content\n", { editor: "llm", sessionId: "s1" }, { workspaceRoot });
    await writeWikiPage("by-system", "system content\n", { editor: "system", sessionId: "s2" }, { workspaceRoot });

    assert.equal(await readWikiPage("by-llm", { workspaceRoot }), "llm content\n");
    assert.equal(await readWikiPage("by-system", { workspaceRoot }), "system content\n");
  });
});

describe("wiki-pages/io — classifyAsWikiPage", () => {
  const root = "/tmp/ws-classify";
  const pagesDir = path.join(root, WORKSPACE_DIRS.wikiPages);

  it("classifies a direct child .md as wiki", () => {
    const out = classifyAsWikiPage(path.join(pagesDir, "foo.md"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: true, slug: "foo" });
  });

  it("rejects index.md (lives one level above pages/)", () => {
    const out = classifyAsWikiPage(path.join(root, "data", "wiki", "index.md"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects non-md files inside pages/", () => {
    const out = classifyAsWikiPage(path.join(pagesDir, "foo.txt"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects nested subdirectories under pages/", () => {
    // No nested wiki layout today; reject defensively.
    const out = classifyAsWikiPage(path.join(pagesDir, "subdir", "foo.md"), { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects path traversal attempts (.. escapes pagesDir)", () => {
    const malicious = path.join(pagesDir, "..", "..", "secrets.md");
    const out = classifyAsWikiPage(malicious, { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects paths outside the workspace entirely", () => {
    const out = classifyAsWikiPage("/etc/passwd", { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });

  it("rejects pagesDir itself (no slug)", () => {
    const out = classifyAsWikiPage(pagesDir, { workspaceRoot: root });
    assert.deepEqual(out, { wiki: false });
  });
});
