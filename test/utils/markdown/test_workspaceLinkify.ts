// Tests for the codespan → workspace-link auto-linkify extension
// (#1300). Pins both the pure detector and the full marked pipeline
// so a regression at either layer surfaces clearly.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";

import { isWorkspacePath, workspaceLinkifyExtension } from "../../../src/utils/markdown/workspaceLinkify";

// Install once for the file — codespan override is idempotent under
// repeated `marked.use` calls but applying once keeps the suite tidy.
before(() => {
  marked.use(workspaceLinkifyExtension);
});

describe("isWorkspacePath — pure detector", () => {
  it("accepts workspace-relative paths under artifacts/", () => {
    assert.equal(isWorkspacePath("artifacts/images/2026/05/foo.png"), true);
    assert.equal(isWorkspacePath("artifacts/documents/2026/05/summary.pdf"), true);
    assert.equal(isWorkspacePath("artifacts/foo.pdf"), true);
  });

  it("accepts workspace-relative paths under data/", () => {
    assert.equal(isWorkspacePath("data/wiki/pages/note.md"), true);
    assert.equal(isWorkspacePath("data/photo-locations/2026/05/foo.json"), true);
  });

  it("accepts paths with extensions up to 8 chars (heic, jpeg, json)", () => {
    assert.equal(isWorkspacePath("data/uploads/x.heic"), true);
    assert.equal(isWorkspacePath("data/uploads/x.jpeg"), true);
    assert.equal(isWorkspacePath("data/uploads/x.json"), true);
  });

  it("rejects paths without a workspace-root prefix", () => {
    assert.equal(isWorkspacePath("foo.bar"), false);
    assert.equal(isWorkspacePath("obj.prop"), false);
    assert.equal(isWorkspacePath("/absolute/path.pdf"), false);
    assert.equal(isWorkspacePath("../relative/path.pdf"), false);
    // even node_modules-style paths (just to be defensive)
    assert.equal(isWorkspacePath("node_modules/foo/bar.js"), false);
  });

  it("rejects paths without a file extension", () => {
    assert.equal(isWorkspacePath("artifacts/foo"), false);
    assert.equal(isWorkspacePath("data/foo/bar"), false);
    assert.equal(isWorkspacePath("artifacts/"), false);
  });

  it("rejects paths whose 'extension' contains non-alphanumeric chars", () => {
    // HTML-meta in the extension slot must not pass the detector
    // (defence-in-depth against XSS via crafted inline code).
    assert.equal(isWorkspacePath("artifacts/foo.<script>"), false);
    assert.equal(isWorkspacePath("artifacts/foo.png?download"), false);
    // Trailing punctuation is filtered out by markdown's tokenizer
    // already, but pin it here so a future regex relax doesn't slip.
    assert.equal(isWorkspacePath("artifacts/foo.pdf."), false);
  });

  it("rejects paths with whitespace inside", () => {
    assert.equal(isWorkspacePath("artifacts/path with space.png"), false);
    assert.equal(isWorkspacePath("artifacts/foo .png"), false);
  });

  it("rejects extensions longer than 8 chars (heuristic — not real)", () => {
    assert.equal(isWorkspacePath("artifacts/foo.verylongext"), false);
  });
});

describe("marked codespan → workspace-link auto-linkify", () => {
  it("wraps a workspace path in an anchor", () => {
    const html = (marked.parse("see `artifacts/documents/2026/05/summary.pdf` to review") as string).trim();
    assert.match(
      html,
      /<a href="artifacts\/documents\/2026\/05\/summary\.pdf"[^>]*class="workspace-link"[^>]*data-workspace-path="artifacts\/documents\/2026\/05\/summary\.pdf"[^>]*><code>artifacts\/documents\/2026\/05\/summary\.pdf<\/code><\/a>/,
    );
  });

  it("leaves non-workspace-path codespans untouched", () => {
    const html = (marked.parse("the value of `Math.PI` is fixed") as string).trim();
    // Default codespan rendering: bare <code>...</code> with no anchor.
    assert.match(html, /<code>Math\.PI<\/code>/);
    assert.doesNotMatch(html, /workspace-link/);
  });

  it("leaves a Markdown link with the same path untouched", () => {
    // [label](path) bypasses codespan entirely — it lands as a
    // regular <a href="path">label</a>. The auto-linkify path
    // should NOT touch it (different token), and rendering should
    // remain a single anchor.
    const html = (marked.parse("[summary.pdf](artifacts/documents/2026/05/summary.pdf)") as string).trim();
    assert.match(html, /<a href="artifacts\/documents\/2026\/05\/summary\.pdf">summary\.pdf<\/a>/);
    assert.doesNotMatch(html, /workspace-link/);
    assert.doesNotMatch(html, /<code>/);
  });

  it("auto-linkifies the LLM-output residue from the issue reproduction", () => {
    // Exact shape from issue #1300:
    //   - inline code with an artifacts/ path
    //   - followed by plain Japanese text "開いて内容を確認"
    const html = (marked.parse("`artifacts/documents/2026/05/example.pdf` 開いて内容を確認") as string).trim();
    assert.match(html, /<a href="artifacts\/documents\/2026\/05\/example\.pdf"[^>]*class="workspace-link"/);
    assert.match(html, /開いて内容を確認/);
  });
});
