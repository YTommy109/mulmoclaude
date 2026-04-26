// Computed properties derived from sessionMap + sessions list.
// Extracted from App.vue to reduce the component's reactive surface.

import { computed, type Ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ActiveSession, SessionSummary } from "../types/session";
import type { ToolCallHistoryItem } from "../types/toolCallHistory";
import { deduplicateResults } from "../utils/tools/dedup";

export function useSessionDerived(opts: { sessionMap: Map<string, ActiveSession>; currentSessionId: Ref<string>; sessions: Ref<SessionSummary[]> }) {
  const { sessionMap, currentSessionId, sessions } = opts;

  const activeSession = computed(() => sessionMap.get(currentSessionId.value));

  const toolResults = computed<ToolResultComplete[]>(() => activeSession.value?.toolResults ?? []);

  const sidebarResults = computed(() => deduplicateResults(toolResults.value));

  const currentSummary = computed(() => sessions.value.find((summary) => summary.id === currentSessionId.value));

  // Global "is anything running" across every known session — in-memory
  // map (which reflects pub/sub events faster than server refetch) and
  // server-side summaries (for sessions not yet hydrated into the map).
  // Used for consumers that must stay true across page navigation:
  // favicon spinner and the FilesView refresh watcher (which would
  // otherwise fire before a background run actually finishes, because
  // leaving /chat drops activeSession to undefined).
  const isRunning = computed(() => {
    for (const session of sessionMap.values()) {
      if (session.isRunning) return true;
      if (Object.keys(session.pendingGenerations).length > 0) return true;
    }
    return sessions.value.some((summary) => summary.isRunning);
  });

  // True only when the session on screen has a run in flight. Drives
  // UX touchpoints that should react per-session — ChatInput disable,
  // sendMessage guard, chat-list auto-scroll, pending-call row tick —
  // so a background run in session B doesn't disable the composer
  // while the user is actively chatting in session A.
  const activeSessionRunning = computed(() => {
    const active = activeSession.value;
    const pending = active ? Object.keys(active.pendingGenerations).length > 0 : false;
    return currentSummary.value?.isRunning || active?.isRunning || pending || false;
  });

  const statusMessage = computed(() => currentSummary.value?.statusMessage ?? activeSession.value?.statusMessage ?? "");

  const toolCallHistory = computed<ToolCallHistoryItem[]>(() => activeSession.value?.toolCallHistory ?? []);

  const activeSessionCount = computed(() => sessions.value.filter((session) => session.isRunning).length);

  const unreadCount = computed(() => sessions.value.filter((session) => session.hasUnread).length);

  return {
    activeSession,
    toolResults,
    sidebarResults,
    currentSummary,
    isRunning,
    activeSessionRunning,
    statusMessage,
    toolCallHistory,
    activeSessionCount,
    unreadCount,
  };
}
