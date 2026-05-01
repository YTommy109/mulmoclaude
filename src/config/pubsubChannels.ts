// Single source of truth for every WebSocket pub/sub channel name
// the app publishes to or subscribes to. Keeping these in one file
// means:
//
//   - a rename is one edit instead of a grep-and-edit across
//     server + client
//   - typo-wise, publisher and subscriber can't drift (both import
//     the same const / factory)
//   - a new channel gets declared here first, then wired — the
//     declaration serves as a lightweight registry / audit list
//
// First slice of issue #289 (item 6: pub-sub channels).

/**
 * Channel for the per-session event stream. One per chat session.
 * Publishers: `server/session-store/index.ts` (tool results, status,
 * text chunks, switch-role, session_finished, …).
 * Subscribers: `src/App.vue` (one subscription per actively-viewed
 * session).
 */
export function sessionChannel(chatSessionId: string): string {
  return `session.${chatSessionId}`;
}

/**
 * Channel for "this workspace file just changed". One per workspace-
 * relative path. The path is normalised to POSIX separators so a
 * Windows publisher and a Linux subscriber agree on the channel name
 * (the workspace is per-machine, but tests, fixtures, and future
 * remote editing all benefit from a portable contract).
 *
 * Publishers: any route that writes to disk and wants the UI to
 * re-render — currently `presentHtml` (POST + PUT) and the markdown
 * `updateMarkdown` route.
 * Subscribers: `useFileChange(filePath)` — wired from
 * `presentHtml/View.vue` and `markdown/View.vue`.
 */
/** Normalise a workspace-relative path to the POSIX form used as both
 *  the `fileChannel` suffix and the `FileChannelPayload.path`. Exposed
 *  separately so publishers can share one normalised string between the
 *  channel name and the payload — keeping them in sync is the contract. */
export function toPosixWorkspacePath(workspaceRelativePath: string): string {
  // Replace backslashes too — covers both Windows (`\`) and any
  // pre-normalised mixed separators from upstream code.
  return workspaceRelativePath.split(/[\\/]/g).filter(Boolean).join("/");
}

export function fileChannel(workspaceRelativePath: string): string {
  return `file:${toPosixWorkspacePath(workspaceRelativePath)}`;
}

/** Payload published on `fileChannel(...)`. `mtimeMs` is the post-write
 *  `fs.stat().mtimeMs`; subscribers use it both as a cache-buster and
 *  as a monotonic clock to drop out-of-order events. */
export interface FileChannelPayload {
  path: string; // workspace-relative POSIX, matches the channel suffix
  mtimeMs: number;
}

/** Payload published on `PUBSUB_CHANNELS.sessions`.
 *  - Empty `{}` for ordinary "something changed, refetch" hints
 *    (run/finish, mark-read, bookmark toggle).
 *  - `{ deletedIds }` when sessions have been hard-deleted, so
 *    subscribers can drop them from their local caches without a
 *    full refetch (cursor diffs don't carry deletions). */
export interface SessionsChannelPayload {
  deletedIds?: string[];
}

/**
 * Channel for "the book list changed in the accounting plugin" — emitted
 * when a book is created, deleted, or renamed, or when `activeBookId`
 * flips. Carries no payload (subscribers refetch from /api/accounting).
 *
 * Publisher: `server/api/routes/accounting.ts` (mutating actions in
 * the book-management group).
 * Subscribers: BookSwitcher.vue / View.vue at the moment they need a
 * fresh book list.
 *
 * Per-book change events live on `accountingBookChannel(bookId)` below
 * — kept separate so a `JournalList.vue` viewing book A doesn't repaint
 * when the user creates book B from another window.
 */
export function accountingBookChannel(bookId: string): string {
  return `accounting:${bookId}`;
}

/** Payload published on `accountingBookChannel(bookId)`. The `kind`
 *  discriminator lets a subscriber decide what to refetch:
 *
 *  - `"journal"`  — addEntry / voidEntry hit the books at `period`.
 *                   Refetch the journal list and (if the View is
 *                   showing balances at or after `period`) the
 *                   relevant report.
 *  - `"opening"`  — setOpeningBalances. Affects every period from
 *                   the opening date forward; refetch everything
 *                   the View is showing.
 *  - `"accounts"` — chart-of-accounts mutation that may affect
 *                   aggregation (account type changed). Refetch
 *                   accounts and the active report.
 *  - `"snapshots-rebuilding"` / `"snapshots-ready"` — purely
 *                   informational; the View can show a "calculating"
 *                   spinner during rebuild, but the lazy-rebuild
 *                   safety net means a refetch always returns the
 *                   right answer regardless. */
export interface AccountingBookChannelPayload {
  kind: "journal" | "opening" | "accounts" | "snapshots-rebuilding" | "snapshots-ready";
  /** YYYY-MM. Present for `journal` (entry month) and the snapshot
   *  events (the earliest invalidated month). Absent for `opening`
   *  (which invalidates everything) and `accounts`. */
  period?: string;
}

/** Static pub/sub channel names. Factories for parameterised channels
 *  (e.g. `sessionChannel(id)`) live alongside as named helpers. */
export const PUBSUB_CHANNELS = {
  /** Sidebar "a session updated, please refetch" notification.
   *  Publisher: `server/session-store/index.ts#publishSessionsChanged`.
   *  Subscribers: `useSessionHistory` (purges deletedIds from the
   *  cached list), `useSessionSync` (purges deletedIds from
   *  sessionMap; refetches summaries for live state). */
  sessions: "sessions",
  /** Server-side debug heartbeat — wired through the task-manager
   *  demo counter. Useful for sanity-checking that the WS pipe is
   *  alive end-to-end. */
  debugBeat: "debug.beat",
  /** Broadcast push notifications to every open Web tab (scaffold for
   *  the in-app notification center #144). The test endpoint
   *  `POST /api/notifications/test` publishes here; the production
   *  triggers (scheduler / todo reminders / journal) will follow
   *  the same channel. Subscriber list starts empty — the UI lands
   *  in a separate PR. Payload: `{ message: string, firedAt: ISO8601 }`. */
  notifications: "notifications",
  /** Sent when the *list of books* changes in the accounting plugin
   *  (createBook / deleteBook / renames / activeBookId flips).
   *  Per-book data changes ride `accountingBookChannel(bookId)` instead.
   *  Subscribers: BookSwitcher.vue. Payload: empty `{}`. */
  accountingBooks: "accounting:books",
} as const;

export type StaticPubSubChannel = (typeof PUBSUB_CHANNELS)[keyof typeof PUBSUB_CHANNELS];
