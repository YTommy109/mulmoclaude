// Spotify Web API client (issue #1162). Wraps `fetch` with a
// 401 → refresh → retry-once loop and persists the refreshed
// tokens. Higher layers (route handlers, dispatch kinds in PR 2)
// call `spotifyApi(method, path, ...)` and treat the response
// as a regular Response.
//
// Why retry only once: the refresh path itself can fail, and we
// don't want a refresh loop to mask a real auth problem. One
// retry covers the "access token aged out mid-call" case (the
// only legitimate cause of a 401 here); a second 401 means the
// refresh token was revoked / rotated server-side and the user
// must reconnect.

import { ONE_SECOND_MS } from "../utils/time.js";
import { errorMessage } from "../utils/errors.js";
import { log } from "../system/logger/index.js";
import { mergeRefreshResponse, readTokens, writeTokens, type RefreshResponseFields, type SpotifyTokens } from "./tokens.js";
import { getSpotifyClientId } from "./config.js";

const LOG_PREFIX = "spotify/client";

const SPOTIFY_API_BASE = "https://api.spotify.com";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

const FETCH_TIMEOUT_MS = 15 * ONE_SECOND_MS;

/** Treat tokens within this window of expiry as already expired so
 *  a request that races the boundary refreshes proactively instead
 *  of waiting for the 401. */
const EXPIRY_LEEWAY_MS = 30 * ONE_SECOND_MS;

/** Reasons the client returns instead of throwing. The route /
 *  dispatch layer maps these to the user-facing `instructions`
 *  field. Keeps the auth-state machine close to the dispatch
 *  contract documented in plans/feat-spotify-plugin.md. */
export type SpotifyClientError =
  | { kind: "client_id_missing" }
  | { kind: "not_connected" }
  | { kind: "auth_expired"; detail: string }
  | { kind: "rate_limited"; retryAfterSec: number }
  | { kind: "spotify_api_error"; status: number; body: string };

export type SpotifyClientResult<T> = { ok: true; data: T } | { ok: false; error: SpotifyClientError };

/** Token response from `https://accounts.spotify.com/api/token`. */
interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

/** Test seam — replaced in unit tests so we can drive the 401 →
 *  refresh path without touching the network. */
export interface SpotifyClientDeps {
  fetchImpl: typeof globalThis.fetch;
  tokensReader: () => Promise<SpotifyTokens | null>;
  tokensWriter: (tokens: SpotifyTokens) => Promise<void>;
  clientIdReader: () => string | null;
  now: () => Date;
}

const defaultDeps: SpotifyClientDeps = {
  fetchImpl: globalThis.fetch,
  tokensReader: readTokens,
  tokensWriter: writeTokens,
  clientIdReader: getSpotifyClientId,
  now: () => new Date(),
};

/** Make an authenticated Spotify API call. Path is relative to
 *  `https://api.spotify.com` (e.g. `/v1/me/player/recently-played`).
 *  Caller passes a typed result via the generic. */
export async function spotifyApi<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  apiPath: string,
  init: { body?: unknown } = {},
  deps: Partial<SpotifyClientDeps> = {},
): Promise<SpotifyClientResult<T>> {
  const wired: SpotifyClientDeps = { ...defaultDeps, ...deps };
  const clientId = wired.clientIdReader();
  if (!clientId) return { ok: false, error: { kind: "client_id_missing" } };

  const tokens = await wired.tokensReader();
  if (!tokens) return { ok: false, error: { kind: "not_connected" } };

  const proactivelyRefreshed = needsProactiveRefresh(tokens, wired.now()) ? await refreshTokens(tokens, clientId, wired) : { ok: true as const, tokens };
  if (!proactivelyRefreshed.ok) return { ok: false, error: proactivelyRefreshed.error };

  const firstAttempt = await callOnce<T>(method, apiPath, init, proactivelyRefreshed.tokens, wired);
  if (firstAttempt.ok || firstAttempt.error.kind !== "auth_expired") return firstAttempt;

  // 401 reactive refresh. If the proactive branch already ran we
  // wouldn't see a 401 here unless Spotify revoked the token mid-
  // window — try once more, then give up so a revoked refresh
  // token doesn't loop.
  const refreshed = await refreshTokens(proactivelyRefreshed.tokens, clientId, wired);
  if (!refreshed.ok) return { ok: false, error: refreshed.error };
  return callOnce<T>(method, apiPath, init, refreshed.tokens, wired);
}

