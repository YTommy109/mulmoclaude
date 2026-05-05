// Spotify plugin META — issue #1162.
//
// PR 1 wires only the OAuth side: connect / callback / status.
// `mcpDispatch` and the LLM-facing dispatch route land in PR 2,
// at which point this META gains `mcpDispatch: "dispatch"` and a
// matching `dispatch` row under `apiRoutes`. Since `mcpDispatch`
// is absent here, the codegen produces no server binding for
// spotify yet — the META is read by the host aggregators only
// to register `API_ROUTES.spotify.*` and
// `WORKSPACE_DIRS.spotifyConfig`.

import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageSpotify",
  apiNamespace: "spotify",
  apiRoutes: {
    /** GET /api/spotify/connect — server returns the Spotify
     *  authorize URL (with PKCE challenge + random state). The
     *  caller (View) navigates the browser there. */
    connect: { method: "GET", path: "/connect" },
    /** GET /api/spotify/callback — Spotify redirects the browser
     *  here after the user approves. Bearer-auth-exempt because
     *  external redirects can't carry an Authorization header.
     *  State is validated server-side instead. */
    callback: { method: "GET", path: "/callback" },
    /** GET /api/spotify/status — connection state for the View
     *  (clientIdConfigured, connected, expiresAt, etc.). Does not
     *  expose any token value. */
    status: { method: "GET", path: "/status" },
  },
  workspaceDirs: {
    /** `~/mulmoclaude/config/spotify/` — holds tokens.json plus
     *  cache/{liked,playlists}.json. User backups treat the dir
     *  as a single unit. */
    spotifyConfig: "config/spotify",
  },
});
