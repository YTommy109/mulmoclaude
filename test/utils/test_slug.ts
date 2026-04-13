import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { hasNonAscii, hashSlug, slugify } from "../../server/utils/slug.js";

const HASH_LEN = 16;

function expectedHash(input: string, len = HASH_LEN): string {
  return createHash("sha256")
    .update(input, "utf-8")
    .digest("base64url")
    .slice(0, len);
}

describe("hasNonAscii", () => {
  it("is false for pure ASCII", () => {
    assert.equal(hasNonAscii("Doing"), false);
    assert.equal(hasNonAscii("project-a_2"), false);
    assert.equal(hasNonAscii(""), false);
  });

  it("is true for any non-ASCII codepoint", () => {
    assert.equal(hasNonAscii("完了"), true);
    assert.equal(hasNonAscii("Doing (進行中)"), true);
    assert.equal(hasNonAscii("🎉"), true);
  });
});

describe("hashSlug", () => {
  it("returns a deterministic base64url-encoded sha256 prefix", () => {
    assert.equal(hashSlug("完了"), expectedHash("完了"));
    assert.equal(hashSlug("完了"), hashSlug("完了"));
  });

  it("yields different hashes for inputs differing only in suffix", () => {
    assert.notEqual(hashSlug("プロジェクトA"), hashSlug("プロジェクトB"));
  });

  it("respects the requested length", () => {
    assert.equal(hashSlug("完了", 8).length, 8);
    assert.equal(hashSlug("完了", 32).length, 32);
  });
});

describe("slugify (ASCII happy path)", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugify("Hello World"), "hello-world");
  });

  it("collapses non-alnum runs", () => {
    assert.equal(slugify("Q&A: notes!"), "q-a-notes");
  });

  it("trims leading/trailing hyphens", () => {
    assert.equal(slugify("---foo---"), "foo");
  });

  it("returns the default when input is empty", () => {
    assert.equal(slugify(""), "page");
    assert.equal(slugify("", "column"), "column");
  });

  it("returns the default when all chars strip away", () => {
    assert.equal(slugify("!!!"), "page");
  });

  it("respects maxLength", () => {
    assert.equal(slugify("a".repeat(80), "page", 10), "aaaaaaaaaa");
  });
});

describe("slugify (non-ASCII fallback)", () => {
  it("produces a deterministic hash for pure non-ASCII labels", () => {
    assert.equal(slugify("完了"), expectedHash("完了"));
  });

  it("gives different ids to labels differing only in suffix", () => {
    const a = slugify("プロジェクトA");
    const b = slugify("プロジェクトB");
    assert.notEqual(a, b);
    assert.equal(a.length, HASH_LEN);
    assert.equal(b.length, HASH_LEN);
  });

  it("keeps an ASCII prefix when ≥3 chars survive", () => {
    const result = slugify("Doing (進行中)");
    assert.match(result, /^doing-[A-Za-z0-9_-]+$/);
    assert.ok(result.endsWith(expectedHash("Doing (進行中)".trim())));
  });

  it("skips the ASCII prefix when <3 chars survive", () => {
    // "A" in "A完了" is only 1 char — too short to be useful
    const result = slugify("A完了");
    assert.equal(result, expectedHash("A完了"));
  });

  it("does not collide 'プロジェクト' and 'プロジェクト ' (whitespace) by design", () => {
    // trim() is applied before hashing, so trailing whitespace collapses.
    // Distinct *content* still hashes distinctly; this is about trim only.
    assert.equal(slugify("プロジェクト"), slugify("プロジェクト "));
  });

  it("honours maxLength when composing 'prefix-hash'", () => {
    const result = slugify("doing-marker-(進行中)", "page", 30);
    assert.ok(result.length <= 30);
    assert.ok(result.endsWith(expectedHash("doing-marker-(進行中)".trim())));
  });

  it("handles emoji-only input", () => {
    const result = slugify("🎉🎊");
    assert.equal(result, expectedHash("🎉🎊"));
  });
});
