// Unit tests for the canonical Vue-side frontmatter parser /
// serializer / merger (#895 PR A). The server-side mirror in PR B
// will share the same shape but live in a separate file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeFrontmatter, parseFrontmatter, serializeWithFrontmatter } from "../../../src/utils/markdown/frontmatter.js";

describe("parseFrontmatter — happy path", () => {
  it("splits a well-formed envelope into meta + body", () => {
    const raw = "---\ntitle: Hello\ncreated: 2026-04-27\n---\n\nbody text\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, true);
    assert.deepEqual(out.meta, { title: "Hello", created: "2026-04-27" });
    assert.equal(out.body, "body text\n");
  });

  it("preserves insertion order in meta (Object.entries iterates in source order)", () => {
    const raw = "---\nzeta: 1\nalpha: 2\nmiddle: 3\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.deepEqual(Object.keys(out.meta), ["zeta", "alpha", "middle"]);
  });

  it("parses inline arrays", () => {
    const raw = "---\ntags: [a, b, c]\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.deepEqual(out.meta.tags, ["a", "b", "c"]);
  });

  it("parses block-list arrays (full YAML coverage)", () => {
    const raw = "---\ntags:\n  - one\n  - two\n  - three\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.deepEqual(out.meta.tags, ["one", "two", "three"]);
  });

  it("handles unicode keys / values (CJK)", () => {
    const raw = "---\ntitle: さくらインターネット\ntags: [クラウド, インフラ]\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.equal(out.meta.title, "さくらインターネット");
    assert.deepEqual(out.meta.tags, ["クラウド", "インフラ"]);
  });

  it("accepts \\r\\n line endings (Windows)", () => {
    const raw = "---\r\ntitle: WinFile\r\n---\r\n\r\nbody\r\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, true);
    assert.equal(out.meta.title, "WinFile");
  });
});

describe("parseFrontmatter — degenerate cases", () => {
  it("returns empty meta + raw body when no envelope present", () => {
    const raw = "no header here\n\njust body\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, false);
    assert.deepEqual(out.meta, {});
    assert.equal(out.body, raw);
  });

  it("treats an unclosed envelope as no header (graceful fallback)", () => {
    const raw = "---\ntitle: Stuck\n\nbody but no closing fence\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, false);
    assert.deepEqual(out.meta, {});
    assert.equal(out.body, raw);
  });

  it("treats malformed YAML as no header — does not throw", () => {
    const raw = "---\ntitle: [unclosed\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, false);
    assert.deepEqual(out.meta, {});
  });

  it("treats scalar-only / array-only frontmatter as malformed", () => {
    // YAML `---\njust a string\n---` parses to a scalar string,
    // which is not a useful meta object — fall back to no-header.
    const raw = "---\njust a string\n---\nbody";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, false);
  });

  it("accepts an empty envelope (`---\\n---\\n`) as hasHeader: true with empty meta", () => {
    const raw = "---\n---\n\nbody\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, true);
    assert.deepEqual(out.meta, {});
    assert.equal(out.body, "body\n");
  });

  it("returns empty body when the document is header-only (no body following)", () => {
    const raw = "---\ntitle: Hello\n---\n";
    const out = parseFrontmatter(raw);
    assert.equal(out.hasHeader, true);
    assert.equal(out.meta.title, "Hello");
    assert.equal(out.body, "");
  });
});

describe("serializeWithFrontmatter", () => {
  it("emits an envelope + blank line + body for a non-empty meta", () => {
    const out = serializeWithFrontmatter({ title: "Hello", tags: ["a", "b"] }, "body text\n");
    // js-yaml's default scalar style is plain; arrays become flow
    // or block — assert via round-trip rather than literal text so
    // the test isn't brittle to formatting choices.
    const round = parseFrontmatter(out);
    assert.equal(round.hasHeader, true);
    assert.equal(round.meta.title, "Hello");
    assert.deepEqual(round.meta.tags, ["a", "b"]);
    assert.equal(round.body, "body text\n");
  });

  it("returns the body unchanged when meta is empty (no envelope ceremony)", () => {
    const out = serializeWithFrontmatter({}, "just body\n");
    assert.equal(out, "just body\n");
  });

  it("round-trips meta verbatim (parse → serialize → parse same meta)", () => {
    const original = { title: "X", created: "2026-04-27", tags: ["a", "b"], updated: "2026-04-27T12:34:56Z" };
    const text = serializeWithFrontmatter(original, "body\n");
    const round = parseFrontmatter(text);
    assert.deepEqual(round.meta, original);
  });

  it("escapes special YAML chars (colons, quotes) safely", () => {
    const text = serializeWithFrontmatter({ title: 'Has: colon and "quotes"' }, "body");
    const round = parseFrontmatter(text);
    assert.equal(round.meta.title, 'Has: colon and "quotes"');
  });
});

describe("mergeFrontmatter", () => {
  it("overwrites known keys with patch values", () => {
    const out = mergeFrontmatter({ title: "Old", tags: ["a"] }, { title: "New" });
    assert.equal(out.title, "New");
    // Untouched keys preserved.
    assert.deepEqual(out.tags, ["a"]);
  });

  it("preserves keys not mentioned in the patch", () => {
    // Custom domain field (e.g. `prerequisites` from a skill file)
    // must survive a generic update that only touches `updated`.
    const out = mergeFrontmatter({ prerequisites: "Node 22+", title: "Doc" }, { updated: "2026-04-27" });
    assert.equal(out.prerequisites, "Node 22+");
    assert.equal(out.updated, "2026-04-27");
  });

  it("deletes a key when the patch value is null", () => {
    const out = mergeFrontmatter({ title: "Doc", deprecated: true }, { deprecated: null });
    assert.equal("deprecated" in out, false);
  });

  it("deletes a key when the patch value is undefined (same semantic as null)", () => {
    const out = mergeFrontmatter({ title: "Doc", legacy: "yes" }, { legacy: undefined });
    assert.equal("legacy" in out, false);
  });

  it("returns a new object (no mutation of the existing input)", () => {
    const existing = { title: "Doc" };
    const out = mergeFrontmatter(existing, { updated: "now" });
    assert.notStrictEqual(out, existing);
    assert.equal("updated" in existing, false);
  });
});
