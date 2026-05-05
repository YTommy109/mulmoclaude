// Spotify OAuth routes (issue #1162, PR 1).
//
// Three endpoints:
//   GET  /api/spotify/connect   — issues a fresh authorize URL
//   GET  /api/spotify/callback  — receives Spotify's redirect, exchanges
//                                 the code for tokens, persists them.
//                                 Bearer-auth-EXEMPT (the browser comes
//                                 back from accounts.spotify.com and
//                                 can't carry an Authorization header);
//                                 CSRF protection comes from the
//                                 single-use `state` registered in
//                                 oauth.ts on the connect side.
//   GET  /api/spotify/status    — connection state for the View. Never
//                                 returns the tokens themselves.
//
// The LLM-facing dispatch (POST /api/spotify) lands in PR 2; this
// file deliberately stops at the OAuth surface.

import { Router, type Request, type Response } from "express";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { ONE_SECOND_MS } from "../../utils/time.js";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { buildRedirectUri, getSpotifyClientId, SPOTIFY_SCOPES } from "../../spotify/config.js";
import { buildAuthorizeUrl, consumePendingAuthorization, deriveCodeChallenge, generateRandomToken, registerPendingAuthorization } from "../../spotify/oauth.js";
import { readTokens, writeTokens, type SpotifyTokens } from "../../spotify/tokens.js";

const LOG_PREFIX = "spotify/routes";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const TOKEN_EXCHANGE_TIMEOUT_MS = 15 * ONE_SECOND_MS;

const router = Router();

/** GET /api/spotify/connect → { authorizeUrl } */
bindRoute(router, API_ROUTES.spotify.connect, (req: Request, res: Response) => {
  const clientId = getSpotifyClientId();
  if (!clientId) {
    res.status(400).json({
      ok: false,
      error: "client_id_missing",
      instructions: clientIdMissingInstructions(),
    });
    return;
  }
  const codeVerifier = generateRandomToken();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const redirectUri = buildRedirectUri(req);
  const state = registerPendingAuthorization(codeVerifier, redirectUri);
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri,
    scopes: SPOTIFY_SCOPES,
    state,
    codeChallenge,
  });
  res.json({ ok: true, authorizeUrl });
});

/** GET /api/spotify/callback?code=&state= → HTML success/error page.
 *  The browser is currently on accounts.spotify.com → 302 → here.
 *  We render plain text (the View polls `/status` to detect success);
 *  fancier UX happens in PR 2 once the View is in place. */
bindRoute(router, API_ROUTES.spotify.callback, async (req: Request, res: Response) => {
  const { code, state, error: spotifyError } = req.query;
  if (typeof spotifyError === "string" && spotifyError.length > 0) {
    log.info(LOG_PREFIX, "user denied authorization", { error: spotifyError });
    sendCallbackHtml(res, 400, "Spotify authorization denied", `Spotify returned: ${escapeHtml(spotifyError)}`);
    return;
  }
  if (typeof code !== "string" || typeof state !== "string") {
    sendCallbackHtml(res, 400, "Invalid callback", "Missing `code` or `state` query parameter.");
    return;
  }
  const pending = consumePendingAuthorization(state);
  if (!pending) {
    sendCallbackHtml(
      res,
      400,
      "Unknown state",
      "This authorization request was not initiated by mulmoclaude (or it expired). Please retry from the plugin View.",
    );
    return;
  }
  const clientId = getSpotifyClientId();
  if (!clientId) {
    sendCallbackHtml(res, 400, "Spotify client ID not configured", clientIdMissingInstructions());
    return;
  }
  try {
    const tokens = await exchangeCodeForTokens({ code, clientId, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri });
    mkdirSync(path.dirname(WORKSPACE_PATHS.spotifyConfig), { recursive: true });
    await writeTokens(tokens);
    log.info(LOG_PREFIX, "tokens written", { scopes: tokens.scopes });
    sendCallbackHtml(res, 200, "Spotify connected", "You can close this window and return to mulmoclaude.");
  } catch (err) {
    log.error(LOG_PREFIX, "token exchange failed", { error: errorMessage(err) });
    sendCallbackHtml(
      res,
      500,
      "Token exchange failed",
      `${escapeHtml(errorMessage(err))}\n\nThis usually means the Redirect URI registered in your Spotify Developer Dashboard does not match the URL mulmoclaude is using:\n${escapeHtml(pending.redirectUri)}`,
    );
  }
});

/** GET /api/spotify/status → connection diagnostics for the View.
 *  Never exposes the token values. */
bindRoute(router, API_ROUTES.spotify.status, async (_req: Request, res: Response) => {
  const clientIdConfigured = getSpotifyClientId() !== null;
  let tokens: SpotifyTokens | null;
  try {
    tokens = await readTokens();
  } catch (err) {
    res.json({
      ok: true,
      clientIdConfigured,
      connected: false,
      tokensReadable: false,
      readError: errorMessage(err),
    });
    return;
  }
  res.json({
    ok: true,
    clientIdConfigured,
    connected: tokens !== null,
    tokensReadable: true,
    expiresAt: tokens?.expiresAt ?? null,
    scopes: tokens?.scopes ?? [],
  });
});

interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

async function exchangeCodeForTokens(params: { code: string; clientId: string; codeVerifier: string; redirectUri: string }): Promise<SpotifyTokens> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("token exchange timed out", "TimeoutError")), TOKEN_EXCHANGE_TIMEOUT_MS);
  // Local alias: in this file `Response` is `express.Response` (the
  // route handler's res type), so the global fetch `Response` needs
  // an explicit reference. Same pattern as `globalThis.fetch`.
  let response: globalThis.Response;
  try {
    response = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: params.clientId,
        code_verifier: params.codeVerifier,
      }).toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
    expiresAt: new Date(Date.now() + raw.expires_in * 1000).toISOString(),
    scopes: typeof raw.scope === "string" ? raw.scope.split(" ").filter(Boolean) : [...SPOTIFY_SCOPES],
  };
}

function clientIdMissingInstructions(): string {
  return [
    "SPOTIFY_CLIENT_ID is not configured.",
    "",
    "To set it up:",
    "  1. Open https://developer.spotify.com/dashboard and sign in.",
    "  2. Click 'Create app'. Set the Redirect URI to http://127.0.0.1:<PORT>/api/spotify/callback (PORT = the port mulmoclaude is running on).",
    "  3. Check 'Web API'.",
    "  4. Copy the Client ID.",
    "  5. Add SPOTIFY_CLIENT_ID=<paste> to ~/mulmoclaude/.env, then restart mulmoclaude.",
    "",
    "Full guide: docs/tips/spotify-setup.md",
  ].join("\n");
}

function sendCallbackHtml(res: Response, status: number, title: string, bodyText: string): void {
  res
    .status(status)
    .type("text/html")
    .send(
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#111}h1{margin-bottom:1rem}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:.5rem}</style>
<h1>${escapeHtml(title)}</h1>
<pre>${escapeHtml(bodyText)}</pre>
</html>`,
    );
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export default router;
