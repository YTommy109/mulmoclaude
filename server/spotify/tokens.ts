// Spotify token persistence (issue #1162).
//
// Layout: a single `tokens.json` under `~/mulmoclaude/config/spotify/`
// holding accessToken / refreshToken / expiresAt / scopes. Atomic
// writes via `writeFileAtomic` so a crash mid-write can't half-finish
// — accessToken is a 1h credential the agent depends on, half-
// written file = "auth_expired" until the user reconnects.
//
// Spotify's refresh response normally OMITS `refresh_token` — that
// means the existing one stays valid. Some flows (rotation) DO
// return a fresh one; the merge below preserves the prior value
// only when the refresh response leaves the field undefined.

import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../utils/files/atomic.js";
import { errorMessage } from "../utils/errors.js";
import { log } from "../system/logger/index.js";
import { getTokensPath } from "./config.js";

const LOG_PREFIX = "spotify/tokens";

/** Persisted shape. `scopes` is a denormalised view of the granted
 *  scope set returned by Spotify on the initial token exchange — the
 *  agent uses it to fail fast on a kind-vs-scope mismatch instead of
 *  letting Spotify return 403 mid-call. */
export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 string. The `client.ts` refresh path treats anything
   *  within `EXPIRY_LEEWAY_MS` as expired so a request that races
   *  the boundary doesn't 401. */
  expiresAt: string;
  scopes: readonly string[];
}

/** Refresh-response shape from Spotify. `refresh_token` is optional;
 *  when omitted the previously-stored one is reused. */
export interface RefreshResponseFields {
  accessToken: string;
  refreshToken?: string;
  expiresInSec: number;
  scopes?: readonly string[];
}

/** Read the token file. Returns null when the file doesn't exist
 *  yet (= "not_connected"); throws on parse / IO failure so the
 *  caller surfaces "auth_expired" and asks for reconnect. */
export async function readTokens(): Promise<SpotifyTokens | null> {
  const tokensPath = getTokensPath();
  if (!existsSync(tokensPath)) return null;
  try {
    const raw = await readFile(tokensPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SpotifyTokens>;
    if (!isCompleteTokens(parsed)) {
      log.warn(LOG_PREFIX, "tokens file is missing required fields", { tokensPath });
      return null;
    }
    return parsed;
  } catch (err) {
    log.error(LOG_PREFIX, "tokens read failed", { tokensPath, error: errorMessage(err) });
    throw err;
  }
}

/** Write the full token record. Creates the parent dir on demand
 *  so the workspace doesn't need a stub `config/spotify/` until the
 *  user actually connects. */
export async function writeTokens(tokens: SpotifyTokens): Promise<void> {
  const tokensPath = getTokensPath();
  mkdirSync(path.dirname(tokensPath), { recursive: true });
  await writeFileAtomic(tokensPath, JSON.stringify(tokens, null, 2));
}

/** Apply a refresh response to the persisted tokens, preserving the
 *  prior `refreshToken` when Spotify omits a fresh one (the common
 *  case). Returns the updated record; the caller persists it. */
export function mergeRefreshResponse(prior: SpotifyTokens, response: RefreshResponseFields, now: Date = new Date()): SpotifyTokens {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken ?? prior.refreshToken,
    expiresAt: new Date(now.getTime() + response.expiresInSec * 1000).toISOString(),
    scopes: response.scopes ?? prior.scopes,
  };
}

function isCompleteTokens(value: Partial<SpotifyTokens>): value is SpotifyTokens {
  return (
    typeof value.accessToken === "string" &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === "string" &&
    value.refreshToken.length > 0 &&
    typeof value.expiresAt === "string" &&
    Array.isArray(value.scopes)
  );
}
