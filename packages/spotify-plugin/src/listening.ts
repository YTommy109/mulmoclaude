// Listening-data handlers (PR 2). Each one:
//   1. Reads clientConfig + tokens; returns a structured error
//      result if either is missing.
//   2. Calls `spotifyApi(...)` for the matching Spotify endpoint.
//   3. Normalises the response into the View-friendly shape.
//
// Kept separate from `index.ts` so the dispatcher stays small and
// each handler is independently testable. Pure delegation — the
// runtime + clientId + tokens are passed in by the dispatcher.

import type { PluginRuntime } from "gui-chat-protocol";

import { spotifyApi } from "./client";
import type { SpotifyClientError } from "./client";
import { normalisePlaylist, normalisePlaylistList, normaliseRecentlyPlayed, normaliseTrack, normaliseTrackList } from "./normalize";
import type { NormalisedPlaylist, NormalisedTrack, RecentlyPlayedItem, SpotifyTokens } from "./types";

export interface ListeningDeps {
  runtime: PluginRuntime;
  clientId: string;
  tokens: SpotifyTokens;
  /** Injectable clock — primarily for tests, where the default
   *  `() => new Date()` would race the proactive-refresh window
   *  whenever the fixture's `expiresAt` is close to wall-clock time.
   *  Production callers omit it. */
  now?: () => Date;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: SpotifyClientError };

export async function fetchLiked(deps: ListeningDeps, limit: number): Promise<Result<NormalisedTrack[]>> {
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "GET", `/v1/me/tracks?limit=${limit}`, {}, deps.now);
  if (!result.ok) return result;
  return { ok: true, data: normaliseTrackList(result.data, "track") };
}

export async function fetchPlaylists(deps: ListeningDeps): Promise<Result<NormalisedPlaylist[]>> {
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "GET", "/v1/me/playlists?limit=50", {}, deps.now);
  if (!result.ok) return result;
  return { ok: true, data: normalisePlaylistList(result.data) };
}

export async function fetchPlaylistTracks(deps: ListeningDeps, playlistId: string, limit: number): Promise<Result<NormalisedTrack[]>> {
  const path = `/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${limit}`;
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "GET", path, {}, deps.now);
  if (!result.ok) return result;
  return { ok: true, data: normaliseTrackList(result.data, "track") };
}

export async function fetchRecent(deps: ListeningDeps, limit: number): Promise<Result<RecentlyPlayedItem[]>> {
  const result = await spotifyApi(deps.runtime, deps.clientId, deps.tokens, "GET", `/v1/me/player/recently-played?limit=${limit}`, {}, deps.now);
  if (!result.ok) return result;
  return { ok: true, data: normaliseRecentlyPlayed(result.data) };
}

/** `nowPlaying` returns null when nothing is currently playing
 *  (Spotify returns 204). The View shows an empty state. */
export async function fetchNowPlaying(deps: ListeningDeps): Promise<Result<NormalisedTrack | null>> {
  const result = await spotifyApi<unknown>(deps.runtime, deps.clientId, deps.tokens, "GET", "/v1/me/player/currently-playing", {}, deps.now);
  if (!result.ok) return result;
  if (result.data === null) return { ok: true, data: null };
  // Currently-playing wraps the track under `item`. Some endpoints
  // (e.g. local playback) return null here even with a 200; the
  // normaliser handles that as a drop.
  if (typeof result.data === "object" && result.data !== null && "item" in result.data) {
    const track = normaliseTrack((result.data as { item: unknown }).item);
    return { ok: true, data: track };
  }
  // Fallback: try the playlist normaliser for podcast / show contexts
  // (very rare, but better than crashing on a context the View doesn't
  // know about).
  return { ok: true, data: null };
}

// `normalisePlaylist` is exported so the LLM can request a single
// playlist's metadata via `playlistTracks` indirectly; reserved for
// future kinds.
export { normalisePlaylist };
