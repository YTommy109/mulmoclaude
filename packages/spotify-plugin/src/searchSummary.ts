// Search-result text summarisation. Lives in its own module so the
// formatters are unit-testable directly (CodeRabbit review on PR
// #1168) without going through the full dispatch path. Pure
// functions, no side effects.

import type { NormalisedAlbum, NormalisedArtist, NormalisedPlaylist, NormalisedTrack, SearchResult } from "./types";

/** Build the LLM-facing message string for a search result. The
 *  plain text mirrors the View's grouped sections, one entity per
 *  line. */
export function summariseSearch(query: string, result: SearchResult): string {
  const sections: string[] = [];
  if (result.tracks?.length) sections.push(formatSearchSection("Tracks", result.tracks, formatTrackLine));
  if (result.artists?.length) sections.push(formatSearchSection("Artists", result.artists, formatArtistLine));
  if (result.albums?.length) sections.push(formatSearchSection("Albums", result.albums, formatAlbumLine));
  if (result.playlists?.length) sections.push(formatSearchSection("Playlists", result.playlists, formatPlaylistLine));
  if (sections.length === 0) return `Search "${query}": no results.`;
  return `Search "${query}":\n${sections.join("\n\n")}`;
}

export function formatSearchSection<T>(label: string, items: T[], formatter: (item: T, idx: number) => string): string {
  return `${label} (${items.length}):\n${items.map(formatter).join("\n")}`;
}

export function formatTrackLine(track: NormalisedTrack, idx: number): string {
  return `${idx + 1}. ${track.name} — ${track.artists.join(", ")}`;
}

export function formatArtistLine(artist: NormalisedArtist, idx: number): string {
  const genres = artist.genres.length > 0 ? ` [${artist.genres.slice(0, 3).join(", ")}]` : "";
  return `${idx + 1}. ${artist.name}${genres}`;
}

export function formatAlbumLine(album: NormalisedAlbum, idx: number): string {
  const year = album.releaseDate ? album.releaseDate.slice(0, 4) : "?";
  return `${idx + 1}. ${album.name} — ${album.artists.join(", ")} (${year})`;
}

export function formatPlaylistLine(playlist: NormalisedPlaylist, idx: number): string {
  return `${idx + 1}. ${playlist.name} (${playlist.trackCount} tracks)`;
}
