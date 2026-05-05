// Unit tests for `server/spotify/config.ts`. Pure helpers — no I/O,
// just env reads and request-shape parsing. Each test restores
// `process.env.SPOTIFY_CLIENT_ID` so a leak can't poison sibling
// suites.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { buildRedirectUri, getSpotifyClientId, SPOTIFY_SCOPES } from "../../server/spotify/config.js";

describe("getSpotifyClientId", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_ID;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SPOTIFY_CLIENT_ID;
    else process.env.SPOTIFY_CLIENT_ID = saved;
  });

  it("returns null when env var is unset", () => {
    assert.equal(getSpotifyClientId(), null);
  });

  it("returns null when env var is empty / whitespace", () => {
    process.env.SPOTIFY_CLIENT_ID = "";
    assert.equal(getSpotifyClientId(), null);
    process.env.SPOTIFY_CLIENT_ID = "   ";
    assert.equal(getSpotifyClientId(), null);
  });

  it("returns the trimmed value when set", () => {
    process.env.SPOTIFY_CLIENT_ID = "  abc123  ";
    assert.equal(getSpotifyClientId(), "abc123");
  });
});

describe("buildRedirectUri", () => {
  // Cast through `unknown` because Express's `Request.get` is typed
  // with overloads (`get('set-cookie'): string[] | undefined` vs the
  // generic string signature). The test fakes only need the host /
  // protocol fields `buildRedirectUri` reads.
  function makeReq(host: string, protocol: "http" | "https" = "http"): Parameters<typeof buildRedirectUri>[0] {
    return {
      protocol,
      get: ((header: string) => (header.toLowerCase() === "host" ? host : undefined)) as never,
    };
  }

  it("uses the inbound `Host` header so port-aware setups Just Work", () => {
    assert.equal(buildRedirectUri(makeReq("127.0.0.1:3001")), "http://127.0.0.1:3001/api/spotify/callback");
    assert.equal(buildRedirectUri(makeReq("127.0.0.1:3099")), "http://127.0.0.1:3099/api/spotify/callback");
  });

  it("falls back to 127.0.0.1 when the Host header is missing", () => {
    const req: Parameters<typeof buildRedirectUri>[0] = { protocol: "http", get: (() => undefined) as never };
    assert.equal(buildRedirectUri(req), "http://127.0.0.1/api/spotify/callback");
  });

  it("preserves https when the request reports it (rare for loopback but valid)", () => {
    assert.equal(buildRedirectUri(makeReq("example.local", "https")), "https://example.local/api/spotify/callback");
  });
});

describe("SPOTIFY_SCOPES", () => {
  it("is sorted (stable authorize URL across boots)", () => {
    const sorted = [...SPOTIFY_SCOPES].sort();
    assert.deepEqual([...SPOTIFY_SCOPES], sorted);
  });

  it("covers the v1 read-only scope set documented in plans/feat-spotify-plugin.md", () => {
    assert.deepEqual([...SPOTIFY_SCOPES], ["playlist-read-private", "user-library-read", "user-read-currently-playing", "user-read-recently-played"]);
  });
});
