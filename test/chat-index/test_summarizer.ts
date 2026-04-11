import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractText,
  truncate,
  parseClaudeJsonResult,
  validateSummaryResult,
} from "../../server/chat-index/summarizer.js";

describe("extractText", () => {
  it("keeps user and assistant text turns", () => {
    const jsonl = [
      JSON.stringify({ source: "user", type: "text", message: "hello" }),
      JSON.stringify({ source: "assistant", type: "text", message: "hi" }),
    ].join("\n");
    const out = extractText(jsonl);
    assert.match(out, /\[user\] hello/);
    assert.match(out, /\[assistant\] hi/);
  });

  it("skips tool_result lines", () => {
    const jsonl = [
      JSON.stringify({ source: "user", type: "text", message: "ask" }),
      JSON.stringify({
        source: "tool",
        type: "tool_result",
        message: "noisy tool output",
      }),
    ].join("\n");
    const out = extractText(jsonl);
    assert.match(out, /ask/);
    assert.doesNotMatch(out, /noisy tool output/);
  });

  it("tolerates malformed lines without throwing", () => {
    const jsonl = [
      "not json at all",
      JSON.stringify({ source: "user", type: "text", message: "good" }),
      "{ bad json",
    ].join("\n");
    const out = extractText(jsonl);
    assert.match(out, /good/);
  });

  it("returns empty string for no text entries", () => {
    const jsonl = JSON.stringify({
      source: "tool",
      type: "tool_result",
      message: "x",
    });
    assert.equal(extractText(jsonl), "");
  });

  it("truncates per-message at 500 chars with ellipsis", () => {
    const long = "a".repeat(1000);
    const jsonl = JSON.stringify({
      source: "user",
      type: "text",
      message: long,
    });
    const out = extractText(jsonl);
    // Per-message limit is 500 chars + "…", still inside the
    // overall envelope. Verify we actually clipped.
    assert.ok(out.length < long.length);
    assert.ok(out.endsWith("…"));
  });

  it("joins turns with a blank line separator", () => {
    const jsonl = [
      JSON.stringify({ source: "user", type: "text", message: "one" }),
      JSON.stringify({ source: "assistant", type: "text", message: "two" }),
    ].join("\n");
    const out = extractText(jsonl);
    assert.match(out, /one\n\n\[assistant\] two/);
  });
});

describe("truncate", () => {
  it("passes short input through unchanged", () => {
    const s = "hello world";
    assert.equal(truncate(s), s);
  });

  it("keeps head + tail for long input", () => {
    // Anything > 8000 chars. Use distinct head/tail markers so the
    // assertion can be specific.
    const head = "HEAD_MARKER".padEnd(3000, "h");
    const middle = "m".repeat(5000);
    const tail = "TAIL_MARKER".padStart(5000, "t");
    const out = truncate(head + middle + tail);
    assert.ok(out.length < (head + middle + tail).length);
    assert.match(out, /HEAD_MARKER/);
    assert.match(out, /TAIL_MARKER/);
    // Middle "m" filler should be dropped.
    assert.doesNotMatch(out, /mmmmmmmmmmmmmmmm/);
  });
});

describe("parseClaudeJsonResult", () => {
  it("returns the SummaryResult on a success envelope", () => {
    const stdout = JSON.stringify({
      structured_output: {
        title: "Billy Bootcamp schedule",
        summary: "Two-week exercise plan.",
        keywords: ["workout", "schedule", "plan"],
      },
    });
    const out = parseClaudeJsonResult(stdout);
    assert.equal(out.title, "Billy Bootcamp schedule");
    assert.equal(out.summary, "Two-week exercise plan.");
    assert.deepEqual(out.keywords, ["workout", "schedule", "plan"]);
  });

  it("throws on an error envelope", () => {
    const stdout = JSON.stringify({
      is_error: true,
      result: "rate limited",
    });
    assert.throws(() => parseClaudeJsonResult(stdout), /rate limited/);
  });

  it("throws on malformed json", () => {
    assert.throws(
      () => parseClaudeJsonResult("{ not json"),
      /failed to parse claude json output/,
    );
  });
});

describe("validateSummaryResult", () => {
  it("returns a SummaryResult for a well-formed object", () => {
    const out = validateSummaryResult({
      title: "t",
      summary: "s",
      keywords: ["a", "b"],
    });
    assert.equal(out.title, "t");
    assert.equal(out.summary, "s");
    assert.deepEqual(out.keywords, ["a", "b"]);
  });

  it("coerces missing fields to safe defaults", () => {
    const out = validateSummaryResult({});
    assert.equal(out.title, "");
    assert.equal(out.summary, "");
    assert.deepEqual(out.keywords, []);
  });

  it("drops non-string keywords", () => {
    const out = validateSummaryResult({
      title: "t",
      summary: "s",
      keywords: ["ok", 42, null, "also-ok"],
    });
    assert.deepEqual(out.keywords, ["ok", "also-ok"]);
  });

  it("throws when the input is not an object", () => {
    assert.throws(() => validateSummaryResult(null), /not an object/);
    assert.throws(() => validateSummaryResult("string"), /not an object/);
  });

  it("treats non-array keywords as empty", () => {
    const out = validateSummaryResult({
      title: "t",
      summary: "s",
      keywords: "not an array",
    });
    assert.deepEqual(out.keywords, []);
  });
});
