// Spotify OAuth helpers — PKCE code_verifier / code_challenge,
// random `state`, in-memory pending-auth store (issue #1162).
//
// PKCE (RFC 7636) over Authorization Code: we generate a high-
// entropy `code_verifier` per connect attempt, derive the
// SHA-256 + base64url `code_challenge`, send the challenge to
// Spotify's authorize endpoint, and present the verifier to the
// token endpoint. The verifier never leaves this server.
//
// `state` is bound to the verifier in `pendingAuthorizations`:
// the callback handler must produce a known state, otherwise the
// request is rejected (CSRF-style protection — a third-party site
// can't trick the user's browser into completing an OAuth dance
// the user never started here).

import { createHash, randomBytes } from "node:crypto";

/** PKCE / state record kept in memory between `connect` and
 *  `callback`. Single-process server, single user, so a Map is
 *  sufficient — no need for a shared store. */
export interface PendingAuthorization {
  codeVerifier: string;
  redirectUri: string;
  /** Epoch ms, for sweeping stale entries. */
  createdAtMs: number;
}

/** Maximum age before a pending authorization is considered stale
 *  and eligible for sweep. Spotify's authorize page typically
 *  redirects back within a minute; 10 minutes covers slow users
 *  without leaving entries around forever. */
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Map<state, PendingAuthorization>. Exported only for tests. */
export const _pendingAuthorizations = new Map<string, PendingAuthorization>();

/** Generate 32 bytes of random entropy as a base64url string.
 *  Used both for `code_verifier` (PKCE) and `state` (CSRF). */
export function generateRandomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Derive `code_challenge` from `code_verifier`: SHA-256 then
 *  base64url. Spotify's authorize URL carries this; the token
 *  endpoint receives the verifier and re-derives. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/** Register a fresh pending authorization. Returns the `state`
 *  the caller must include on the authorize URL — the same
 *  `state` will come back on the callback and lookup the record.
 *  Sweeps stale entries on every call so the map can't grow
 *  unbounded across abandoned attempts. */
export function registerPendingAuthorization(codeVerifier: string, redirectUri: string, now: Date = new Date()): string {
  sweepStaleAuthorizations(now);
  const state = generateRandomToken();
  _pendingAuthorizations.set(state, {
    codeVerifier,
    redirectUri,
    createdAtMs: now.getTime(),
  });
  return state;
}

/** Look up + consume a pending authorization by `state`. Single-
 *  use: a successful lookup deletes the record so the same state
 *  can't be replayed. Returns null when the state is unknown
 *  (CSRF / stale / replayed). */
export function consumePendingAuthorization(state: string, now: Date = new Date()): PendingAuthorization | null {
  sweepStaleAuthorizations(now);
  const entry = _pendingAuthorizations.get(state);
  if (!entry) return null;
  _pendingAuthorizations.delete(state);
  return entry;
}

function sweepStaleAuthorizations(now: Date): void {
  const cutoff = now.getTime() - PENDING_TTL_MS;
  for (const [state, entry] of _pendingAuthorizations) {
    if (entry.createdAtMs < cutoff) _pendingAuthorizations.delete(state);
  }
}

/** Build the Spotify authorize URL. Pure — no side effects, no
 *  randomness; `state` and `codeChallenge` are passed in so the
 *  caller controls them (for replay registration and tests). */
export function buildAuthorizeUrl(params: { clientId: string; redirectUri: string; scopes: readonly string[]; state: string; codeChallenge: string }): string {
  const search = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scopes.join(" "),
    state: params.state,
    code_challenge_method: "S256",
    code_challenge: params.codeChallenge,
  });
  return `https://accounts.spotify.com/authorize?${search.toString()}`;
}

/** Exclusively for tests — wipe the in-memory store between cases. */
export function _resetPendingAuthorizationsForTests(): void {
  _pendingAuthorizations.clear();
}
