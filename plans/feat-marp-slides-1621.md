# feat-marp-slides-1621

Render `presentDocument` markdown as **Marp slides** when frontmatter has `marp: true`. PDF export via server-side `marp-cli`.

Tracking issue: [#1621](https://github.com/receptron/mulmoclaude/issues/1621)

## Why

- Existing slide-shaped surfaces: `presentMulmoScript` (JSON storyboard), `pptx` skill (programmatic build). Neither covers "agent writes a `.md` and it becomes a slide deck."
- Marp's authoring format is just markdown + `---` slide breaks + a `marp: true` frontmatter flag. The `presentDocument` plugin (= `src/plugins/markdown/`) already parses frontmatter and renders a body — Marp slots in as a render-mode branch.
- Smallest viable wedge: render-only on client, PDF export only on server, no nav, no theme picker.

## Choice recap

User picked **B 案** (extend `presentDocument`, vertical stack layout) with **PDF export included**. PPTX / HTML / PNG / per-slide nav are out of scope for this PR.

## Files

| Path | Change | Lines (est.) |
|---|---|---|
| `package.json` | + `@marp-team/marp-core` (frontend dep) | +1 |
| `package.json` | + `@marp-team/marp-cli` (runtime dep, spawned for export) | +1 |
| `src/plugins/markdown/View.vue` | branch on `frontmatter.marp === true` → render `<MarpView>` instead of markdown body | ~15 |
| `src/plugins/markdown/MarpView.vue` | **new** — instantiate `Marp` from `marp-core`, render stacked HTML + inject `Marp.themeSet` CSS, header with Export PDF button | ~120 |
| `src/plugins/markdown/marpDetect.ts` | **new** — pure helper `isMarpDocument(frontmatter: object): boolean`; covers `marp: true`, `marp: yes`, string `"true"` | ~15 |
| `src/config/apiRoutes.ts` | + `EXPORT_MARP_PDF: "/api/plugins/markdown/export-pdf"` | +1 |
| `server/api/routes/markdown.ts` | **new** — `POST /api/plugins/markdown/export-pdf` body `{ documentId, markdown }` → spawn `marp-cli` → write `artifacts/documents/<id>.pdf` → return URL | ~80 |
| `server/api/index.ts` | mount markdown route | +2 |
| `server/utils/marpRuntime.ts` | **new** — `detectMarpCli()` / `runMarpExport(md, outPath)`; caches Chromium availability check at boot | ~60 |
| `src/utils/api.ts` | (re-uses existing `apiPost`, no change) | 0 |
| `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` | + `marp.slides_mode`, `marp.export_pdf`, `marp.exporting`, `marp.export_failed`, `marp.export_unavailable` (8 locales lockstep) | +5 × 8 |
| `test/plugins/markdown/test_marpDetect.ts` | **new** — unit tests for the detection helper | ~40 |
| `test/server/api/test_markdown_export_pdf.ts` | **new** — handler test (mocks `marp-cli` spawn) | ~50 |
| `docs/shared-utils.md` | + entry for `marpDetect` and `marpRuntime` if cross-cutting (review at the end) | +2 |

## Tasks

1. **Deps**: `yarn add @marp-team/marp-core @marp-team/marp-cli`
2. **Detect helper** + tests: `marpDetect.ts` + `test_marpDetect.ts`
3. **Client render**: `MarpView.vue` (stacked, marp-core instance memoized per markdown body, themes via `marp.themeSet.default`)
4. **View.vue branching**: when `isMarpDocument(frontmatter)` → `<MarpView :markdown :documentId>` instead of existing markdown body
5. **Server route**: `markdown.ts` + `marpRuntime.ts` + register in `apiRoutes.ts` + mount in `server/api/index.ts`
6. **Export button**: `MarpView.vue` header with disabled-state when `availability !== "ready"`. Bootstrap availability via `GET /api/plugins/markdown/export-pdf/health` (or piggyback on first POST? Simpler: probe once at MarpView mount.)
7. **i18n 8 locales** in lockstep
8. **Local checks**: `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
9. **Push + PR** with User Prompt section

## Trade-offs / known limits

- **Chromium dep**: `marp-cli` PDF export requires Chromium. We don't bundle one — rely on `puppeteer`'s download or system Chrome. If missing, the Export button stays disabled and a tooltip says "Chromium not detected; install Chrome or set CHROME_PATH." NOT a launch blocker for the feature; the in-browser render still works.
- **`marp-core` size**: ~120 KB minified gzipped. Loaded lazily in `MarpView.vue` via dynamic `import()` so the markdown view's bundle isn't bloated for non-Marp documents. (Acceptable exception to the "no dynamic import for always-needed packages" rule because Marp is conditional.)
- **No slide nav**: deliberately deferred. If the stacked view feels too "wall of slides", add `◀/▶ + counter` in a follow-up.
- **No PPTX export**: marp-cli supports it, but PDF covers 90% of the "send it" use case. Defer PPTX until asked.
- **Theme**: marp-core default. `<!-- theme: gaia -->` directives work because marp-core ships gaia/uncover/default.

## Acceptance

- Agent writing a markdown doc with `marp: true` frontmatter → right pane shows the Marp-rendered slide stack (not the markdown body)
- Removing `marp: true` → falls back to existing `<MarkdownView>` rendering (no regression)
- Export PDF button → PDF lands in `artifacts/documents/`, accessible via Files pane
- Chromium missing → Export PDF disabled + tooltip explanation
- 8 locales lockstep pass `vue-tsc`
- `yarn format` / `lint` / `typecheck` / `build` / `test` all green

## Out of scope (future)

- Slide pagination / keyboard nav
- PPTX / HTML / PNG export
- Per-slide thumbnails sidebar
- Marp theme picker UI
- "Convert presentMulmoScript ↔ Marp" round-trip
