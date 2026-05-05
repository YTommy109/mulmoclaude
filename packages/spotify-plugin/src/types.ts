// Internal types — server + (future) browser side of the plugin
// share these. Persisted shapes go through Zod parsers; in-memory
// transient shapes (pending OAuth state) are plain interfaces.

import type { z } from "zod";
import type { TokensSchema, ClientConfigSchema, PendingAuthSchema } from "./schemas";

/** Persisted OAuth tokens (`tokens.json`). Refresh-token rotation
 *  policy: when Spotify omits `refreshToken` on a refresh response,
 *  the prior value is kept. `scopes` is the granted scope set so
 *  callers can fail fast on a kind-vs-scope mismatch. */
export type SpotifyTokens = z.infer<typeof TokensSchema>;

/** Persisted client config (`client.json`). User pastes their
 *  Spotify Developer Dashboard Client ID into this file (or
 *  configures it via the View). Per-machine secret. */
export type SpotifyClientConfig = z.infer<typeof ClientConfigSchema>;

/** In-memory record kept between `connect` and `oauthCallback`,
 *  keyed by single-use `state`. Lives in the host process only —
 *  not persisted. */
export type PendingAuthorization = z.infer<typeof PendingAuthSchema>;

/** Refresh-response fields after parsing the raw Spotify token
 *  response. `refreshToken` is optional because Spotify normally
 *  omits it (the prior token stays valid). */
export interface RefreshResponseFields {
  accessToken: string;
  refreshToken?: string;
  expiresInSec: number;
  scopes?: readonly string[];
}

/** Reason codes the plugin returns to the LLM / View when an
 *  operation can't proceed. The dispatch contract documented in
 *  plans/feat-spotify-plugin.md keeps these aligned with the
 *  user-facing `instructions` strings. */
export type SpotifyError =
  | { kind: "client_id_missing"; instructions: string; setupGuide: string }
  | { kind: "not_connected"; instructions: string }
  | { kind: "auth_expired"; detail: string; instructions: string }
  | { kind: "unknown_state"; instructions: string }
  | { kind: "redirect_uri_mismatch"; instructions: string }
  | { kind: "rate_limited"; retryAfterSec: number; instructions: string }
  | { kind: "spotify_api_error"; status: number; body: string; instructions: string };
