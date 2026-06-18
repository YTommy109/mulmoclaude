# Extract presentCollection + collection engine → @mulmoclaude/collection-plugin

Goal: package the Collections feature so MulmoTerminal can import it like `@mulmoclaude/chart-plugin`.

## Status

**Shipped in PR #1723** (`@mulmoclaude/collection-plugin@0.2.1`, published):

- ✅ **1a** — isomorphic engine (`derivedFormula`, `deriveAll`, `actionVisible`) → package `.`; removed the server→`src/` reach-in.
- ✅ **1b** — canonical schema types consolidated into the package core; server `types.ts` + frontend `collectionTypes.ts` re-export. Feeds decoupled (`IngestSpec extends CollectionIngest`).
- ✅ **1b-rest** — remaining pure utils (`sortItems`, `itemLabel`, `calendarGrid`) → core.
- ✅ **1c** — full server engine → `./server` entry behind `configureCollectionHost({ workspaceRoot, log, paths, isPresetSlug })`:
  - 1c-i: host binding + `paths`
  - 1c-ii: `io` + `validate` + `LoadedCollection` + atomic-write port
  - 1c-iii: `discovery` (+ zod) + `templatePath`; binding extended with skills/feeds path helpers; ingest vocab moved into the schema
  - 1c-iv/v: `derive` / `spawn` / `delete` / `views`
  - host-integration stays host-side: `notifications`, `watcher`, `api/routes/collections.ts`, `manageCollection.ts`
- ✅ **1d-core** — `presentCollection` tool definition + pure executor → package `.` (gui-chat-protocol peer dep).
- ✅ **1d step 1** — UI view-state types + `enumColors` + `draft` → core; host `collectionTypes.ts` owns no types now. `enumColors`/`draft` reached by host components via thin re-export shims (removed when components move).

## Phase 2 — the collection frontend (in progress, branch `feat/collection-ui-context`)

The View layer is gated on a **`CollectionUi`** injection binding — NOT Vue `provide`, but a
module-level singleton in `src/vue/uiContext.ts` (`configureCollectionUi()` / `collectionUi()`),
mirroring the server's `configureCollectionHost`. The host wires it once at startup
(`src/composables/collections/uiHost.ts`, side-effect import in `main.ts`); MulmoTerminal supplies
its own. The `./vue` entry side-effect-imports the package's compiled `style.css`.

**The SFC build pipeline is done** (step 2a): `./vue` now builds Vue SFCs via
`@vitejs/plugin-vue` + `@tailwindcss/vite` (shipped `dist/style.css`, new `./style.css` export),
with d.ts emitted by `vue-tsc` (not vite-plugin-dts). vue-i18n is a peer (`^11.4.4`); components
keep `useI18n()` and resolve the host's i18n instance + keys.

- ✅ **step 1** — `CollectionUi` binding + move `useCollectionRendering` onto it (`7f675b94`).
- ✅ **step 2a** — SFC build pipeline + move `CollectionRecordModal` (pure) — `d48040a5`.
- ✅ **step 2b** — `CollectionEmbedView` (validates the vue-i18n + global `<router-link>` path) — `721f1433`.
- ✅ **step 2c** — `CollectionCalendarView` + `CollectionDayView` — `68694c73`.
- ✅ **step 2d** — `CollectionKanbanView` (+ `vuedraggable` package dep, `CollectionNotifySeverity` type) — `294856f4`.
- ✅ **step 2e** — `CollectionRecordPanel` (+ `imageSrc` context capability) — `0f040837`.

Steps 1 + 2a–2e shipped in **PR #1725** as **`@mulmoclaude/collection-plugin@0.3.0`** (published; launcher pin → `^0.3.0`).

**Branch `feat/collection-view-move`** (off `feat/collection-ui-context`) — the API-heavy cluster:

- ✅ **step 2f** — `CollectionViewConfigModal` (+ `confirm`, `deleteView` capabilities; shared `errorMessage` core helper) — `6f5a173c`.
- ✅ **step 2g** — `CollectionCustomView` (+ `mintViewToken`, `fetchViewHtml`, `buildViewSrcdoc`; context result/token types exported from `./vue`) — `a52023c5`.

`CollectionUi` now exposes: `fetchCollectionDetail`, `fileAssetUrl`, `fileRoutePath`, `imageSrc`,
`confirm`, `deleteView`, `mintViewToken`, `fetchViewHtml`, `buildViewSrcdoc`.

### Remaining — the `CollectionView` capstone (2,131 LOC, the root)

The last component. It renders the now-migrated sub-components and carries the bulk of the host
surface. Survey of its coupling → the `CollectionUi` additions still needed:

- **Collection CRUD/actions** (replaces `apiGet/Post/Put/Delete` + `API_ROUTES.collections.*`):
  create item, update item, delete item, run item-action, run collection-action, refresh,
  feed detail (`API_ROUTES.feeds.detail`).
- **Navigation**: `navigate` (router push/replace + `PAGE_ROUTES.collections` / `PAGE_ROUTES.feeds`)
  + read current route query (`useRoute`, e.g. `?selected=`).
- **App integration**: `sendMessage`/`startNewChat` (`useAppApi`), `pin` (`useShortcuts`),
  `notify` + `notifiedSeverities(slug)` (`useNotifications` + `collectionNotifiedSeverities`).
- **Generic UI**: `ConfirmModal`, `PinToggle` — inject as context-provided components, or have the
  host render them around the View (CollectionView renders its own `<ConfirmModal>` instance today).
- **Misc utils**: `shortHexId` (`utils/id`), `defangForPrompt` (`utils/promptSafety`),
  `BUILTIN_ROLE_IDS` (`config/roles`) — small pure utils, move into core or inject.

After CollectionView lands, the `enumColors`/`draft` host shims can be removed (nothing host-side
imports them anymore).

### Sequence (each its own green commit)
1. ✅ done — steps 1, 2a–2e (PR #1725).
2. ✅ sub-modals — steps 2f, 2g (this branch). `confirm`/`deleteView`/custom-view caps added.
3. ⏳ **`CollectionView`** — expand `CollectionUi` with the CRUD/nav/app/notify surface above + the
   two generic components; move the root → `./vue`; drop the `enumColors`/`draft` shims.
4. Browsable pages (`CollectionsIndexView`, `/collections` route) → package + host router wiring.
5. Plugin `./vue` entry (View + Preview + lang); shrink the host `presentCollection` adapter; bump
   to `0.4.0` + publish.

## Publish gate
The launcher pins `@mulmoclaude/collection-plugin`; bump + republish before each PR/smoke run so the
clean-install resolves the current content (`0.2.1` in PR #1723, `0.3.0` in PR #1725). The
CollectionView move (new capabilities, no new export surface) is a minor bump (`0.4.0`).
