# Memory edit UI (#1032)

After #1070 the topic memory layout is editable as plain markdown
files under `conversations/memory/<type>/<topic>.md`. Two missing
pieces stop the user from actually using the file explorer for it:

1. **Discoverability** — the user has to manually drill 3 levels
   down through the workspace tree (`conversations/` → `memory/` →
   `<type>/`) to reach a topic file.
2. **Index drift** — `MEMORY.md` is regenerated only on swap
   (during `runTopicMigrationOnce`). After a human edit / add /
   delete via the file explorer, the index goes stale.

This PR closes both.

## Scope

- **Launcher shortcut** — `PluginLauncher` gains a "Memory" button
  that routes to `/files/conversations/memory/MEMORY.md`. Same
  toolbar that already has todos / calendar / wiki / files; one
  more click target.
- **Auto-regen index on human edits** — `publishFileChange` (the
  single chokepoint for "a workspace file just got written via the
  app") gets a hook that re-runs `regenerateTopicIndex` when the
  changed path is a topic file (`conversations/memory/<type>/*.md`).
  Async fire-and-forget; failures log but don't block the request.
- **i18n** — 8-locale entries for `pluginLauncher.memory.{label,title}`.

## Out of scope

- **Agent-write coverage** — agent's raw `Write` tool bypasses the
  app routes, so `publishFileChange` is never called for agent
  writes. The agent context is rebuilt every turn from disk via
  `loadAllTopicFilesSync`, so the prompt itself stays fresh; only
  the on-disk `MEMORY.md` may lag behind the most recent agent
  edit. A periodic regen task is feasible but unnecessary for the
  primary "human browsing" path. Document with a TODO comment in
  the new hook; revisit if the lag is noticed.
- **Editor improvements** — the existing `FilesView` rendered-mode
  markdown editor (`useMarkdownDoc`) is reused as-is.
- A dedicated `/memory` route — the file explorer is the editor.

## Implementation notes

- The launcher key `"memory"` is NOT a real `PAGE_ROUTES` entry. So
  `App.vue#onPluginNavigate` special-cases it to push the deep-link
  URL instead of `router.push({ name })`.
- The active-state highlight (`isActive(target)`) compares against
  `activeViewMode` which is the page route name. When the user is
  on `/files/conversations/memory/...` the active page is `"files"`,
  not `"memory"`, so the Memory button stays unlit. Acceptable —
  the Files button lights up in that state, which is honest
  signaling.
- `regenerateTopicIndex` walks all topic files, so calling it on
  every memory edit is O(N) per write. For our workspace size this
  is microsecond cost; if it becomes a hotspot we can debounce.

## Tests

- `topic-detect` already tests the format-detection signal.
- New: a unit test for the publishFileChange hook predicate
  (matches `conversations/memory/<type>/*.md`, doesn't match
  unrelated paths or `.md` files at the memory root).
- New: PluginLauncher renders the memory button + emits navigate
  with the expected key.
- App.vue's `onPluginNavigate` special-case is small enough to
  cover via a focused unit test on a helper.
