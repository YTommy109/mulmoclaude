// Unit tests for `packages/plugins/spotify-plugin/src/tokens.ts` —
// read/write round-trip + refresh-merge that preserves the prior
// `refreshToken` when Spotify omits a fresh one.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mergeRefreshResponse, readClientConfig, readTokens, writeClientConfig, writeTokens } from "../../../packages/plugins/spotify-plugin/src/tokens.js";
import type { SpotifyTokens } from "../../../packages/plugins/spotify-plugin/src/types.js";

/** In-memory `FileOps` impl — mirrors what `runtime.files.config`
 *  hands plugins, scoped to a single fake "config dir". Plugins
 *  never see absolute paths through `runtime.files.*`. */
function makeFakeFiles() {
  const store = new Map<string, string>();
  return {
    files: {
      exists: async (rel: string) => store.has(rel),
      read: async (rel: string) => {
        const value = store.get(rel);
        if (value === undefined) throw new Error(`fake fs: ${rel} not found`);
        return value;
      },
      readBytes: async (rel: string) => {
        const value = store.get(rel);
        if (value === undefined) throw new Error(`fake fs: ${rel} not found`);
        return new TextEncoder().encode(value);
      },
      write: async (rel: string, content: string | Uint8Array) => {
        store.set(rel, typeof content === "string" ? content : new TextDecoder().decode(content));
      },
      readDir: async () => Array.from(store.keys()),
      stat: async (rel: string) => {
        const value = store.get(rel);
        if (value === undefined) throw new Error(`fake fs: ${rel} not found`);
        return { mtimeMs: 0, size: value.length };
      },
      unlink: async (rel: string) => {
        store.delete(rel);
      },
    },
    store,
  };
}

describe("readTokens / writeTokens — round-trip", () => {
  it("returns null when tokens.json doesn't exist", async () => {
    const { files } = makeFakeFiles();
    assert.equal(await readTokens(files), null);
  });

  it("round-trips a full SpotifyTokens record", async () => {
    const { files } = makeFakeFiles();
    const tokens: SpotifyTokens = {
      accessToken: "at-xxx",
      refreshToken: "rt-yyy",
      expiresAt: "2026-05-05T01:00:00.000Z",
      scopes: ["user-library-read"],
    };
    await writeTokens(files, tokens);
    assert.deepEqual(await readTokens(files), tokens);
  });

  it("returns null when tokens.json is missing required fields", async () => {
    const { files, store } = makeFakeFiles();
    store.set("tokens.json", JSON.stringify({ accessToken: "at-xxx" }));
    assert.equal(await readTokens(files), null);
  });
});

describe("readClientConfig / writeClientConfig", () => {
  it("returns null when client.json doesn't exist", async () => {
    const { files } = makeFakeFiles();
    assert.equal(await readClientConfig(files), null);
  });

  it("round-trips a Client ID", async () => {
    const { files } = makeFakeFiles();
    await writeClientConfig(files, { clientId: "abc-123" });
    assert.deepEqual(await readClientConfig(files), { clientId: "abc-123" });
  });

  it("returns null when client.json is malformed", async () => {
    const { files, store } = makeFakeFiles();
    store.set("client.json", "{not-json}");
    assert.equal(await readClientConfig(files), null);
  });
});

describe("mergeRefreshResponse", () => {
  const prior: SpotifyTokens = {
    accessToken: "old-access",
    refreshToken: "rt-original",
    expiresAt: "2026-05-04T00:00:00.000Z",
    scopes: ["user-library-read", "user-read-recently-played"],
  };

  it("preserves the prior refreshToken when the response omits one (common case)", () => {
    const merged = mergeRefreshResponse(prior, { accessToken: "new-access", expiresInSec: 3600 }, new Date("2026-05-05T00:00:00.000Z"));
    assert.equal(merged.refreshToken, "rt-original");
    assert.equal(merged.accessToken, "new-access");
    assert.equal(merged.expiresAt, "2026-05-05T01:00:00.000Z");
    assert.deepEqual(merged.scopes, ["user-library-read", "user-read-recently-played"]);
  });

  it("overwrites refreshToken when Spotify returns a fresh one (rotation)", () => {
    const merged = mergeRefreshResponse(
      prior,
      { accessToken: "new-access", refreshToken: "rt-rotated", expiresInSec: 3600 },
      new Date("2026-05-05T00:00:00.000Z"),
    );
    assert.equal(merged.refreshToken, "rt-rotated");
  });

  it("overwrites scopes when Spotify returns them", () => {
    const merged = mergeRefreshResponse(
      prior,
      { accessToken: "new-access", expiresInSec: 3600, scopes: ["user-library-read"] },
      new Date("2026-05-05T00:00:00.000Z"),
    );
    assert.deepEqual(merged.scopes, ["user-library-read"]);
  });
});
