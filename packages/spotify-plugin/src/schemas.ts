// Zod schemas for both the on-disk persisted shapes and the
// dispatch arg shape. Centralised so the parsers / type inference
// stay in lock-step.

import { z } from "zod";

/** Persisted at `runtime.files.config/tokens.json`. Per-machine
 *  secret — not synced via mulmoclaude's backup story. */
export const TokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** ISO-8601 string. The client's proactive-refresh path treats
   *  anything within `EXPIRY_LEEWAY_MS` of this value as expired. */
  expiresAt: z.string().min(1),
  scopes: z.array(z.string()),
});

/** Persisted at `runtime.files.config/client.json`. The user
 *  registers their own Spotify Developer Dashboard app and writes
 *  the Client ID here (PKCE flow doesn't need a secret). */
export const ClientConfigSchema = z.object({
  clientId: z.string().min(1),
});

/** In-memory record kept between `connect` and `oauthCallback`. */
export const PendingAuthSchema = z.object({
  codeVerifier: z.string(),
  redirectUri: z.string(),
  /** Epoch ms. The OAuth helpers sweep entries older than the
   *  pending-auth TTL on each call. */
  createdAtMs: z.number(),
});

/** Dispatch argument shape — discriminated by `kind`. PR 1 covered
 *  only the OAuth-flavored kinds; PR 2 adds the listening-data
 *  kinds plus a View-only `configure` action.
 *
 *  `configure` is excluded from `TOOL_DEFINITION.parameters.kind`
 *  enum because it's intended for the View's "Configure" form, not
 *  for the LLM. It still rides the same dispatch surface so the
 *  View doesn't need a separate endpoint. */
export const DispatchArgsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("connect"),
    /** Absolute URL the browser will be redirected back to after the
     *  consent screen. Computed by the View as
     *  `${window.location.origin}/api/plugins/runtime/oauth-callback/<alias>`
     *  where `<alias>` matches the plugin's `OAUTH_CALLBACK_ALIAS`
     *  named export. */
    redirectUri: z.string().url(),
  }),
  z.object({
    kind: z.literal("oauthCallback"),
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal("status") }),
  z.object({ kind: z.literal("diagnose") }),
  z.object({
    kind: z.literal("configure"),
    /** Spotify Developer Dashboard Client ID. PKCE flow needs no
     *  Client Secret. Validated lightly — Spotify's IDs are
     *  alphanumeric, but we trust the user not to paste random
     *  garbage and let the token endpoint reject malformed values. */
    clientId: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal("liked"),
    /** 1-50, default 50 (the Spotify endpoint's hard cap). */
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({ kind: z.literal("playlists") }),
  z.object({
    kind: z.literal("playlistTracks"),
    /** Spotify playlist ID (the bare ID, not a URI). The View
     *  obtains it from the prior `playlists` response. */
    playlistId: z.string().min(1).max(64),
    /** 1-100, default 100 (the Spotify endpoint's hard cap). */
    limit: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    kind: z.literal("recent"),
    /** 1-50, default 50 (the Spotify endpoint's hard cap). */
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({ kind: z.literal("nowPlaying") }),
]);

export type DispatchArgs = z.infer<typeof DispatchArgsSchema>;
