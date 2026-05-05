// Unit tests for `server/spotify/tokens.ts` — read/write round-trip
// + refresh-response merge that preserves the prior `refreshToken`
// when Spotify omits a fresh one (the common case).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { mergeRefreshResponse, readTokens, writeTokens, type SpotifyTokens } from "../../server/spotify/tokens.js";
import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";

let tmpRoot: string;
let savedDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  // Capture the FULL property descriptor so afterEach restores
  // writability + enumerability flags too. Same fix as
  // test_plugin_runtime.ts / test_bookmarks_integration.ts (Codex
  // review iter on PR #1124).
  savedDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "spotifyConfig");
  tmpRoot = mkdtempSync(path.join(tmpdir(), "spotify-tokens-"));
  if (savedDescriptor) Object.defineProperty(WORKSPACE_PATHS, "spotifyConfig", { ...savedDescriptor, value: tmpRoot });
});

afterEach(() => {
  if (savedDescriptor) Object.defineProperty(WORKSPACE_PATHS, "spotifyConfig", savedDescriptor);
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("readTokens / writeTokens — round-trip", () => {
  it("returns null when tokens.json doesn't exist (= not_connected)", async () => {
    assert.equal(await readTokens(), null);
  });

  it("round-trips a full SpotifyTokens record", async () => {
    const tokens: SpotifyTokens = {
      accessToken: "at-xxx",
      refreshToken: "rt-yyy",
      expiresAt: "2026-05-05T01:00:00.000Z",
      scopes: ["user-library-read"],
    };
    await writeTokens(tokens);
    const out = await readTokens();
    assert.deepEqual(out, tokens);
  });

  it("creates the parent directory on demand (lazy on first connect)", async () => {
    rmSync(tmpRoot, { recursive: true, force: true }); // simulate no dir at all
    await writeTokens({
      accessToken: "at-xxx",
      refreshToken: "rt-yyy",
      expiresAt: "2026-05-05T01:00:00.000Z",
      scopes: [],
    });
    assert.ok(existsSync(path.join(tmpRoot, "tokens.json")));
  });

  it("returns null when tokens.json is missing required fields (treats as not_connected)", async () => {
    writeFileSync(path.join(tmpRoot, "tokens.json"), JSON.stringify({ accessToken: "at-xxx" }));
    assert.equal(await readTokens(), null);
  });
});

describe("mergeRefreshResponse", () => {
  const prior: SpotifyTokens = {
    accessToken: "old-access",
    refreshToken: "rt-original",
    expiresAt: "2026-05-04T00:00:00.000Z",
    scopes: ["user-library-read", "user-read-recently-played"],
  };

  it("preserves the prior refreshToken when the response omits one (common case)", () => {
    const merged = mergeRefreshResponse(prior, { accessToken: "new-access", expiresInSec: 3600 }, new Date("2026-05-05T00:00:00.000Z"));
    assert.equal(merged.refreshToken, "rt-original");
    assert.equal(merged.accessToken, "new-access");
    assert.equal(merged.expiresAt, "2026-05-05T01:00:00.000Z");
    assert.deepEqual(merged.scopes, ["user-library-read", "user-read-recently-played"]);
  });

  it("overwrites refreshToken when Spotify returns a fresh one (rotation)", () => {
    const merged = mergeRefreshResponse(
      prior,
      { accessToken: "new-access", refreshToken: "rt-rotated", expiresInSec: 3600 },
      new Date("2026-05-05T00:00:00.000Z"),
    );
    assert.equal(merged.refreshToken, "rt-rotated");
  });

  it("overwrites scopes when Spotify returns them (e.g. user revoked one)", () => {
    const merged = mergeRefreshResponse(
      prior,
      { accessToken: "new-access", expiresInSec: 3600, scopes: ["user-library-read"] },
      new Date("2026-05-05T00:00:00.000Z"),
    );
    assert.deepEqual(merged.scopes, ["user-library-read"]);
  });
});
