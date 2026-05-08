# Map Plugin — Google Maps + favorite places + wiki coordinate linking

Tracking issue: [#1227](https://github.com/receptron/mulmoclaude/issues/1227)

## User Prompt

> 1222で気がついたけどgoogle map viewってほしいよね。
> google mapでよい。api keyが設定されているときに見有効。api keyはwebの設定画面からかな。
> ユースケースはexifじゃなくて普通にお店を探して、それをfavoriteで登録したり、その一覧を表示させておみせをみたりかな。
> そう考えるとwikiの情報と連動できてもよいね。wikiに緯度経度とかうめこんで。planかいて。

## Goals

1. **Find a place** — search by name / address (Google Places Autocomplete).
2. **Save it as a favorite** — name + lat/lng + optional notes.
3. **See all favorites on a map** — `/map` route, pins clickable for details.
4. **Link to wiki** — a wiki page can declare `coords: [lat, lng]` in its frontmatter; the page render embeds a small map widget. From a favorite's detail panel, jump to its linked wiki page (or create one).

## Non-goals (this iteration)

- Turn-by-turn directions / route planning
- Distance / "places near me" radius search
- Traffic, Street View, satellite toggle
- Photo EXIF auto-pinning (will revisit under #1222 once favorites land)
- Multi-account support — one Google Maps API key per workspace

## Architecture

### Plugin shape

`packages/map-plugin/` as a **runtime plugin** (`@mulmoclaude/map-plugin`). Same shape as `spotify-plugin` / `recipe-book-plugin`. No host-side feature-specific code; the only host changes are generic infrastructure.

```
packages/map-plugin/
├── src/
│   ├── index.ts           # PluginRegistration + handlers
│   ├── definition.ts      # Tool schema (Zod)
│   ├── meta.ts            # definePluginMeta — toolName, apiRoutes, workspaceDirs
│   ├── schemas.ts         # Zod schemas (Place, Favorite, ConfigFile)
│   ├── places.ts          # Places API thin wrapper
│   ├── favorites.ts       # JSON CRUD over runtime.files
│   ├── config.ts          # API-key load/save (per-machine config)
│   ├── lang/              # i18n (en / ja minimum, keep room for the rest)
│   ├── View.vue           # Full /map view
│   └── Preview.vue        # Chat-row preview thumbnail
└── ...                    # vite.config / tsconfig / package.json mirroring bookmarks-plugin
```

### Tool surface (one tool, kind-discriminated)

`manageMap({ kind: ... })` — same pattern as `manageSpotify`:

| kind | Args | Returns |
|---|---|---|
| `status` | — | `{ ok, configured: boolean, favoritesCount }` |
| `configure` | `{ apiKey }` | `{ ok }` — stores key, no echo back |
| `searchPlaces` | `{ query, sessionToken? }` | `{ ok, results: Place[] }` |
| `addFavorite` | `{ name, lat, lng, placeId?, notes?, wikiSlug? }` | `{ ok, favorite: Favorite }` |
| `listFavorites` | — | `{ ok, favorites: Favorite[] }` |
| `removeFavorite` | `{ id }` | `{ ok }` |
| `linkWikiPage` | `{ favoriteId, wikiSlug }` | `{ ok }` — sets the cross-link both ways |

### Data model (`favorites.json`)

```ts
interface Favorite {
  id: string;            // uuid v4
  name: string;          // user-editable
  lat: number;
  lng: number;
  placeId?: string;      // Google Places place_id (for re-fetching photos / hours)
  notes?: string;
  wikiSlug?: string;     // links to data/wiki/pages/<slug>.md
  addedAt: string;       // ISO
  updatedAt: string;     // ISO
}

interface FavoritesFile {
  version: 1;
  favorites: Favorite[];  // sorted by addedAt desc
}
```

Stored at `~/mulmoclaude/data/places/favorites.json` (new `WORKSPACE_DIRS.places` entry). Reads/writes go through `writeFileAtomic` (per CLAUDE.md "all writes go through `writeFileAtomic`").

### API key storage

`~/mulmoclaude/config/map-plugin/config.json` — per-machine, never under `data/` (which is workspace-shared).

```ts
interface MapPluginConfig {
  version: 1;
  googleMapsApiKey?: string;  // empty / unset → not configured
}
```

The key is needed on **two surfaces**:
- **Client** (Vue View): the Google Maps JS SDK injects via `<script>` tag with `?key=<APIKEY>`. Plugin View fetches its own key from `runtime.dispatch({ kind: "status" })` → server reads `config.json` → returns `{ configured: true, hasKey: true }` plus an opaque short-lived **session-bound token** the View exchanges for the key on a per-session basis (so the key never lands in chat history / SSE replay).
  - **Decision pending** — see Open Questions below. Simpler v1: just return the key directly to the same-origin same-process View. Local-only desktop app, low practical risk.
- **Server** (Places API proxy): the search-places handler calls Google's Places API server-side using the same key. Avoids embedding the key in the client bundle for endpoints that don't strictly need a browser context.

### Routing

- `GET /map` — host route, mounted via the plugin's `definePluginMeta({ pageRoutes: ... })` contribution.
  - Currently host's `src/router/index.ts` hard-codes the page routes. Extending it with plugin-contributed routes is itself a plugin-vs-host boundary call (see Open Questions §1).
- All plugin tool calls go through the existing generic `POST /api/plugins/runtime/:pkg/dispatch` route — no new host routes for this plugin.

### Wiki integration (PR-D)

**Authoring shape**: wiki page frontmatter:

```markdown
---
title: お気に入りの寿司屋
coords:
  lat: 35.6762
  lng: 139.6503
mapZoom: 16             # optional, default 16
---

レビュー本文...
```

(Picked frontmatter over body shortcode `{{map:...}}` because: (a) the wiki engine already parses YAML frontmatter; (b) frontmatter is a single canonical place per page rather than 0..N inline tags; (c) reverse-linking from a favorite to a wiki page is straightforward — a favorite's `wikiSlug` resolves to that one page's coords. See Open Questions §2 if we want to soften this.)

**Render**: when `coords` is present, the wiki page renderer embeds a `<MapEmbed :lat :lng :zoom>` widget at the bottom of the page. Same Maps JS SDK as `/map`, scoped to that single point.

**Reverse link**: when a favorite has `wikiSlug` set, `/map`'s detail panel shows "Open wiki page →" which routes to `/wiki/pages/<slug>`. From a wiki page with coords, an "Add to favorites" button captures the page title + coords and POSTs `addFavorite` with `wikiSlug` pre-filled.

## Phasing

Each phase is one PR, independently mergeable. Aim is for PR-A to be a no-op for users without an API key (just a new sidebar entry pointing at an empty `/map` page with a "configure" prompt).

### PR-A — Plugin scaffold + Settings UI for API key

- Generate plugin via existing scaffold (`npx create-mulmoclaude-plugin map`)
- `meta.ts`: tool name `manageMap`, `workspaceDirs: { places: "data/places" }`, `pageRoutes: [{ path: "/map", name: "map", component: View }]` if the host extension supports it (else open a separate small PR to add `pageRoutes` aggregation; see Open Questions §1)
- `definition.ts`: just `status` and `configure` kinds for this PR
- Server-side handler: read/write `config/map-plugin/config.json`
- Settings UI: new "Map" entry in the existing Settings panel (same component family as the MCP catalog config sheet — both edit a stored secret)
- View: empty Google Map centred on a dummy spot when configured, "Set API key in Settings" prompt when not
- Tests: handler unit tests (status + configure), Settings UI E2E (key-roundtrip)

**Acceptance**: opening `/map` without an API key shows a prompt; setting a key in Settings makes the map render Tokyo (or any sensible default centre).

### PR-B — Favorites CRUD + pins on /map

- New kinds: `addFavorite`, `listFavorites`, `removeFavorite`
- `favorites.ts`: JSON I/O over `runtime.files.data("favorites.json")`
- Schemas: Zod for `Favorite` + `FavoritesFile`, validate on read AND write
- View: render pins from `listFavorites`, click → side panel with name / notes / lat / lng / "Remove"
- Add-favorite UX: right-click on map → "Save this point" prompt for name (basic flow)
- Tests: favorites.ts unit (happy path, dup-id, empty, malformed file recovery), View E2E (mock listFavorites, assert pins rendered)

**Acceptance**: can add a pin, refresh, see it persist; can remove; favorites count shown in `/map` header.

### PR-C — Places Autocomplete search

- New kind: `searchPlaces`
- Server-side proxy: calls `https://places.googleapis.com/v1/places:searchText` with the stored API key
- View: search bar in `/map` header, dropdown of suggestions, click → drops a "candidate" pin you can either save as favorite or dismiss
- Rate-limit handling: Google Places enforces ~10 QPS per key — surface 429 as a clear "slow down" toast rather than retrying silently
- Tests: search.ts unit (happy path, no results, 429, network error), View E2E (mock search → assert dropdown)

**Acceptance**: typing "蕎麦" in search bar yields suggestions; clicking one drops a candidate pin; "Save" turns it into a favorite.

### PR-D — Wiki integration

- Wiki page schema: extend frontmatter type to allow `coords: { lat: number; lng: number }` and `mapZoom?: number`
- Wiki render pipeline: detect coords → append a `<MapEmbed>` block (separate Vue component shared between `/map` and `MapEmbed` to avoid two SDK loads)
- New tool kind: `linkWikiPage` (favorite ↔ wiki cross-link)
- `/map` detail panel: "Open wiki" link when `wikiSlug` set; "Create wiki page from this favorite" CTA when not (creates page with frontmatter coords pre-filled)
- Wiki page: "Add to favorites" button when coords present and no matching favorite yet
- Tests: wiki frontmatter schema unit, render-pipeline integration, cross-link E2E (add favorite → see it link → click → land on wiki)

**Acceptance**: a wiki page with `coords` shows a map; a favorite with `wikiSlug` opens the right wiki; the cross-create flow round-trips.

## Implementation notes

### Maps JS SDK loading

- Google Maps JS SDK is **gigantic** (~600 KB gzipped) — must load it lazily, only on `/map` and on wiki pages that have `coords`. Never include in the main bundle.
- Use the official loader pattern (`<script src="https://maps.googleapis.com/maps/api/js?key=...&libraries=places&loading=async">`). Don't roll a custom loader.
- Cache the Promise: a second view mount inside the same SPA session reuses the already-loaded SDK.

### Places API session token

- The `searchPlaces` flow should pass a session token through `(autocomplete query → place details fetch)` for Google's billing model — a single autocomplete-then-pick is one billing event instead of N. Implementation: client generates a UUID per "search session" (when the search bar is opened), passes it through `searchPlaces`, retains it for the eventual `addFavorite` if the user picks one.

### Cost ceilings

- Google Places API can run up bills if a tool call loop misuses it. Plugin-side guard: rate-limit `searchPlaces` to **N calls per minute per process** (suggested N=30) and reject excess with a clear error. Cheap insurance against an LLM-side regression.

### Cross-platform / first-run

- Empty workspace → `data/places/` directory created on first read by the existing `WORKSPACE_DIRS` provisioning path. No special-case branch needed.
- API key absent → tool returns `{ ok: false, error: { kind: "not_configured" } }`; View handles by showing the configure prompt. No process crash on missing key.

### i18n

8 locales as per the project rule. Strings will be:
- "Set Google Maps API key in Settings"
- "0 favorites yet"
- "Save this point", "Remove", "Open wiki", "Create wiki page"
- "Search for a place…"
- Error toasts: "Google rate limit hit, slow down", "Network error, retry"

Translations done in the same PR that introduces the string; all 8 locales touched in lockstep per CLAUDE.md.

## Open Questions (decide before / during PR-A)

1. **Plugin-contributed page routes** — does the host's `defineHostAggregate` already support `pageRoutes`, or does plugin meta have to declare a route name and the host hard-codes registration? If the latter, should `pageRoutes` aggregation be its own micro-PR (analogous to `apiRoutes` / `staticChannels`) before PR-A, or should the plugin register `/map` directly in PR-A and the cleanup follow?
   - **Tentative**: micro-PR first if the gap is small, otherwise inline in PR-A and refactor later. Pick after a 30-min code read.

2. **Wiki coordinate format** — frontmatter `coords` only, or also a body inline shortcode? Going frontmatter-only above; reconsider only if a real "multiple points on one wiki page" use case appears in PR-D.

3. **API key delivery to the Vue View** — direct return vs short-lived token-exchange. Going direct in v1; revisit only if there's a clear threat model where the chat history / SSE replay can leak the key. (For a local desktop app this is essentially zero risk.)

4. **Do we keep the `mcpCatalog` Google Maps MCP entry alongside this plugin?** They serve different purposes (MCP gives Claude a tool surface; this plugin gives the user a UI). Probably yes — leave MCP entry alone, it's parallel infrastructure.

5. **Default map centre** when there are no favorites — Tokyo Station (35.6812, 139.7671)? IP-geolocate? Asking the browser for `navigator.geolocation` adds a permission prompt at first load. Tokyo Station as a literal default keeps the first-run experience friction-free; user can pan.

## Schedule estimate (rough)

- PR-A: half-day to one day (scaffold + Settings field + skeleton View)
- PR-B: one day (favorites JSON + pins UI + tests)
- PR-C: one day (Places search + rate-limit guard + tests)
- PR-D: one to two days (wiki frontmatter + render-pipeline change + cross-link UX)

Total: ~4-5 days of focused work, four independently-reviewable PRs.

## Definition of done (issue #1227 closes)

- All four PRs merged
- `docs/developer.md` plugin section mentions Map plugin alongside Spotify / recipe-book / etc.
- README updated with API-key setup instructions
- A favorites round-trip works end-to-end: search → save → see on map → click → open linked wiki page → edit notes → reflected back
