# Plan: Render LLM-written wiki pages inline in chat (Stage 3a of manageWiki removal)

Tracking: #963

## Background

Claude Code's built-in Write/Edit tools let the LLM modify wiki pages
(`data/wiki/pages/*.md`) directly, bypassing the `manageWiki` MCP tool
that historically owned wiki I/O. Today the chat history renders these
tool calls as generic JSON — the user can't see the wiki page that was
just written.

PR #955 introduced a PostToolUse snapshot hook that captures the page
at the moment of every Write/Edit. The snapshot files at
`data/wiki/.history/<slug>/<stamp>-<shortId>.md` carry the full body +
frontmatter as it existed at that instant.

Stage 3a wires those two together: detect wiki Writes in the chat,
fetch the matching snapshot, render it inline in the assistant bubble.

Once Stage 3a is in place, `manageWiki` no longer needs to exist as a
display tool — Stage 3b will remove it.

## Scope

### In scope
1. Extract a pure `<WikiPagePreview>` component from
   `src/plugins/wiki/View.vue` (props: `slug`, `body`, `frontmatter?`).
   The existing `View.vue` continues to use it — no behavior change.
2. Server: confirm or add an endpoint that lists snapshots for a slug
   (so the client can pick the right one by timestamp).
   `readSnapshot(slug, stamp)` already exists.
3. Client tool-result detection: in the chat-history renderer, when a
   tool call has `toolName ∈ {Write, Edit}` and
   `toolInput.file_path` matches `data/wiki/pages/*.md`, render
   `<WikiWriteResult>` instead of the generic JSON view.
4. `<WikiWriteResult>` fetches the historical snapshot whose
   `_snapshot_ts` is the smallest `>= toolResultTs` for that slug, and
   renders it via `<WikiPagePreview>`.
5. Snapshot missing / not yet written → fall back to current page
   content with a small "showing latest" banner.
6. Tests: component test for `<WikiPagePreview>`, unit test for the
   snapshot-lookup matching logic, e2e for "LLM writes wiki → preview
   shows in chat".

### Out of scope (Stage 3b)
- Removing the `manageWiki` MCP tool definition
- Updating role prompts (the lint_report instruction etc.)
- Help docs (`server/workspace/helps/wiki.md`) updates
- StackView / dailyPass cleanup of `manageWiki` references

## Steps

### Step 1 — extract `<WikiPagePreview>` (refactor only)
- Pull the page-rendering markup out of `View.vue` into
  `src/plugins/wiki/components/WikiPagePreview.vue`
- Props: `{ slug: string, body: string, frontmatter?: Record<string, unknown> }`
- View.vue keeps its current data flow (calls `useFreshPluginData`,
  pulls the latest content) but renders the markup via the new
  component
- No behavior change; existing tests pass

### Step 2 — snapshot lookup (server)
- Audit existing endpoints under `/api/wiki/pages/:slug/history/*`
- If a "list snapshots for slug" endpoint is missing, add one that
  returns `[{ stamp, _snapshot_ts, _snapshot_editor, _snapshot_session }]`
  (metadata only — body comes from the per-stamp endpoint)
- Single-snapshot read endpoint already covered by `readSnapshot`

### Step 3 — `<WikiWriteResult>` component
- New component under `src/plugins/wiki/components/WikiWriteResult.vue`
- Props: `{ toolResult: ToolResultComplete }`
- Logic:
  1. Extract `slug` from `toolResult.toolInput.file_path`
  2. Fetch list of snapshots for slug (cache by slug)
  3. Pick the snapshot with smallest `_snapshot_ts >= toolResult.timestamp`
  4. Fetch that snapshot's body+meta (cache by slug+stamp)
  5. Render via `<WikiPagePreview>`
- Fallback: if no snapshot ≥ tool timestamp exists yet (race), show
  current page with banner

### Step 4 — wire into chat tool-result rendering
- Find the chat tool-result render dispatch (likely near `StackView.vue`
  or wherever per-tool customization could be inserted today)
- Add a per-tool dispatcher: `toolName === "Write" || "Edit"` AND path
  match → `<WikiWriteResult>`. Otherwise fall through to current
  generic JSON view
- Keep dispatcher pluggable so future per-tool views can join cleanly

### Step 5 — tests
- `test/plugins/wiki/test_wikiPagePreview.ts` — component test
- `test/plugins/wiki/test_snapshotLookup.ts` — match smallest
  `_snapshot_ts >= toolTs`, handle empty list, handle race (snapshot
  arrives later)
- `e2e/tests/chat-wiki-preview.spec.ts` — mock LLM Write on a wiki
  path, assert preview component visible, assert content matches
  snapshot (not "current") when snapshot differs

### Step 6 — i18n & docs
- New strings (banner text "showing latest content (snapshot pending)")
  added to all 8 locales in `src/lang/`
- `docs/ui-cheatsheet.md` updated if a new chat surface region warrants
  it (likely a small block next to the existing chat layout)
- `CLAUDE.md` not updated (no new convention)

## Snapshot timing — matching algorithm

The snapshot hook fires **after** the Write completes, so the
snapshot's `_snapshot_ts` is always slightly later than the tool
call's wire timestamp. Matching:

```
candidates = list_snapshots(slug)
            .filter(s => s._snapshot_ts >= toolResult.timestamp)
            .sort_by(s => s._snapshot_ts)
match = candidates[0]
```

Edge cases:

| Case | Behavior |
|---|---|
| No snapshots at all | Banner: "showing latest content (snapshot pending)", render current |
| Tool happened before #955 ship date | Same as above |
| Multiple Writes in same chat, same slug | Each tool call matches the next snapshot ≥ its own timestamp; correct ordering preserved |
| Hook failed to fire | Same as "no snapshots", graceful fallback |
| Snapshot arrives mid-render | One-time fetch on mount; banner stays until next reload |

## Open questions to resolve during implementation
- Where does the per-tool dispatcher live cleanly? `StackView.vue`
  likely needs a small refactor to invite extension. Resolve by
  reading the file before Step 4.
- Should the preview show the snapshot's `_snapshot_editor` /
  `_snapshot_session` metadata in a small footer? Default: no,
  keep visual noise low. Add only if user asks.

## Definition of done
- Existing `/wiki` UI and `manageWiki` tool calls behave identically to
  before (no regression)
- A fresh chat where LLM writes a wiki page shows the rendered wiki
  inline in the assistant bubble
- Replaying an older chat with manageWiki tool results still renders
  via `View.vue` (untouched)
- All 8 locales updated
- Lint / typecheck / build / unit / e2e green
- Codex cross-review LGTM

## Test plan (for the eventual PR description)
- [ ] Unit: `<WikiPagePreview>` renders body and frontmatter correctly
- [ ] Unit: snapshot lookup picks the smallest ≥ toolTs candidate
- [ ] Unit: snapshot lookup falls back gracefully on empty list
- [ ] E2E: LLM Write on wiki page → preview visible in assistant bubble
- [ ] E2E: LLM Edit on existing wiki page → preview shows post-edit body
- [ ] E2E: replay older chat with `manageWiki` action='page' result still
      renders correctly (regression check)
- [ ] Manual: open `/wiki` UI route — index, page view, lint_report all
      still work