function needsProactiveRefresh(tokens: SpotifyTokens, now: Date): boolean {
  const expiresAtMs = Date.parse(tokens.expiresAt);
  if (Number.isNaN(expiresAtMs)) return true; // corrupt / unknown — refresh defensively
  return expiresAtMs - now.getTime() <= EXPIRY_LEEWAY_MS;
}

async function callOnce<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  apiPath: string,
  init: { body?: unknown },
  tokens: SpotifyTokens,
  deps: SpotifyClientDeps,
): Promise<SpotifyClientResult<T>> {
  let response: Response;
  try {
    response = await fetchWithDepsTimeout(deps.fetchImpl, `${SPOTIFY_API_BASE}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    return { ok: false, error: { kind: "spotify_api_error", status: 0, body: errorMessage(err) } };
  }
  if (response.status === 401) {
    return { ok: false, error: { kind: "auth_expired", detail: "Spotify returned 401" } };
  }
  if (response.status === 429) {
    const retryAfterSec = Number.parseInt(response.headers.get("Retry-After") ?? "60", 10);
    return { ok: false, error: { kind: "rate_limited", retryAfterSec } };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: { kind: "spotify_api_error", status: response.status, body: body.slice(0, 500) } };
  }
  // 204 No Content (e.g. nowPlaying when nothing is playing) reads as null.
  if (response.status === 204) return { ok: true, data: null as T };
  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: { kind: "spotify_api_error", status: response.status, body: errorMessage(err) } };
  }
}

/** Refresh the access token using the persisted `refreshToken`.
 *  Persists the merged result on success. Returns the refreshed
 *  `SpotifyTokens` for the caller's retry. */
async function refreshTokens(
  tokens: SpotifyTokens,
  clientId: string,
  deps: SpotifyClientDeps,
): Promise<{ ok: true; tokens: SpotifyTokens } | { ok: false; error: SpotifyClientError }> {
  let response: Response;
  try {
    response = await fetchWithDepsTimeout(deps.fetchImpl, SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: clientId,
      }).toString(),
    });
  } catch (err) {
    return { ok: false, error: { kind: "auth_expired", detail: `refresh fetch failed: ${errorMessage(err)}` } };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.warn(LOG_PREFIX, "refresh failed", { status: response.status, body: body.slice(0, 200) });
    return { ok: false, error: { kind: "auth_expired", detail: `refresh returned ${response.status}` } };
  }
  let parsed: RawTokenResponse;
  try {
    parsed = (await response.json()) as RawTokenResponse;
  } catch (err) {
    return { ok: false, error: { kind: "auth_expired", detail: `refresh response parse failed: ${errorMessage(err)}` } };
  }
  const refreshFields = parseRefreshResponse(parsed);
  if (!refreshFields) {
    return { ok: false, error: { kind: "auth_expired", detail: "refresh response missing access_token / expires_in" } };
  }
  const merged = mergeRefreshResponse(tokens, refreshFields, deps.now());
  await deps.tokensWriter(merged);
  return { ok: true, tokens: merged };
}

/** Wrap an injected `fetchImpl` with `AbortController`-based timeout.
 *  Mirrors the existing `fetchWithTimeout` helper but accepts a
 *  `fetchImpl` so unit tests can substitute the network entirely. */
async function fetchWithDepsTimeout(fetchImpl: typeof globalThis.fetch, url: string, init: Parameters<typeof fetch>[1]): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`fetch timed out after ${FETCH_TIMEOUT_MS}ms`, "TimeoutError")), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseRefreshResponse(raw: RawTokenResponse): RefreshResponseFields | null {
  if (typeof raw.access_token !== "string" || raw.access_token.length === 0) return null;
  if (typeof raw.expires_in !== "number" || !Number.isFinite(raw.expires_in)) return null;
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" && raw.refresh_token.length > 0 ? raw.refresh_token : undefined,
    expiresInSec: raw.expires_in,
    scopes: typeof raw.scope === "string" ? raw.scope.split(" ").filter(Boolean) : undefined,
  };
}
