// Zod schemas for both the on-disk persisted shapes and the
// dispatch arg shape. Centralised so the parsers / type inference
// stay in lock-step.

import { z } from "zod";

/** Single source of truth for `manageSpotify`'s `kind` discriminator.
 *  `definition.ts` derives the LLM-facing enum from `LLM_CALLABLE_KINDS`,
 *  the Zod union below uses these same literals — the previous setup
 *  duplicated the strings across both surfaces and risked drift
 *  (CodeRabbit review on PR #1166). */
export const SPOTIFY_KINDS = {
  connect: "connect",
  oauthCallback: "oauthCallback",
  status: "status",
  diagnose: "diagnose",
  configure: "configure",
  liked: "liked",
  playlists: "playlists",
  playlistTracks: "playlistTracks",
  recent: "recent",
  nowPlaying: "nowPlaying",
  search: "search",
  // Player Controls (PR 3). All except `getDevices` require the
  // user to have Spotify Premium — the plugin gates them at the
  // dispatch boundary by reading `/v1/me/{product}` and refusing
  // with `premium_required` for free-tier accounts.
  play: "play",
  pause: "pause",
  next: "next",
  previous: "previous",
  seek: "seek",
  setVolume: "setVolume",
  transferPlayback: "transferPlayback",
  getDevices: "getDevices",
} as const;

/** Kinds the LLM is allowed to invoke directly (= advertised in
 *  `TOOL_DEFINITION.parameters.kind.enum`). `configure` is omitted
 *  intentionally — it's a View-only action that writes the user's
 *  Client ID; exposing it to the LLM would invite the model to
 *  mutate user secrets. */
export const LLM_CALLABLE_KINDS = [
  SPOTIFY_KINDS.connect,
  SPOTIFY_KINDS.oauthCallback,
  SPOTIFY_KINDS.status,
  SPOTIFY_KINDS.diagnose,
  SPOTIFY_KINDS.liked,
  SPOTIFY_KINDS.playlists,
  SPOTIFY_KINDS.playlistTracks,
  SPOTIFY_KINDS.recent,
  SPOTIFY_KINDS.nowPlaying,
  SPOTIFY_KINDS.search,
  SPOTIFY_KINDS.play,
  SPOTIFY_KINDS.pause,
  SPOTIFY_KINDS.next,
  SPOTIFY_KINDS.previous,
  SPOTIFY_KINDS.seek,
  SPOTIFY_KINDS.setVolume,
  SPOTIFY_KINDS.transferPlayback,
  SPOTIFY_KINDS.getDevices,
] as const;

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
    kind: z.literal(SPOTIFY_KINDS.connect),
    /** Absolute URL the browser will be redirected back to after the
     *  consent screen. Computed by the View as
     *  `${window.location.origin}/api/plugins/runtime/oauth-callback/<alias>`
     *  where `<alias>` matches the plugin's `OAUTH_CALLBACK_ALIAS`
     *  named export. */
    redirectUri: z.string().url(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.oauthCallback),
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal(SPOTIFY_KINDS.status) }),
  z.object({ kind: z.literal(SPOTIFY_KINDS.diagnose) }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.configure),
    /** Spotify Developer Dashboard Client ID. PKCE flow needs no
     *  Client Secret. Validated lightly — Spotify's IDs are
     *  alphanumeric, but we trust the user not to paste random
     *  garbage and let the token endpoint reject malformed values. */
    clientId: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.liked),
    /** 1-50, default 50 (the Spotify endpoint's hard cap). */
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({ kind: z.literal(SPOTIFY_KINDS.playlists) }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.playlistTracks),
    /** Spotify playlist ID (the bare ID, not a URI). The View
     *  obtains it from the prior `playlists` response. */
    playlistId: z.string().min(1).max(64),
    /** 1-100, default 100 (the Spotify endpoint's hard cap). */
    limit: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.recent),
    /** 1-50, default 50 (the Spotify endpoint's hard cap). */
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({ kind: z.literal(SPOTIFY_KINDS.nowPlaying) }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.search),
    /** Free-form query — Spotify supports field filters
     *  (`artist:Bach`, `year:2020`) and quoted phrases. `.trim()`
     *  before `min(1)` so a whitespace-only query (like `"   "`)
     *  fails validation here instead of slipping through to
     *  Spotify and coming back as a 4xx (Codex review on
     *  PR #1168). */
    query: z.string().trim().min(1).max(200),
    /** Categories to include. Spotify's `/v1/search` accepts
     *  `track`, `artist`, `album`, `playlist`. Default is all four
     *  so a casual `manageSpotify({ kind: "search", query })` from
     *  the LLM gets a useful spread without needing to specify. */
    types: z
      .array(z.enum(["track", "artist", "album", "playlist"]))
      .min(1)
      .max(4)
      .optional(),
    /** 1-50, default 10 (per category). Lower than the listening
     *  kinds because search results are more diverse + the LLM
     *  context window holds N results × M categories. */
    limit: z.number().int().min(1).max(50).optional(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.play),
    /** Optional: target a specific device. Defaults to the user's
     *  active device. */
    deviceId: z.string().min(1).max(128).optional(),
    /** Optional: a Spotify URI for an album / playlist / artist
     *  context to play (e.g. `spotify:playlist:abc123`). Mutually
     *  exclusive with `trackUris` — the dispatcher in `index.ts`
     *  rejects when both are set, because Zod's
     *  `discriminatedUnion` doesn't accept refined arms (refining
     *  this arm would corrupt the kind discriminator). */
    contextUri: z.string().min(1).max(256).optional(),
    /** Optional: explicit list of track URIs to queue
     *  (`spotify:track:abc123`). Mutually exclusive with
     *  `contextUri` (see comment above). */
    trackUris: z.array(z.string().min(1).max(256)).min(1).max(100).optional(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.pause),
    deviceId: z.string().min(1).max(128).optional(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.next),
    deviceId: z.string().min(1).max(128).optional(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.previous),
    deviceId: z.string().min(1).max(128).optional(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.seek),
    /** Position in milliseconds. Spotify caps at the track length;
     *  positions past the end stop playback. */
    positionMs: z.number().int().min(0).max(86_400_000),
    deviceId: z.string().min(1).max(128).optional(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.setVolume),
    /** 0-100 inclusive. */
    volumePercent: z.number().int().min(0).max(100),
    deviceId: z.string().min(1).max(128).optional(),
  }),
  z.object({
    kind: z.literal(SPOTIFY_KINDS.transferPlayback),
    /** Spotify ID of the device to transfer to. Get from `getDevices`. */
    deviceId: z.string().min(1).max(128),
    /** When true, playback continues after transfer. Default false
     *  (matches Spotify's API default). */
    play: z.boolean().optional(),
  }),
  z.object({ kind: z.literal(SPOTIFY_KINDS.getDevices) }),
]);

export type DispatchArgs = z.infer<typeof DispatchArgsSchema>;
