// Spotify plugin — server side (issue #1162).
//
// PR 1 ships only the OAuth-flavored kinds:
//   - `connect`        — generate authorize URL + register PKCE pending auth
//   - `oauthCallback`  — invoked by the host's generic OAuth callback
//                        endpoint after Spotify redirects the browser back;
//                        validates state, exchanges code for tokens, persists
//   - `status`         — connection state for the View (no token values)
//   - `diagnose`       — verbose diagnostic for the LLM to surface to the
//                        user when something is misconfigured
//
// PR 2 extends the dispatch union with the listening-data kinds
// (`liked` / `playlists` / `playlistTracks` / `recent` / `nowPlaying`)
// and ships a Vue View / Preview.
//
// Everything that touches disk goes through `runtime.files.config`
// (per-machine secret), every external HTTP call uses `runtime.fetch`
// with an explicit `allowedHosts` allowlist. The eslint preset bans
// `node:fs` / `node:path` / direct `fetch` so platform bypasses
// surface at lint time.

import { definePlugin } from "gui-chat-protocol";

import { TOOL_DEFINITION } from "./definition";
import { DispatchArgsSchema, type DispatchArgs } from "./schemas";
import { buildAuthorizeUrl, consumePendingAuthorization, deriveCodeChallenge, generateRandomToken, registerPendingAuthorization } from "./oauth";
import { readClientConfig, readTokens, writeTokens } from "./tokens";
import { ONE_SECOND_MS } from "./time";
import type { SpotifyTokens } from "./types";

export { TOOL_DEFINITION };

// Short, URL-safe alias the host registers as
// `/api/plugins/runtime/oauth-callback/:alias`. Spotify's Dashboard
// rejects redirect URIs that contain percent-encoded path characters
// (the natural shape when `:pkg` is `@mulmoclaude/spotify-plugin`), so
// each OAuth-using runtime plugin declares its own alphanumeric alias.
// Collisions with other plugins are detected at boot and surfaced as
// startup diagnostics.
export const OAUTH_CALLBACK_ALIAS = "spotify";

/** Read-only scope set for v1. Sorted so the authorize URL is
 *  stable across boots. */
const SPOTIFY_SCOPES: readonly string[] = ["playlist-read-private", "user-library-read", "user-read-currently-playing", "user-read-recently-played"] as const;

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_TOKEN_HOST = "accounts.spotify.com";

const TOKEN_EXCHANGE_TIMEOUT_MS = 15 * ONE_SECOND_MS;

const CLIENT_ID_MISSING_INSTRUCTIONS = [
  "Spotify の Client ID が未設定です。",
  "",
  "1. https://developer.spotify.com/dashboard を開いて Spotify アカウントでログイン",
  "2. 「Create app」 → Redirect URIs に http://127.0.0.1:<PORT>/api/plugins/runtime/oauth-callback/spotify を追加 (PORT は mulmoclaude が動いているポート)",
  "3. Web API をチェックして保存",
  "4. Client ID をコピー",
  "5. plugin View の「Configure」で貼り付ける",
  "",
  "詳細: docs/tips/spotify-setup.md",
].join("\n");

interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

