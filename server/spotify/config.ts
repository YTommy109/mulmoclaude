// Spotify config helpers (issue #1162). Pure — read env / build
// paths, no I/O. Unit tests mock `process.env` and request shape.

import path from "node:path";
import type { Request } from "express";
import { WORKSPACE_PATHS } from "../workspace/paths.js";

/** Canonical scope set for v1 (read-only). Keep sorted so the
 *  authorize URL is stable across boots — matters for `state`-based
 *  replay protection in some deployments and for debug log diffing. */
export const SPOTIFY_SCOPES: readonly string[] = [
  "playlist-read-private",
  "user-library-read",
  "user-read-currently-playing",
  "user-read-recently-played",
] as const;

/** Returns the user-supplied `SPOTIFY_CLIENT_ID` from env, or null
 *  when unset / blank. Trims to ignore accidental whitespace from
 *  copy-paste. We never log or surface the value itself — callers
 *  pass it to Spotify's authorize / token endpoints and otherwise
 *  treat it as opaque. */
export function getSpotifyClientId(): string | null {
  const raw = process.env.SPOTIFY_CLIENT_ID;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Build the redirect URI Spotify will send the browser back to.
 *  Derived from the inbound request so users running on a non-
 *  default `--port` get the right URL — the redirect URI must
 *  match (exact string) what the user registered in the Spotify
 *  Developer Dashboard, so any drift between server port and
 *  dashboard registration surfaces as a `redirect_uri_mismatch`
 *  on the token exchange (handled in routes/spotify.ts). */
export function buildRedirectUri(req: Pick<Request, "protocol" | "get">): string {
  const host = req.get("host") ?? "127.0.0.1";
  // Express's default `req.protocol` reads `X-Forwarded-Proto` when
  // `app.set("trust proxy", true)` — the server doesn't, so this is
  // the loopback `http` in normal use. Spotify allows http for
  // 127.0.0.1 / [::1] only.
  return `${req.protocol}://${host}/api/spotify/callback`;
}

/** Absolute path to the tokens file. Resolved once per call against
 *  `WORKSPACE_PATHS.spotifyConfig` so a workspace-root override (in
 *  tests) propagates without a module reload. */
export function getTokensPath(): string {
  return path.join(WORKSPACE_PATHS.spotifyConfig, "tokens.json");
}
