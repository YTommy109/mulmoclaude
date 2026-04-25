import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { summariesRoot, dailyPathFor, topicPathFor, archivedTopicPathFor, toIsoDate, slugify } from "../../server/workspace/journal/paths.js";

const WORKSPACE = "/fake/workspace";

// Mirrors the canonical hash rule in server/utils/slug.ts so these
// tests stay independent of any future hash-length tweaks: if the
// canonical changes its prefix length, these helpers adjust with it
// rather than silently producing the wrong expected value.
function expectedHash(input: string, len = 16): string {
  return createHash("sha256").update(input, "utf-8").digest("base64url").slice(0, len);
}

describe("summariesRoot", () => {
  it("joins workspace root with the summaries dir", () => {
    assert.equal(summariesRoot(WORKSPACE), path.join(WORKSPACE, "conversations", "summaries"));
  });
});

describe("dailyPathFor", () => {
  it("builds summaries/daily/YYYY/MM/DD.md", () => {
    assert.equal(dailyPathFor(WORKSPACE, "2026-04-11"), path.join(WORKSPACE, "conversations", "summaries", "daily", "2026", "04", "11.md"));
  });

  it("preserves leading zeros", () => {
    assert.equal(dailyPathFor(WORKSPACE, "2026-01-03"), path.join(WORKSPACE, "conversations", "summaries", "daily", "2026", "01", "03.md"));
  });
});

describe("topicPathFor", () => {
  it("builds summaries/topics/<slug>.md", () => {
    assert.equal(topicPathFor(WORKSPACE, "refactoring"), path.join(WORKSPACE, "conversations", "summaries", "topics", "refactoring.md"));
  });
});

describe("archivedTopicPathFor", () => {
  it("builds summaries/archive/topics/<slug>.md", () => {
    assert.equal(archivedTopicPathFor(WORKSPACE, "old-topic"), path.join(WORKSPACE, "conversations", "summaries", "archive", "topics", "old-topic.md"));
  });
});

describe("toIsoDate", () => {
  it("formats a Date in local time as YYYY-MM-DD", () => {
    // Pick a date in the middle of a month to avoid timezone edge
    // cases flipping the result. April 15 at noon local is April 15
    // in every timezone on Earth.
    const date = new Date(2026, 3, 15, 12, 0, 0); // month is 0-indexed
    assert.equal(toIsoDate(date), "2026-04-15");
  });

  it("pads single-digit months and days", () => {
    const date = new Date(2026, 0, 3, 12, 0, 0);
    assert.equal(toIsoDate(date), "2026-01-03");
  });

  it("accepts a ms timestamp", () => {
    const date = new Date(2026, 5, 20, 12, 0, 0);
    assert.equal(toIsoDate(date.getTime()), "2026-06-20");
  });
});

describe("slugify (journal — delegates to canonical with 'topic' fallback)", () => {
  it("lowercases ASCII input", () => {
    assert.equal(slugify("Refactoring"), "refactoring");
  });

  it("replaces spaces with hyphens", () => {
    assert.equal(slugify("video generation"), "video-generation");
  });

  it("collapses runs of separators", () => {
    assert.equal(slugify("foo   bar___baz"), "foo-bar-baz");
  });

  it("strips leading and trailing separators", () => {
    assert.equal(slugify("--hello--"), "hello");
  });

  it("keeps digits", () => {
    assert.equal(slugify("v2 release"), "v2-release");
  });

  it("strips punctuation", () => {
    assert.equal(slugify("Q&A: notes!"), "q-a-notes");
  });

  it("falls back to 'topic' for empty input", () => {
    assert.equal(slugify(""), "topic");
  });

  it("falls back to 'topic' for whitespace-only input", () => {
    // Pure whitespace strips away entirely → ASCII-empty AND nothing
    // for the hash to grip on; canonical falls through to the
    // explicit fallback we passed in ("topic").
    assert.equal(slugify("   "), "topic");
  });

  it("is idempotent for already-slugged input", () => {
    assert.equal(slugify("already-slugged"), "already-slugged");
  });

  // ── Behavior change post #732 ───────────────────────────────────
  // Pre-#732 the journal-local slugify dropped non-ASCII characters
  // entirely, so any pure-Japanese topic name became "topic" and
  // distinct topics silently overwrote each other's summary file.
  // Now journal delegates to the canonical hash-based rule.

  it("hash-disambiguates two different pure-Japanese topic names", () => {
    const slugA = slugify("プロジェクトA");
    const slugB = slugify("プロジェクトB");
    assert.notEqual(slugA, slugB, "previously both collapsed to 'topic' — must differ now");
    assert.equal(slugA, expectedHash("プロジェクトA"));
    assert.equal(slugB, expectedHash("プロジェクトB"));
  });

  it("preserves a meaningful ASCII prefix when mixed with non-ASCII", () => {
    // "mulmo リファクタ" used to slugify to bare "mulmo" (non-ASCII
    // dropped). Now it composes as "mulmo-<hash>" so the human-
    // readable prefix is kept AND collisions with another "mulmo …"
    // topic are avoided.
    const result = slugify("mulmo リファクタ");
    assert.match(result, /^mulmo-[A-Za-z0-9_-]+$/);
    assert.ok(result.endsWith(expectedHash("mulmo リファクタ".trim())));
  });

  it("uses pure hash when the ASCII portion is shorter than 3 chars", () => {
    // Single-letter ASCII prefixes don't help readability; canonical
    // just emits the hash.
    assert.equal(slugify("A 完了"), expectedHash("A 完了"));
  });

  it("treats emoji-only input as non-ASCII (hash, not 'topic')", () => {
    assert.equal(slugify("🎉🎊"), expectedHash("🎉🎊"));
  });

  it("is deterministic — same input always returns the same slug", () => {
    assert.equal(slugify("プロジェクトA"), slugify("プロジェクトA"));
  });
});
