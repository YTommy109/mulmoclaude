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

/** Dispatch argument shape — discriminated by `kind`. PR 1 covers
 *  only the OAuth-flavored kinds; PR 2 extends the union with the
 *  listening-data kinds. */
export const DispatchArgsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("connect"),
    /** Absolute URL the browser will be redirected back to after
     *  the consent screen. Computed by the View as
     *  `window.location.origin + "/api/plugins/runtime/" +
     *  encodeURIComponent("@mulmoclaude/spotify-plugin") +
     *  "/oauth/callback"`. */
    redirectUri: z.string().url(),
  }),
  // Forwarded by the host's generic OAuth callback endpoint when
  // Spotify redirects the browser back. The plugin verifies state
  // and exchanges code for tokens; never invoked by the LLM
  // directly, but exposed in the dispatch surface so the host's
  // generic handler can route via a single mechanism.
  z.object({
    kind: z.literal("oauthCallback"),
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal("status") }),
  z.object({ kind: z.literal("diagnose") }),
]);

export type DispatchArgs = z.infer<typeof DispatchArgsSchema>;
