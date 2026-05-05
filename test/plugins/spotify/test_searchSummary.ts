// Direct unit tests for the search-summary text formatters
// (CodeRabbit review on PR #1168). These pure functions feed
// `message` to the LLM, so a regression in formatting changes
// what the LLM "sees" — testing them directly keeps the contract
// stable.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatAlbumLine, formatArtistLine, formatPlaylistLine, formatTrackLine, summariseSearch } from "../../../packages/spotify-plugin/src/searchSummary.js";

describe("formatTrackLine", () => {
  it("prefixes 1-based index and joins artists with comma-space", () => {
    assert.equal(formatTrackLine({ id: "x", name: "Song", artists: ["A", "B"], album: "", durationMs: 0 }, 0), "1. Song — A, B");
  });
});

describe("formatArtistLine", () => {
  it("appends up to 3 genres in brackets when present", () => {
    const line = formatArtistLine({ id: "x", name: "Daft Punk", genres: ["french house", "electronic", "disco", "synth"] }, 0);
    assert.equal(line, "1. Daft Punk [french house, electronic, disco]");
  });

  it("omits the brackets when no genres", () => {
    assert.equal(formatArtistLine({ id: "x", name: "Niche", genres: [] }, 4), "5. Niche");
  });
});

describe("formatAlbumLine", () => {
  it("uses the year prefix when releaseDate is set", () => {
    const line = formatAlbumLine({ id: "x", name: "Discovery", artists: ["Daft Punk"], releaseDate: "2001-03-12", totalTracks: 14 }, 0);
    assert.equal(line, "1. Discovery — Daft Punk (2001)");
  });

  it('emits "?" when releaseDate is empty', () => {
    const line = formatAlbumLine({ id: "x", name: "Mystery", artists: [], releaseDate: "", totalTracks: 0 }, 0);
    assert.equal(line, "1. Mystery —  (?)");
  });
});

describe("formatPlaylistLine", () => {
  it("includes the track count", () => {
    assert.equal(formatPlaylistLine({ id: "x", name: "Mix", description: "", trackCount: 17 }, 0), "1. Mix (17 tracks)");
  });
});

describe("summariseSearch", () => {
  it("groups all four sections in track / artist / album / playlist order", () => {
    const out = summariseSearch("Bach", {
      tracks: [{ id: "t", name: "Track", artists: ["Bach"], album: "", durationMs: 0 }],
      artists: [{ id: "a", name: "Bach", genres: ["classical"] }],
      albums: [{ id: "al", name: "Cantatas", artists: ["Bach"], releaseDate: "1700-01-01", totalTracks: 12 }],
      playlists: [{ id: "p", name: "Best of Bach", description: "", trackCount: 50 }],
    });
    assert.match(out, /^Search "Bach":\nTracks/);
    assert.match(out, /Artists \(1\)/);
    assert.match(out, /Albums \(1\)/);
    assert.match(out, /Playlists \(1\)/);
  });

  it('returns "no results" when every category is absent or empty', () => {
    assert.equal(summariseSearch("nothing", {}), 'Search "nothing": no results.');
    assert.equal(summariseSearch("zero", { tracks: [] }), 'Search "zero": no results.');
  });

  it("only renders categories that the caller requested + populated", () => {
    const out = summariseSearch("only-artists", {
      artists: [{ id: "a", name: "Solo", genres: [] }],
    });
    assert.match(out, /Artists \(1\)/);
    assert.equal(out.includes("Tracks"), false);
    assert.equal(out.includes("Albums"), false);
  });
});
