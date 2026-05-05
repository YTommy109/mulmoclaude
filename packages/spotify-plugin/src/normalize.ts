// Normalisers: shrink raw Spotify responses to the
// `Normalised{Track,Playlist}` shapes the View renders. Pure —
// no runtime / fetch / I/O — so unit tests run without mocks.

import type { NormalisedPlaylist, NormalisedTrack, RecentlyPlayedItem } from "./types";

interface SpotifyArtist {
  name?: unknown;
}

interface SpotifyImage {
  url?: unknown;
}

interface SpotifyAlbum {
  name?: unknown;
  images?: unknown;
}

interface SpotifyExternalUrls {
  spotify?: unknown;
}

interface SpotifyTrack {
  id?: unknown;
  name?: unknown;
  artists?: unknown;
  album?: unknown;
  duration_ms?: unknown;
  external_urls?: unknown;
}

interface SpotifyPlaylist {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  tracks?: unknown;
  external_urls?: unknown;
  images?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function smallestImageUrl(images: unknown): string | undefined {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  // Spotify orders `images` largest-first; pick the last one with a
  // valid URL so we don't hammer mobile data plans on cover-art-heavy
  // playlists.
  for (let i = images.length - 1; i >= 0; i -= 1) {
    const candidate = images[i] as SpotifyImage;
    if (typeof candidate?.url === "string" && candidate.url.length > 0) return candidate.url;
  }
  return undefined;
}

function spotifyUrl(externalUrls: unknown): string {
  if (!isRecord(externalUrls)) return "";
  const candidate = (externalUrls as SpotifyExternalUrls).spotify;
  return typeof candidate === "string" ? candidate : "";
}

function artistNames(artists: unknown): string[] {
  if (!Array.isArray(artists)) return [];
  return artists
    .map((a) => (isRecord(a) && typeof (a as SpotifyArtist).name === "string" ? ((a as SpotifyArtist).name as string) : ""))
    .filter((n) => n.length > 0);
}

/** Normalise one Spotify track. Returns null when the response is
 *  missing required scalar fields — caller should drop it from the
 *  list rather than render a half-broken row. */
export function normaliseTrack(raw: unknown): NormalisedTrack | null {
  if (!isRecord(raw)) return null;
  const track = raw as SpotifyTrack;
  if (typeof track.id !== "string" || track.id.length === 0) return null;
  if (typeof track.name !== "string") return null;
  const album = isRecord(track.album) ? (track.album as SpotifyAlbum) : null;
  return {
    id: track.id,
    name: track.name,
    artists: artistNames(track.artists),
    album: typeof album?.name === "string" ? album.name : "",
    durationMs: typeof track.duration_ms === "number" && Number.isFinite(track.duration_ms) ? track.duration_ms : 0,
    url: spotifyUrl(track.external_urls),
    imageUrl: smallestImageUrl(album?.images),
  };
}

/** Walk a paginated `items[]` response, normalise each entry's
 *  nested track, and drop entries that fail validation. */
export function normaliseTrackList(raw: unknown, trackPath: "track" | "self"): NormalisedTrack[] {
  if (!isRecord(raw)) return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: NormalisedTrack[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const candidate = trackPath === "track" ? item.track : item;
    const normalised = normaliseTrack(candidate);
    if (normalised) out.push(normalised);
  }
  return out;
}

/** `recently-played` items wrap the track in an object that carries
 *  the `played_at` timestamp. The View renders timestamps so we
 *  preserve them at this layer. */
export function normaliseRecentlyPlayed(raw: unknown): RecentlyPlayedItem[] {
  if (!isRecord(raw)) return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: RecentlyPlayedItem[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const track = normaliseTrack(item.track);
    if (!track) continue;
    const playedAt = typeof item.played_at === "string" ? item.played_at : "";
    out.push({ track, playedAt });
  }
  return out;
}

export function normalisePlaylist(raw: unknown): NormalisedPlaylist | null {
  if (!isRecord(raw)) return null;
  const playlist = raw as SpotifyPlaylist;
  if (typeof playlist.id !== "string" || playlist.id.length === 0) return null;
  if (typeof playlist.name !== "string") return null;
  const tracks = isRecord(playlist.tracks) ? (playlist.tracks as { total?: unknown }) : null;
  return {
    id: playlist.id,
    name: playlist.name,
    description: typeof playlist.description === "string" ? playlist.description : "",
    trackCount: typeof tracks?.total === "number" && Number.isFinite(tracks.total) ? tracks.total : 0,
    url: spotifyUrl(playlist.external_urls),
    imageUrl: smallestImageUrl(playlist.images),
  };
}

export function normalisePlaylistList(raw: unknown): NormalisedPlaylist[] {
  if (!isRecord(raw)) return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: NormalisedPlaylist[] = [];
  for (const item of items) {
    const normalised = normalisePlaylist(item);
    if (normalised) out.push(normalised);
  }
  return out;
}
