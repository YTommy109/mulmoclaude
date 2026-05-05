// Tool schema for the Spotify plugin (issue #1162). Lives in its
// own module so both the server entry (`index.ts`) and the browser
// entry (`vue.ts`) can import it without dragging in handler code.
//
// `name: "manageSpotify" as const` narrows the literal so
// `definePlugin`'s strict-handler check requires a matching named
// export. PR 1 ships only the OAuth-flavored kinds (`connect`,
// `oauthCallback`, `status`, `diagnose`); the listening-data kinds
// (`liked` / `playlists` / `playlistTracks` / `recent` /
// `nowPlaying`) land in PR 2.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageSpotify" as const,
  description: "Read-only access to the user's Spotify listening data — Liked Songs, playlists, recently played, currently playing.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: [
          "connect",
          "oauthCallback",
          "status",
          "diagnose",
          // PR 2:
          // "liked", "playlists", "playlistTracks", "recent",
          // "nowPlaying",
        ],
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
    },
    required: ["kind"],
  },
};
