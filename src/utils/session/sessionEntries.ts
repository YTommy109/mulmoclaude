// Pure helpers for reconstructing an `ActiveSession`'s runtime
// shape from the `/api/sessions/:id` JSONL payload. Extracted from
// `src/App.vue#loadSession` so the parse / select / timestamp-
// resolution logic is unit-testable without mocking `fetch`.
//
// Tracks #175.

import { makeSkillResult, makeTextResult, TEXT_LIKE_RESULT_TOOL_NAMES } from "../tools/result";
import {
  isSessionOrigin,
  isSkillEntry,
  isTextEntry,
  isToolResultEntry,
  pluginPkgFromOrigin,
  type ActiveSession,
  type SessionEntry,
  type SessionOrigin,
  type SessionSummary,
} from "../../types/session";
import { EVENT_TYPES } from "../../types/events";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

// Pull origin off the `session_meta` row in the entries payload, if
// present. The on-disk meta is the source of truth; the server fills
// `SessionSummary.origin` from it but the summary fetch (`/api/sessions`)
// races with the per-session detail fetch (`/api/sessions/:id`) on
// first mount of `/chat/<id>`. Codex review on PR #1237 caught this:
// without an entries-side fallback, plugin-seeded chats opened
// directly via URL miss the chip until the user navigates away and
// back. Returns undefined when no meta row exists or its origin is
// missing / malformed.
function extractMetaOrigin(entries: readonly SessionEntry[]): SessionOrigin | undefined {
  for (const entry of entries) {
    if (entry.type === EVENT_TYPES.sessionMeta) {
      const candidate = (entry as { origin?: unknown }).origin;
      return isSessionOrigin(candidate) ? candidate : undefined;
    }
  }
  return undefined;
}

// Walk the server's session entries and produce the flat
// `toolResults` array the client keeps in `ActiveSession`. Drops
// `session_meta` rows (they're metadata, not a result), converts
// text entries into tool-result-shaped envelopes via
// `makeTextResult`, and passes tool_result entries through verbatim.
//
// When the effective origin is a `plugin:<pkg>` tag (Phase 1 of the
// Encore plan), the FIRST user text entry is marked with
// `seededByPlugin` so the textResponse view renders a "from <pkg>"
// chip + muted background, indicating the seed message came from a
// plugin's `runtime.chat.start()` call rather than the user
// themselves. The effective origin prefers the explicit
// `sessionOrigin` argument (from the summary) and falls back to the
// `session_meta` row in `entries` so URL-loaded chats render the
// chip even before the summary fetch resolves.
export function parseSessionEntries(entries: readonly SessionEntry[], sessionOrigin?: SessionOrigin): ToolResultComplete[] {
  const effectiveOrigin = sessionOrigin ?? extractMetaOrigin(entries);
  const seedingPkg = pluginPkgFromOrigin(effectiveOrigin);
  let firstUserSeen = false;
  const out: ToolResultComplete[] = [];
  for (const entry of entries) {
    if (entry.type === EVENT_TYPES.sessionMeta) continue;
    if (isSkillEntry(entry)) {
      // Skill bodies are routed through the dedicated skill plugin
      // View (collapsed by default) so they don't dump a wall of
      // markdown into the canvas. #1218.
      out.push(makeSkillResult(entry));
    } else if (isTextEntry(entry)) {
      const tagThis = !firstUserSeen && entry.source === "user" && seedingPkg !== null;
      const seededBy = tagThis ? seedingPkg : undefined;
      if (entry.source === "user") firstUserSeen = true;
      out.push(makeTextResult(entry.message, entry.source, entry.attachments, seededBy ?? undefined));
    } else if (isToolResultEntry(entry)) {
      out.push(entry.result);
    }
  }
  return out;
}

