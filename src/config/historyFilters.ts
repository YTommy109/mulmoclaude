// Filter keys for the session-history panel. Kept here (not in
// `types/session.ts`) because `all` and `unread` are UI concepts — not
// session-origin values — even though the four origin filters reuse
// `SESSION_ORIGINS` verbatim so a single source of truth stays per
// concept.

import { SESSION_ORIGINS } from "../types/session";

export const HISTORY_FILTERS = {
  all: "all",
  unread: "unread",
  human: SESSION_ORIGINS.human,
  scheduler: SESSION_ORIGINS.scheduler,
  skill: SESSION_ORIGINS.skill,
  bridge: SESSION_ORIGINS.bridge,
} as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[keyof typeof HISTORY_FILTERS];

// Display order for the pill row. `all` is always first; `unread` sits
// between `all` and the origin filters to mirror the existing
// hand-written order in SessionHistoryPanel.
export const HISTORY_FILTER_ORDER: readonly HistoryFilter[] = [
  HISTORY_FILTERS.all,
  HISTORY_FILTERS.unread,
  HISTORY_FILTERS.human,
  HISTORY_FILTERS.scheduler,
  HISTORY_FILTERS.skill,
  HISTORY_FILTERS.bridge,
] as const;
