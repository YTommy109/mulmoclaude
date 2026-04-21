// Computed properties derived from sessionMap + sessions list.
// Extracted from App.vue to reduce the component's reactive surface.

import { computed, type Ref } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ActiveSession, SessionSummary } from "../types/session";
import type { ToolCallHistoryItem } from "../types/toolCallHistory";
import { deduplicateResults } from "../utils/tools/dedup";

export function useSessionDerived(opts: {
  sessionMap: Map<string, ActiveSession>;
  currentSessionId: Ref<string>;
  sessions: Ref<SessionSummary[]>;
}) {
  const { sessionMap, currentSessionId, sessions } = opts;

  const activeSession = computed(() => sessionMap.get(currentSessionId.value));

  const toolResults = computed<ToolResultComplete[]>(
    () => activeSession.value?.toolResults ?? [],
  );

  const sidebarResults = computed(() => deduplicateResults(toolResults.value));

  const currentSummary = computed(() =>
    sessions.value.find((s) => s.id === currentSessionId.value),
  );

  const isRunning = computed(
    () =>
      currentSummary.value?.isRunning ??
      activeSession.value?.isRunning ??
      false,
  );

  const statusMessage = computed(
    () =>
      currentSummary.value?.statusMessage ??
      activeSession.value?.statusMessage ??
      "",
  );

  const toolCallHistory = computed<ToolCallHistoryItem[]>(
    () => activeSession.value?.toolCallHistory ?? [],
  );

  const activeSessionCount = computed(
    () => sessions.value.filter((s) => s.isRunning).length,
  );

  const unreadCount = computed(
    () => sessions.value.filter((s) => s.hasUnread).length,
  );

  return {
    activeSession,
    toolResults,
    sidebarResults,
    currentSummary,
    isRunning,
    statusMessage,
    toolCallHistory,
    activeSessionCount,
    unreadCount,
  };
}
