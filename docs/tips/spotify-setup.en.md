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
- **Redirect URIs**: add and save `http://127.0.0.1:3001/api/plugins/runtime/oauth-callback/spotify` (replace `3001` with whatever port mulmoclaude is on)
- **Which API/SDKs are you planning to use?**: check **Web API**
- Accept the terms, click Save

> **Heads-up**: Spotify matches the redirect URI **exactly**. Use `127.0.0.1`, not `localhost`. Loopback redirects (`http://127.0.0.1` / `http://[::1]`) are exempt from Spotify's HTTPS requirement. The trailing `spotify` segment is the OAuth callback alias the plugin declared via its `OAUTH_CALLBACK_ALIAS` named export.

### 2. Copy the Client ID

Click **Settings** on your app's page and copy the **Client ID** (you can ignore `Client secret` — the PKCE flow we use doesn't need it).

### 3. Hand the Client ID to mulmoclaude

The simplest path is to paste the Client ID into the "Configure" form in the plugin View — the View writes it to ~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin/client.json for you. If you'd rather write the file directly:

```bash
# %40 = '@', %2F = '/' (URL-encoded). `runtime.files.config` runs the
# package name through `encodeURIComponent` and uses the result as a
# single directory segment, so the on-disk layout is one level deep
# under the encoded name — NOT the literal `@scope/name` two-level
# tree you'd expect from the npm name.
mkdir -p ~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin
cat > ~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin/client.json <<'EOF'
{
  "clientId": "paste-here"
}
EOF
```

### 4. Restart mulmoclaude

Restart the server so the plugin picks up `client.json`.

### 5. Connect

Ask mulmoclaude in chat to "connect Spotify". The LLM calls `manageSpotify({ kind: "connect", redirectUri: "..." })` and gives you the consent URL. Approve, and the authorization persists to `~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin/tokens.json` for subsequent API calls.

## Troubleshooting

### `INVALID_CLIENT: Invalid redirect URI`

The redirect URI registered in your Spotify Dashboard doesn't match the port mulmoclaude is currently running on.

1. Check mulmoclaude's startup log for the port (e.g. `listening port=3099`)
2. In the Dashboard Settings, add `http://127.0.0.1:<that port>/api/plugins/runtime/oauth-callback/spotify` to Redirect URIs
3. Save → retry "connect Spotify"

If you switch `--port` regularly, register the common ports (3001 / 3099 / etc.) all at once.

### `INVALID_CLIENT: Invalid client`

`client.json` has the wrong value. Copy the Client ID from the Dashboard again, overwrite `client.json`, restart mulmoclaude.

### Token expired / connection broken

Delete `~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin/tokens.json` and click **Connect Spotify** again. Same recovery for refresh-token rotation, scope changes, or switching Spotify accounts.

### Is the Client ID safe to expose?

The PKCE flow doesn't use a Client Secret in the first place. The Client ID by itself is considered **public** information — but as a habit, don't commit `client.json` (the workspace dir is outside git).

## What you can read

| Feature | Free / Open | Premium |
|---|---|---|
| Liked Songs | ✓ | ✓ |
| Playlist list / tracks within a playlist | ✓ | ✓ |
| Recently played (last 50, Spotify API ceiling) | ✓ | ✓ |
| Currently playing (display only) | ✓ | ✓ |
| Search (track / artist / album / playlist) | ✓ | ✓ |
| Device list (`getDevices`) | ✓ | ✓ |
| **Playback control (play / pause / next / prev / seek / volume / transferPlayback)** | ✗ | ✓ |

Playback controls require **Spotify Premium** (Spotify Web API restriction). For Free / Open accounts the Player Controls panel is hidden, and LLM-issued `play` etc. return a `premium_required` error.

Write actions for the user's library (add to liked / create playlist / playlist edits) land in a follow-up PR.

## Reconnecting after PR 3 (existing users)

PR 3 added two OAuth scopes (`user-read-playback-state`, `user-modify-playback-state`). Users who connected during PR 1 / PR 2 will see `403 Insufficient client scope` on player calls — click Reconnect in the View (or delete `tokens.json` and Connect again) to re-authorise with the new scopes.

## Related docs

- Plan: `plans/done/feat-spotify-plugin.md`
- Plugin implementation: `packages/spotify-plugin/`
- Implementation issue: [#1162](https://github.com/receptron/mulmoclaude/issues/1162)
- Runtime plugin docs: [`docs/plugin-runtime.md`](../plugin-runtime.md)
- Official: [Spotify Web API Authorization Guide](https://developer.spotify.com/documentation/web-api/concepts/authorization)
