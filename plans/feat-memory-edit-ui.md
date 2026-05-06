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

- **Auto-regen index on human edits** — `publishFileChange` (the
  single chokepoint for "a workspace file just got written via the
  app") gets a hook that re-runs `regenerateTopicIndex` when the
  changed path is a topic file (`conversations/memory/<type>/*.md`).
  Async fire-and-forget; failures log but don't block the request.

A launcher button was considered and dropped: `conversations/memory/`
is already reachable via the existing Files button (drill 3 levels in
the tree, or click the index links inside `MEMORY.md`). Adding a 10th
top-bar button + 8-locale strings for a one-click shortcut is not
worth the chrome cost when the same flow is two more clicks via the
existing UI.

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

- `regenerateTopicIndex` walks all topic files, so calling it on
  every memory edit is O(N) per write. For our workspace size this
  is microsecond cost; concurrent writes are coalesced through a
  per-workspace FIFO chain (`chainRegen` in `topic-index-hook.ts`)
  so a fast burst of edits produces sequential rebuilds rather than
  racing on the readdir scan.
- `isTopicFilePath` enforces the same shape gate the writer uses
  (`isSafeTopicSlug`): lowercase alnum + `-` only, length 1–60, no
  dotdir subtree, no nesting under a type directory. A malformed
  file dropped manually under a type subdir won't trigger a regen
  for an entry the loader would later skip anyway.

## Tests

- `topic-detect` already tests the format-detection signal.
- `test_topic_index_hook.ts` covers the predicate on positive /
  negative paths plus the slug-shape gate, including the reserved
  `memory` slug (would alias `MEMORY.md` on case-insensitive
  filesystems).
