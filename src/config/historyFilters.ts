// Filter keys for the `/history` page. Kept here (not in
// `types/session.ts`) because `all` and `unread` are UI concepts — not
// session-origin values — even though the four origin filters reuse
// `SESSION_ORIGINS` verbatim so a single source of truth stays per
// concept.
//
// The filter value is also a URL segment: `/history/unread`,
// `/history/human`, etc. `all` is represented by the bare `/history`
// URL, so it is excluded from `HISTORY_FILTER_ROUTE_PATTERN`.

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

// Pipe-joined pattern for the vue-router path param. Excludes `all`,
// which is represented by the bare `/history` URL.
export const HISTORY_FILTER_ROUTE_PATTERN: string = HISTORY_FILTER_ORDER.filter((value) => value !== HISTORY_FILTERS.all).join("|");

export function isHistoryFilter(value: unknown): value is HistoryFilter {
  return typeof value === "string" && HISTORY_FILTER_ORDER.includes(value as HistoryFilter);
}
