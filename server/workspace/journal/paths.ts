// Pure path / slug helpers for the workspace journal. Nothing here
// touches the filesystem — every function is a straightforward
// string transformation so it can be exhaustively unit-tested.

import path from "node:path";
import { WORKSPACE_DIRS } from "../paths.js";
import { isValidIsoDate } from "../../utils/date.js";
import { slugify as slugifyCanonical } from "../../utils/slug.js";

// Directory layout under workspace/conversations/summaries/ is an
// implementation detail of the journal module; keep it centralised
// here so tests and callers all agree on the structure.
export const SUMMARIES_DIR = WORKSPACE_DIRS.summaries;
export const STATE_FILE = "_state.json";
export const INDEX_FILE = "_index.md";
export const DAILY_DIR = "daily";
export const TOPICS_DIR = "topics";
export const ARCHIVE_DIR = "archive";

// Absolute path to the summaries root inside a workspace.
export function summariesRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, SUMMARIES_DIR);
}

// summaries/daily/YYYY/MM/DD.md for a given ISO-ish date ("YYYY-MM-DD").
// Throws if `isoDate` is not exactly YYYY-MM-DD — catches typos at
// the boundary instead of producing "undefined/undefined.md" paths
// downstream.
export function dailyPathFor(workspaceRoot: string, isoDate: string): string {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`[journal] dailyPathFor: expected YYYY-MM-DD, got "${isoDate}"`);
  }
  const [year, month, day] = isoDate.split("-");
  return path.join(summariesRoot(workspaceRoot), DAILY_DIR, year, month, `${day}.md`);
}

// summaries/topics/<slug>.md
export function topicPathFor(workspaceRoot: string, slug: string): string {
  return path.join(summariesRoot(workspaceRoot), TOPICS_DIR, `${slug}.md`);
}

// summaries/archive/topics/<slug>.md — where the optimizer moves
// merged or stale topic files.
export function archivedTopicPathFor(workspaceRoot: string, slug: string): string {
  return path.join(summariesRoot(workspaceRoot), ARCHIVE_DIR, TOPICS_DIR, `${slug}.md`);
}

// Re-export for backwards compatibility — callers that import
// toIsoDate from journal/paths keep working.
export { toLocalIsoDate as toIsoDate } from "../../utils/date.js";

// Convert a free-form topic name into a filesystem-safe slug. Thin
// wrapper around the canonical `slugify` (server/utils/slug.ts) with
// the journal-specific fallback "topic". See #732 for why journal
// stopped using its own ASCII-only impl: pure-non-ASCII topic names
// (e.g. "プロジェクトA" / "プロジェクトB") all collapsed to "topic"
// and silently overwrote each other's summary files.
export function slugify(raw: string): string {
  return slugifyCanonical(raw, "topic");
}
