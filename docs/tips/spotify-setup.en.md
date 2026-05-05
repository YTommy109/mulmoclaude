# Spotify setup

Enabling the mulmoclaude Spotify plugin (`@mulmoclaude/spotify-plugin`) requires you to register your **own** Spotify Developer Dashboard app (3-5 minutes). This matches the Discord / Telegram bridge convention — a per-user app side-steps redirect-URI port pinning, rate-limit sharing, and privacy concerns that a project-wide shared client ID would introduce.

## What you need

- A Spotify account (Free works)
- The port mulmoclaude is running on (default `3001`, or whatever you passed to `--port`)

## Steps

### 1. Create an app in the Spotify Developer Dashboard

Open [https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and sign in.

Click **Create app** and fill in:

- **App name**: anything (e.g. `MulmoClaude (local)`)
- **App description**: anything (e.g. `Personal listening data integration`)
- **Redirect URIs**: add and save `http://127.0.0.1:3001/api/plugins/runtime/%40mulmoclaude%2Fspotify-plugin/oauth/callback` (replace `3001` with whatever port mulmoclaude is on)
- **Which API/SDKs are you planning to use?**: check **Web API**
- Accept the terms, click Save

> **Heads-up**: Spotify matches the redirect URI **exactly**. Use `127.0.0.1`, not `localhost`. Loopback redirects (`http://127.0.0.1` / `http://[::1]`) are exempt from Spotify's HTTPS requirement. `%40` / `%2F` are the URL-encoded forms of `@` / `/` — needed because the plugin name (`@mulmoclaude/spotify-plugin`) appears in the URL path.

### 2. Copy the Client ID

Click **Settings** on your app's page and copy the **Client ID** (you can ignore `Client secret` — the PKCE flow we use doesn't need it).

### 3. Hand the Client ID to mulmoclaude

PR 2 will let you paste the Client ID into a "Configure" form in the plugin View. For PR 1 you write the config file directly:

```bash
mkdir -p ~/mulmoclaude/config/plugins/@mulmoclaude/spotify-plugin
cat > ~/mulmoclaude/config/plugins/@mulmoclaude/spotify-plugin/client.json <<'EOF'
{
  "clientId": "paste-here"
}
EOF
```

### 4. Restart mulmoclaude

Restart the server so the plugin picks up `client.json`.

### 5. Connect

Ask mulmoclaude in chat to "connect Spotify". The LLM calls `manageSpotify({ kind: "connect", redirectUri: "..." })` and gives you the consent URL. Approve, and the authorization persists to `~/mulmoclaude/config/plugins/@mulmoclaude/spotify-plugin/tokens.json` for subsequent API calls.

## Troubleshooting

### `INVALID_CLIENT: Invalid redirect URI`

The redirect URI registered in your Spotify Dashboard doesn't match the port mulmoclaude is currently running on.

1. Check mulmoclaude's startup log for the port (e.g. `listening port=3099`)
2. In the Dashboard Settings, add `http://127.0.0.1:<that port>/api/plugins/runtime/%40mulmoclaude%2Fspotify-plugin/oauth/callback` to Redirect URIs
3. Save → retry "connect Spotify"

If you switch `--port` regularly, register the common ports (3001 / 3099 / etc.) all at once.

### `INVALID_CLIENT: Invalid client`

`client.json` has the wrong value. Copy the Client ID from the Dashboard again, overwrite `client.json`, restart mulmoclaude.

### Token expired / connection broken

Delete `~/mulmoclaude/config/plugins/@mulmoclaude/spotify-plugin/tokens.json` and click **Connect Spotify** again. Same recovery for refresh-token rotation, scope changes, or switching Spotify accounts.

### Is the Client ID safe to expose?

The PKCE flow doesn't use a Client Secret in the first place. The Client ID by itself is considered **public** information — but as a habit, don't commit `client.json` (the workspace dir is outside git).

## What you can read

Read-only v1 surfaces:

- Liked Songs
- Playlist list / tracks within a playlist
- Recently played (last 50, Spotify API ceiling)
- Currently playing

Playback control (play / pause / skip) and write actions (add to liked / create playlist) land in a follow-up PR.

## Related docs

- Plan: `plans/feat-spotify-plugin.md`
- Plugin implementation: `packages/spotify-plugin/`
- Implementation issue: [#1162](https://github.com/receptron/mulmoclaude/issues/1162)
- Runtime plugin docs: [`docs/plugin-runtime.md`](../plugin-runtime.md)
- Official: [Spotify Web API Authorization Guide](https://developer.spotify.com/documentation/web-api/concepts/authorization)
