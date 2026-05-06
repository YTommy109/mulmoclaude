// Central-registry-facing metadata that the accounting plugin owns.
// Imported by host aggregators (`src/config/*` and
// `server/workspace/paths.ts`) which iterate over every plugin's
// META and merge automatically. Host code holds zero
// plugin-specific literals — when a constant is "produced by the
// plugin", the plugin is the source of truth.
//
// Browser-safe: no Vue imports, no server-only imports. Both server
// and frontend code can import this file.

import { definePluginMeta } from "../meta-types";

/** Single object the host aggregators iterate over. `definePluginMeta`
 *  type-checks the shape (typo / missing field surfaces at compile
 *  time) AND preserves nested literal types via TS 5.0+'s `const`
 *  type parameter. Helper functions / types specific to this plugin
 *  (e.g. `bookChannel(bookId)`, `BookChannelPayload`) live below as
 *  separate named exports — the META object only carries the static
 *  values that aggregate generically. */
export const META = definePluginMeta({
  toolName: "manageAccounting",
  apiNamespace: "accounting",
  apiRoutes: {
    /** POST /api/accounting — single dispatch with action discriminator. */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
  // Flat keys merged into the central `WORKSPACE_DIRS`. Created
  // lazily on first `createBook` so default workspaces don't get a
  // stub `accounting/` they never use.
  workspaceDirs: {
    accounting: "data/accounting",
    // `accounting/books/<bookId>/{accounts.json, journal/YYYY-MM.jsonl,
    //  snapshots/YYYY-MM.json}` — multi-book layout (#1078).
    accountingBooks: "data/accounting/books",
  },
  // Static pubsub channel names merged into the central
  // `PUBSUB_CHANNELS`. Per-book data changes ride
  // `bookChannel(bookId)` (helper below); book-list-level events
  // (a new book was created, an existing one was deleted) ride
  // `accountingBooks` so a `JournalList.vue` viewing book A doesn't
  // repaint when the user creates book B from another window.
  staticChannels: {
    accountingBooks: "accounting:books",
  },
});

/** Channel factory for per-book event streams. Subscribers:
 *  `useAccountingChannel(bookId)`. Publisher:
 *  `server/accounting/eventPublisher.ts`. */
export function bookChannel(bookId: string): string {
  return `accounting:${bookId}`;
}

/** Event kinds that ride `bookChannel(bookId)`. Single source of
 *  truth for both publishers (server/accounting) and subscribers
 *  (the View) — anyone branching on event kind imports from here
 *  and the type system catches drift on either side.
 *
 *  - `journal`             — addEntry / voidEntry hit the books at `period`.
 *                            Refetch the journal list and (if the View is
 *                            showing balances at or after `period`) the
 *                            relevant report.
 *  - `opening`             — setOpeningBalances. Affects every period from
 *                            the opening date forward; refetch everything.
 *  - `accounts`            — chart-of-accounts mutation that may affect
 *                            aggregation (account type changed). Refetch
 *                            accounts and the active report.
 *  - `snapshotsRebuilding` / `snapshotsReady` — purely informational;
 *                            the View can show a "calculating" spinner
 *                            during rebuild, but the lazy-rebuild safety
 *                            net means a refetch always returns the right
 *                            answer regardless. */
export const BOOK_EVENT_KINDS = {
  journal: "journal",
  opening: "opening",
  accounts: "accounts",
  snapshotsRebuilding: "snapshots-rebuilding",
  snapshotsReady: "snapshots-ready",
} as const;

export type BookEventKind = (typeof BOOK_EVENT_KINDS)[keyof typeof BOOK_EVENT_KINDS];

/** Payload published on `bookChannel(bookId)`. */
export interface BookChannelPayload {
  kind: BookEventKind;
  /** YYYY-MM. Present for `journal` (entry month) and the snapshot
   *  events (the earliest invalidated month). Absent for `opening`
   *  (which invalidates everything) and `accounts`. */
  period?: string;
}
