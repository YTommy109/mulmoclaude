# Spotify setup

Enabling the mulmoclaude Spotify plugin requires you to register your **own** Spotify Developer Dashboard app (3-5 minutes). This matches the Discord / Telegram bridge convention — a per-user app side-steps redirect-URI port pinning, rate-limit sharing, and privacy concerns that a project-wide shared client ID would introduce.

## What you need

- A Spotify account (Free works)
- The port mulmoclaude is running on (default `3001`, or whatever you passed to `--port`)

## Steps

### 1. Create an app in the Spotify Developer Dashboard

Open [https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and sign in with your Spotify account.

Click **Create app** and fill in:

- **App name**: anything (e.g. `MulmoClaude (local)`)
- **App description**: anything (e.g. `Personal listening data integration`)
- **Redirect URIs**: add and save `http://127.0.0.1:3001/api/spotify/callback` (replace `3001` with whatever port mulmoclaude is on)
- **Which API/SDKs are you planning to use?**: check **Web API**
- Accept the terms, click Save

> **Heads-up**: Spotify matches the redirect URI **exactly**. Use `127.0.0.1`, not `localhost`. Loopback redirects (`http://127.0.0.1` / `http://[::1]`) are exempt from Spotify's HTTPS requirement.

### 2. Copy the Client ID

On the app page, click **Settings** and copy the **Client ID** (you can ignore `Client secret` — the PKCE flow we use doesn't need it).

### 3. Add it to mulmoclaude's `.env`

Open (or create) `~/mulmoclaude/.env` and add:

```
SPOTIFY_CLIENT_ID=paste-here
```

### 4. Restart mulmoclaude

Restart the mulmoclaude server so it picks up `SPOTIFY_CLIENT_ID`.

### 5. Connect

Either ask mulmoclaude in chat to "connect Spotify", or click the **Connect Spotify** button in the plugin View. Spotify will show its consent screen; once you approve, the authorization is persisted to `~/mulmoclaude/config/spotify/tokens.json` and subsequent API calls reuse it automatically.

## Troubleshooting

### `INVALID_CLIENT: Invalid redirect URI`

The redirect URI registered in your Spotify Dashboard doesn't match the port mulmoclaude is currently running on.

1. Check mulmoclaude's startup log for the port (e.g. `listening port=3099`)
2. In the Dashboard Settings, add `http://127.0.0.1:<that port>/api/spotify/callback` to Redirect URIs
3. Save → retry "connect Spotify" from the chat

If you switch `--port` regularly, register the common ports (3001 / 3099 / etc.) all at once.

### `INVALID_CLIENT: Invalid client`

`SPOTIFY_CLIENT_ID` is wrong. Copy the Client ID from the Dashboard again, overwrite the value in `.env`, restart mulmoclaude.

### Token expired / connection broken

Delete `~/mulmoclaude/config/spotify/tokens.json` and click **Connect Spotify** again. Use this whenever Spotify rotates the refresh token, you want to change scopes, or you want to switch Spotify accounts.

### Is the Client ID safe to expose?

The PKCE flow doesn't use a Client Secret in the first place. The Client ID by itself is considered **public** information — but as a habit, don't commit your `.env` to git (mulmoclaude's `.gitignore` excludes `.env` by default).

## What you can read

Read-only v1 surfaces:

- Liked Songs
- Playlist list / tracks within a playlist
- Recently played (last 50, Spotify API ceiling)
- Currently playing

Playback control (play / pause / skip) and write actions (add to liked / create playlist) are landing in a follow-up PR.

## Related docs

- Plan: `plans/feat-spotify-plugin.md`
- Implementation issue: [#1162](https://github.com/receptron/mulmoclaude/issues/1162)
- Official: [Spotify Web API Authorization Guide](https://developer.spotify.com/documentation/web-api/concepts/authorization)
