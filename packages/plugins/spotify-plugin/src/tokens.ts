// Token + client-config persistence on top of `runtime.files.config`.
// Lives at:
//   tokens.json — accessToken / refreshToken / expiresAt / scopes
//   client.json — { clientId } (user pastes their Spotify Developer
//                  Dashboard Client ID here; PKCE flow needs no secret)
//
// Both are per-machine secrets — `files.config` is the right scope
// (`files.data` is described in the protocol as a backup target, so
// putting tokens / Client IDs there would invite cross-machine sync,
// which is wrong for these values).

import type { FileOps } from "gui-chat-protocol";

import { ClientConfigSchema, TokensSchema } from "./schemas";
import { ONE_SECOND_MS } from "./time";
import type { RefreshResponseFields, SpotifyClientConfig, SpotifyTokens } from "./types";

const TOKENS_FILE = "tokens.json";
const CLIENT_CONFIG_FILE = "client.json";

/** Read persisted tokens. Returns null on absent / malformed (=
 *  caller treats as "not_connected" and walks the user back to the
 *  connect button). Throws only on the read I/O itself. */
export async function readTokens(files: FileOps): Promise<SpotifyTokens | null> {
  if (!(await files.exists(TOKENS_FILE))) return null;
  try {
    const raw = await files.read(TOKENS_FILE);
    const parsed = TokensSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Write the full token record. */
export async function writeTokens(files: FileOps, tokens: SpotifyTokens): Promise<void> {
  await files.write(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

/** Read the user-provided Client ID. Returns null when the file is
 *  absent / malformed (caller treats as "client_id_missing" and
 *  surfaces the setup guide). */
export async function readClientConfig(files: FileOps): Promise<SpotifyClientConfig | null> {
  if (!(await files.exists(CLIENT_CONFIG_FILE))) return null;
  try {
    const raw = await files.read(CLIENT_CONFIG_FILE);
    const parsed = ClientConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Write the Client ID. The View's "Configure" form posts here
 *  via `runtime.dispatch({ kind: "configure", clientId })` (PR 2). */
export async function writeClientConfig(files: FileOps, config: SpotifyClientConfig): Promise<void> {
  await files.write(CLIENT_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/** Apply a refresh response to the persisted tokens, preserving the
 *  prior `refreshToken` when Spotify omits a fresh one (the common
 *  case). Pure — caller persists. */
export function mergeRefreshResponse(prior: SpotifyTokens, response: RefreshResponseFields, now: Date = new Date()): SpotifyTokens {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken ?? prior.refreshToken,
    expiresAt: new Date(now.getTime() + response.expiresInSec * ONE_SECOND_MS).toISOString(),
    scopes: response.scopes !== undefined ? [...response.scopes] : prior.scopes,
  };
}
