// Unit tests for `packages/spotify-plugin/src/oauth.ts` — PKCE
// primitives, in-memory pending-auth store, authorize URL builder.
//
// Tests live under the host's `test/plugins/spotify/` (not inside
// the plugin package) so they pick up the host's tsx test runner +
// share lint config. Same convention bookmarks-plugin's
// integration test follows.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  _pendingAuthorizationsForTests,
  _resetPendingAuthorizationsForTests,
  buildAuthorizeUrl,
  consumePendingAuthorization,
  deriveCodeChallenge,
  generateRandomToken,
  registerPendingAuthorization,
} from "../../../packages/spotify-plugin/src/oauth.js";

beforeEach(() => {
  _resetPendingAuthorizationsForTests();
});

describe("generateRandomToken", () => {
  it("produces a base64url string with no padding", () => {
    const token = generateRandomToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(!token.endsWith("="), "base64url has no '=' padding");
  });

  it("returns distinct values across calls", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateRandomToken()));
    assert.equal(tokens.size, 50);
  });

  it("emits at least 32 bytes of entropy (≥ 43 base64url chars)", () => {
    const token = generateRandomToken();
    assert.ok(token.length >= 43, `expected ≥ 43 chars, got ${token.length}`);
  });
});

describe("deriveCodeChallenge", () => {
  it("matches a vendor-side SHA-256 + base64url derivation", async () => {
    const verifier = "the-quick-brown-fox-jumps-over-the-lazy-dog-0123456789";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    assert.equal(await deriveCodeChallenge(verifier), expected);
  });

  it("is deterministic for the same verifier", async () => {
    const verifier = generateRandomToken();
    assert.equal(await deriveCodeChallenge(verifier), await deriveCodeChallenge(verifier));
  });
});

describe("registerPendingAuthorization / consumePendingAuthorization", () => {
  it("round-trips a verifier + redirectUri via state", () => {
    const verifier = generateRandomToken();
    const state = registerPendingAuthorization(verifier, "http://127.0.0.1:3001/api/plugins/runtime/x/oauth/callback");
    const consumed = consumePendingAuthorization(state);
    assert.ok(consumed);
    assert.equal(consumed.codeVerifier, verifier);
  });

  it("is single-use — second consume returns null", () => {
    const state = registerPendingAuthorization("verifier", "http://127.0.0.1:3001/cb");
    assert.ok(consumePendingAuthorization(state));
    assert.equal(consumePendingAuthorization(state), null);
  });

  it("returns null for unknown state (CSRF guard)", () => {
    assert.equal(consumePendingAuthorization("never-registered"), null);
  });

  it("sweeps entries older than 10 minutes on each call", () => {
    const oldNow = new Date("2026-05-05T00:00:00Z");
    const state = registerPendingAuthorization("old-verifier", "http://127.0.0.1:3001/cb", oldNow);
    assert.equal(_pendingAuthorizationsForTests.size, 1);
    const later = new Date("2026-05-05T00:11:00Z");
    assert.equal(consumePendingAuthorization(state, later), null);
    assert.equal(_pendingAuthorizationsForTests.size, 0);
  });
});

describe("buildAuthorizeUrl", () => {
  it("emits the expected authorize URL shape (PKCE + scopes + state)", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "abc123",
        redirectUri: "http://127.0.0.1:3001/api/plugins/runtime/%40mulmoclaude%2Fspotify-plugin/oauth/callback",
        scopes: ["user-library-read", "user-read-recently-played"],
        state: "state-xyz",
        codeChallenge: "challenge-hash",
      }),
    );
    assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "abc123");
    assert.equal(url.searchParams.get("scope"), "user-library-read user-read-recently-played");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), "challenge-hash");
  });
});
