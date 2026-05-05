// Tool schema for the Spotify plugin (issue #1162).
//
// The kinds advertised here are the ones the LLM is expected to
// invoke. `configure` is intentionally absent from the enum because
// it's a View-only action (the Configure form posts a plain Client
// ID through the same dispatch surface, but exposing it to the LLM
// would invite the model to mutate user secrets). The plugin's Zod
// `DispatchArgsSchema` still accepts it.

import { LLM_CALLABLE_KINDS } from "./schemas";

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageSpotify" as const,
  description: "Read-only access to the user's Spotify listening data — Liked Songs, playlists, recently played, currently playing.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: [...LLM_CALLABLE_KINDS],
        description: "Action to perform.",
      },
      // `connect` args
      redirectUri: {
        type: "string",
        description:
          "Absolute URL the browser will be sent back to after the user approves Spotify's consent screen. Must be one of the Redirect URIs registered in the user's Spotify Developer Dashboard.",
      },
      // `oauthCallback` args (forwarded by host's generic callback endpoint)
      code: { type: "string" },
      state: { type: "string" },
      error: { type: "string" },
      // `liked` / `recent` / `playlistTracks`
      limit: {
        type: "number",
        description: "Maximum items to return. Liked / recent: 1-50 (default 50). PlaylistTracks: 1-100 (default 100).",
      },
      // `playlistTracks`
      playlistId: {
        type: "string",
        description: "Spotify playlist ID (bare ID, not a URI). Obtained from a prior `playlists` response.",
      },
      // `search`
      query: {
        type: "string",
        description: "Search query. Spotify supports field filters (`artist:Bach`, `year:2020`, `genre:jazz`) and quoted phrases.",
      },
      types: {
        type: "array",
        items: { type: "string", enum: ["track", "artist", "album", "playlist"] },
        description: "Categories to search. Default = all four.",
      },
    },
    required: ["kind"],
  },
};
