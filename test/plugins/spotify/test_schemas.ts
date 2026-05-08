// Schema-level boundary tests. Most of the dispatch surface is
// covered through the integration-style tests in test_listening /
// test_search / test_playback, but a few cases are easier to nail
// down by parsing `DispatchArgsSchema` directly — particularly the
// trim-before-min-length check on `search.query` (Codex review on
// PR #1168).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DispatchArgsSchema } from "../../../packages/plugins/spotify-plugin/src/schemas.js";

describe("DispatchArgsSchema.search — query validation", () => {
  it("accepts a normal query", () => {
    const result = DispatchArgsSchema.safeParse({ kind: "search", query: "Daft Punk" });
    assert.equal(result.success, true);
  });

  it("trims surrounding whitespace before validating min(1)", () => {
    const result = DispatchArgsSchema.safeParse({ kind: "search", query: "   Bach   " });
    assert.equal(result.success, true);
    if (!result.success) throw new Error("unreachable");
    assert.equal(result.data.kind === "search" && result.data.query, "Bach");
  });

  it("rejects whitespace-only query (would otherwise reach Spotify and 4xx)", () => {
    const result = DispatchArgsSchema.safeParse({ kind: "search", query: "   " });
    assert.equal(result.success, false);
  });

  it("rejects an empty query", () => {
    const result = DispatchArgsSchema.safeParse({ kind: "search", query: "" });
    assert.equal(result.success, false);
  });

  it("rejects a query longer than 200 characters", () => {
    const result = DispatchArgsSchema.safeParse({ kind: "search", query: "a".repeat(201) });
    assert.equal(result.success, false);
  });
});