// Pick the `selectedResultUuid` the session should restore to.
// Rules:
//   1. If the URL carries `?result=<uuid>` AND that uuid actually
//      exists in the loaded list, honour it verbatim — bookmarks
//      restore the exact result the user was viewing.
//   2. Otherwise pick the most recent non-text-like tool result —
//      images, wiki pages, etc. carry more visual information
//      than a bare text response or a collapsed skill card.
//   3. If every result is text-like (`text-response` or `skill`,
//      see `TEXT_LIKE_RESULT_TOOL_NAMES`), fall back to the last
//      one — typically the most recent assistant reply, NOT the
//      skill card that preceded it. Codex iter-4 review on PR
//      #1220 surfaced the inconsistency between this reload-time
//      selector and the live-run `shouldSelectAssistantText`
//      before they were unified on the same allowlist.
//   4. If the list is empty, return null.
//
export function resolveSelectedUuid(toolResults: readonly ToolResultComplete[], urlResult: string | null): string | null {
  if (urlResult && toolResults.some((result) => result.uuid === urlResult)) {
    return urlResult;
  }
  if (toolResults.length === 0) return null;
  // Iterate backwards for the "last non-text-like" lookup so
  // callers don't pay for an intermediate reverse copy.
  for (let i = toolResults.length - 1; i >= 0; i--) {
    if (!TEXT_LIKE_RESULT_TOOL_NAMES.has(toolResults[i].toolName)) {
      return toolResults[i].uuid;
    }
  }
  return toolResults[toolResults.length - 1].uuid;
}

// Decide the `startedAt` / `updatedAt` to seed the in-memory
// ActiveSession with. We prefer the server summary's timestamps
// so the restored session keeps its existing sidebar ordering;
// we fall through to the current clock only if the server
// summary is missing (e.g. freshly-created session that hasn't
// round-tripped through `/api/sessions` yet).
//
// Keeping this logic named lets the test suite pin the
// "updatedAt missing → fall back to startedAt" rule explicitly,
// which was previously a fragile `??` chain buried in loadSession.
export function resolveSessionTimestamps(serverSummary: SessionSummary | undefined, nowIso: string): { startedAt: string; updatedAt: string } {
  const startedAt = serverSummary?.startedAt ?? nowIso;
  const updatedAt = serverSummary?.updatedAt ?? startedAt;
  return { startedAt, updatedAt };
}

// Spread toolResults evenly between startedAt and updatedAt to
// approximate per-entry timestamps for sessions loaded from disk.
// Real-time results will overwrite with Date.now() via pushResult.
export function interpolateTimestamps(toolResults: readonly ToolResultComplete[], startedAt: string, updatedAt: string): Map<string, number> {
  const timestamps = new Map<string, number>();
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(updatedAt).getTime();
  toolResults.forEach((result, i) => {
    const frac = toolResults.length > 1 ? i / (toolResults.length - 1) : 0;
    timestamps.set(result.uuid, startMs + (endMs - startMs) * frac);
  });
  return timestamps;
}

// Build an ActiveSession from server-fetched entries + metadata.
// Pure — the caller is responsible for inserting into sessionMap
// and subscribing.
export function buildLoadedSession(opts: {
  id: string;
  entries: readonly SessionEntry[];
  defaultRoleId: string;
  urlResult: string | null;
  serverSummary: SessionSummary | undefined;
  nowIso: string;
}): ActiveSession {
  const { id, entries, defaultRoleId, urlResult, serverSummary, nowIso } = opts;
  const meta = entries.find((entry) => entry.type === EVENT_TYPES.sessionMeta);
  const roleId = meta?.roleId ?? defaultRoleId;
  const toolResults = parseSessionEntries(entries, serverSummary?.origin);
  const selectedResultUuid = resolveSelectedUuid(toolResults, urlResult);
  const { startedAt, updatedAt } = resolveSessionTimestamps(serverSummary, nowIso);
  const resultTimestamps = interpolateTimestamps(toolResults, startedAt, updatedAt);

  return {
    id,
    roleId,
    toolResults,
    resultTimestamps,
    isRunning: serverSummary?.isRunning ?? false,
    statusMessage: serverSummary?.statusMessage ?? "",
    toolCallHistory: [],
    selectedResultUuid,
    hasUnread: serverSummary?.hasUnread ?? false,
    startedAt,
    updatedAt,
    runStartIndex: toolResults.length,
    pendingGenerations: {},
  };
}