export default definePlugin(({ files, log, fetch: runtimeFetch, pubsub }) => {
  return {
    TOOL_DEFINITION,

    async manageSpotify(rawArgs: unknown) {
      const parsed = DispatchArgsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return {
          ok: false,
          error: "invalid_args",
          message: `Invalid arguments: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        };
      }
      const args: DispatchArgs = parsed.data;
      switch (args.kind) {
        case "connect":
          return handleConnect(args.redirectUri);
        case "oauthCallback":
          return handleOauthCallback({ code: args.code, state: args.state, error: args.error });
        case "status":
          return handleStatus();
        case "diagnose":
          return handleDiagnose();
        default: {
          const exhaustive: never = args;
          throw new Error(`Unhandled kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };

  // ───────────────────────────────────────────────────────────
  // Handlers (closures over runtime)
  // ───────────────────────────────────────────────────────────

  async function handleConnect(redirectUri: string) {
    const clientConfig = await readClientConfig(files.config);
    if (!clientConfig) {
      return {
        ok: false,
        error: "client_id_missing",
        message: "Spotify Client ID が未設定です。詳細は instructions を参照してください。",
        instructions: CLIENT_ID_MISSING_INSTRUCTIONS,
      };
    }
    const codeVerifier = generateRandomToken();
    const codeChallenge = await deriveCodeChallenge(codeVerifier);
    const state = registerPendingAuthorization(codeVerifier, redirectUri);
    const authorizeUrl = buildAuthorizeUrl({
      clientId: clientConfig.clientId,
      redirectUri,
      scopes: SPOTIFY_SCOPES,
      state,
      codeChallenge,
    });
    return {
      ok: true,
      message: "Spotify の同意画面の URL を生成しました。ブラウザで開いてください。",
      data: { authorizeUrl },
    };
  }

  async function handleOauthCallback(input: { code?: string; state?: string; error?: string }) {
    if (input.error) {
      log.info("user denied authorization", { error: input.error });
      return {
        ok: false,
        error: "auth_denied",
        message: `Spotify からの認可が拒否されました: ${input.error}`,
        html: renderCallbackHtml({ title: "Spotify authorization denied", body: `Spotify returned: ${input.error}` }),
      };
    }
    if (!input.code || !input.state) {
      return {
        ok: false,
        error: "invalid_callback",
        message: "Callback request was missing `code` or `state`.",
        html: renderCallbackHtml({ title: "Invalid callback", body: "Missing `code` or `state` query parameter." }),
      };
    }
    const pending = consumePendingAuthorization(input.state);
    if (!pending) {
      return {
        ok: false,
        error: "unknown_state",
        message: "この認可リクエストは mulmoclaude から開始されたものではない、または期限切れです。",
        instructions: "plugin View の「Connect」を再度押してください。",
        html: renderCallbackHtml({
          title: "Unknown state",
          body: "This authorization request was not initiated by mulmoclaude (or it expired). Please retry from the plugin View.",
        }),
      };
    }
    const clientConfig = await readClientConfig(files.config);
    if (!clientConfig) {
      return {
        ok: false,
        error: "client_id_missing",
        message: "Spotify Client ID が未設定です。",
        instructions: CLIENT_ID_MISSING_INSTRUCTIONS,
        html: renderCallbackHtml({ title: "Spotify client ID not configured", body: CLIENT_ID_MISSING_INSTRUCTIONS }),
      };
    }
    try {
      const tokens = await exchangeCodeForTokens({
        code: input.code,
        clientId: clientConfig.clientId,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
      });
      await writeTokens(files.config, tokens);
      pubsub.publish("connected", { scopes: tokens.scopes });
      log.info("tokens written", { scopes: tokens.scopes });
      return {
        ok: true,
        message: "Spotify を接続しました。",
        html: renderCallbackHtml({ title: "Spotify connected", body: "You can close this window and return to mulmoclaude." }),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.error("token exchange failed", { error: detail });
      const instructions = `Token exchange failed: ${detail}\n\nThis usually means the Redirect URI registered in your Spotify Developer Dashboard does not match the URL mulmoclaude is using:\n${pending.redirectUri}`;
      return {
        ok: false,
        error: "token_exchange_failed",
        message: detail,
        instructions,
        html: renderCallbackHtml({ title: "Token exchange failed", body: instructions }),
      };
    }
  }

  async function handleStatus() {
    const clientConfig = await readClientConfig(files.config);
    const tokens = await readTokens(files.config);
    return {
      ok: true,
      message: tokens ? "Connected." : clientConfig ? "Client ID is configured but you haven't connected yet." : "Client ID is not configured.",
      data: {
        clientIdConfigured: clientConfig !== null,
        connected: tokens !== null,
        expiresAt: tokens?.expiresAt ?? null,
        scopes: tokens?.scopes ?? [],
      },
    };
  }

  async function handleDiagnose() {
    const clientConfig = await readClientConfig(files.config);
    const tokens = await readTokens(files.config);
    return {
      ok: true,
      message: "See `data` for the connection diagnostics.",
      data: {
        clientIdConfigured: clientConfig !== null,
        tokensPresent: tokens !== null,
        expiresAt: tokens?.expiresAt ?? null,
        scopes: tokens?.scopes ?? [],
        // Never return the actual token / client_id values — diagnose
        // is meant for the LLM to read aloud.
      },
    };
  }

  async function exchangeCodeForTokens(params: { code: string; clientId: string; codeVerifier: string; redirectUri: string }): Promise<SpotifyTokens> {
    const response = await runtimeFetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: params.clientId,
        code_verifier: params.codeVerifier,
      }).toString(),
      timeoutMs: TOKEN_EXCHANGE_TIMEOUT_MS,
      allowedHosts: [SPOTIFY_TOKEN_HOST],
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify token endpoint returned ${response.status}: ${body.slice(0, 300)}`);
    }
    const raw = (await response.json()) as RawTokenResponse;
    if (typeof raw.access_token !== "string" || raw.access_token.length === 0) {
      throw new Error("Spotify response missing access_token");
    }
    if (typeof raw.refresh_token !== "string" || raw.refresh_token.length === 0) {
      throw new Error("Spotify response missing refresh_token");
    }
    if (typeof raw.expires_in !== "number" || !Number.isFinite(raw.expires_in)) {
      throw new Error("Spotify response missing expires_in");
    }
    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresAt: new Date(Date.now() + raw.expires_in * ONE_SECOND_MS).toISOString(),
      scopes: typeof raw.scope === "string" ? raw.scope.split(" ").filter(Boolean) : [...SPOTIFY_SCOPES],
    };
  }
});

function renderCallbackHtml(params: { title: string; body: string }): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(params.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#111}h1{margin-bottom:1rem}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:.5rem}</style>
<h1>${escapeHtml(params.title)}</h1>
<pre>${escapeHtml(params.body)}</pre>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
