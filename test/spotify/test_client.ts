// Unit tests for `server/spotify/client.ts` — the 401 → refresh →
// retry-once loop, proactive refresh near expiry, and error
// surfacing. All deps injected so the network is never touched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { spotifyApi, type SpotifyClientDeps } from "../../server/spotify/client.js";
import type { SpotifyTokens } from "../../server/spotify/tokens.js";

interface FakeFetchEntry {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams };
}

function makeJsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

interface FakeDepsHandle {
  deps: Pick<SpotifyClientDeps, "fetchImpl" | "tokensReader" | "tokensWriter" | "clientIdReader" | "now">;
  calls: FakeFetchEntry[];
  written: SpotifyTokens[];
}

function makeFakeDeps(opts: {
  tokens: SpotifyTokens | null;
  clientId: string | null;
  now?: Date;
  // sequenced responses — each fetch call consumes the next
  responses: Response[];
}): FakeDepsHandle {
  const calls: FakeFetchEntry[] = [];
  const written: SpotifyTokens[] = [];
  const queue = [...opts.responses];
  const fetchImpl = (async (input: string | URL, init?: Parameters<typeof fetch>[1]) => {
    calls.push({ url: String(input), init: init as FakeFetchEntry["init"] });
    const next = queue.shift();
    if (!next) throw new Error(`fetch called more times than expected (call ${calls.length}, url=${String(input)})`);
    return next;
  }) as unknown as typeof globalThis.fetch;
  return {
    deps: {
      fetchImpl,
      tokensReader: async () => opts.tokens,
      tokensWriter: async (next) => {
        written.push(next);
      },
      clientIdReader: () => opts.clientId,
      now: () => opts.now ?? new Date("2026-05-05T00:00:00.000Z"),
    },
    calls,
    written,
  };
}

const FUTURE = "2026-05-05T05:00:00.000Z"; // 5h from the fake `now`
const ALMOST_NOW = "2026-05-05T00:00:10.000Z"; // 10s from the fake `now` — within 30s leeway

const validTokens: SpotifyTokens = {
  accessToken: "at-current",
  refreshToken: "rt-current",
  expiresAt: FUTURE,
  scopes: ["user-library-read"],
};

describe("spotifyApi — config / state preconditions", () => {
  it("returns client_id_missing when SPOTIFY_CLIENT_ID is unset", async () => {
    const handle = makeFakeDeps({ tokens: validTokens, clientId: null, responses: [] });
    const result = await spotifyApi("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, false);
    assert.deepEqual(result.error, { kind: "client_id_missing" });
    assert.equal(handle.calls.length, 0);
  });

  it("returns not_connected when tokens.json doesn't exist", async () => {
    const handle = makeFakeDeps({ tokens: null, clientId: "cid", responses: [] });
    const result = await spotifyApi("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, false);
    assert.deepEqual(result.error, { kind: "not_connected" });
  });
});

describe("spotifyApi — happy path", () => {
  it("returns parsed JSON on a 200 response, sends the bearer header", async () => {
    const handle = makeFakeDeps({
      tokens: validTokens,
      clientId: "cid",
      responses: [makeJsonResponse({ id: "user123" })],
    });
    const result = await spotifyApi<{ id: string }>("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { id: "user123" });
    assert.equal(handle.calls[0].url, "https://api.spotify.com/v1/me");
    const headers = handle.calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer at-current");
  });

  it("returns null data on 204 No Content (e.g. nowPlaying when nothing is playing)", async () => {
    const handle = makeFakeDeps({
      tokens: validTokens,
      clientId: "cid",
      responses: [new Response(null, { status: 204 })],
    });
    const result = await spotifyApi("GET", "/v1/me/player/currently-playing", {}, handle.deps);
    assert.equal(result.ok, true);
    assert.equal(result.data, null);
  });
});

describe("spotifyApi — 401 → refresh → retry once", () => {
  it("refreshes after a 401 and retries the original call with the new token", async () => {
    const handle = makeFakeDeps({
      tokens: validTokens,
      clientId: "cid",
      responses: [
        // 1st: 401 on the API call
        new Response("", { status: 401 }),
        // 2nd: token refresh succeeds
        makeJsonResponse({ access_token: "at-new", expires_in: 3600, scope: "user-library-read" }),
        // 3rd: API retry succeeds
        makeJsonResponse({ id: "user123" }),
      ],
    });
    const result = await spotifyApi<{ id: string }>("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, true);
    assert.equal(handle.calls.length, 3);
    assert.equal(handle.calls[1].url, "https://accounts.spotify.com/api/token");
    // Retry must use the new bearer.
    const retryHeaders = handle.calls[2].init?.headers as Record<string, string>;
    assert.equal(retryHeaders.Authorization, "Bearer at-new");
    // Refreshed tokens persisted (refreshToken preserved since response didn't return one).
    assert.equal(handle.written.length, 1);
    assert.equal(handle.written[0].accessToken, "at-new");
    assert.equal(handle.written[0].refreshToken, "rt-current");
  });

  it("gives up (auth_expired) when the refresh itself fails (401 from token endpoint)", async () => {
    const handle = makeFakeDeps({
      tokens: validTokens,
      clientId: "cid",
      responses: [
        new Response("", { status: 401 }), // API call
        new Response("invalid_grant", { status: 400 }), // refresh fails
      ],
    });
    const result = await spotifyApi("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.error.kind, "auth_expired");
    assert.equal(handle.written.length, 0);
  });

  it("does NOT loop a second refresh when the retry also returns 401", async () => {
    const handle = makeFakeDeps({
      tokens: validTokens,
      clientId: "cid",
      responses: [
        new Response("", { status: 401 }), // API call 1
        makeJsonResponse({ access_token: "at-new", expires_in: 3600 }), // refresh ok
        new Response("", { status: 401 }), // API retry — still 401 (refresh token revoked-ish)
      ],
    });
    const result = await spotifyApi("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.error.kind, "auth_expired");
    assert.equal(handle.calls.length, 3, "must not refresh again after the retry's 401");
  });
});

describe("spotifyApi — proactive refresh near expiry", () => {
  it("refreshes BEFORE the API call when the access token is within 30s of expiry", async () => {
    const handle = makeFakeDeps({
      tokens: { ...validTokens, expiresAt: ALMOST_NOW },
      clientId: "cid",
      responses: [
        // 1st: refresh
        makeJsonResponse({ access_token: "at-new", expires_in: 3600 }),
        // 2nd: API call (only one — proactive refresh skipped the failing first attempt)
        makeJsonResponse({ id: "user123" }),
      ],
    });
    const result = await spotifyApi("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, true);
    assert.equal(handle.calls[0].url, "https://accounts.spotify.com/api/token");
    assert.equal(handle.calls[1].url, "https://api.spotify.com/v1/me");
  });
});

describe("spotifyApi — non-auth errors", () => {
  it("surfaces 429 with retryAfterSec read from the Retry-After header", async () => {
    const handle = makeFakeDeps({
      tokens: validTokens,
      clientId: "cid",
      responses: [new Response("", { status: 429, headers: { "Retry-After": "12" } })],
    });
    const result = await spotifyApi("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.deepEqual(result.error, { kind: "rate_limited", retryAfterSec: 12 });
  });

  it("surfaces 5xx as spotify_api_error with status + truncated body", async () => {
    const handle = makeFakeDeps({
      tokens: validTokens,
      clientId: "cid",
      responses: [new Response("internal", { status: 500 })],
    });
    const result = await spotifyApi("GET", "/v1/me", {}, handle.deps);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.error.kind, "spotify_api_error");
  });
});
