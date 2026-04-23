// localStorage-backed ref for the session-history side-panel toggle.
// Mirrors the shape of useLayoutMode — one source of truth per chat
// UI preference, kept out of App.vue's already-large state surface.

import { ref, type Ref } from "vue";
import { SHOW_SESSION_HISTORY_STORAGE_KEY, parseStoredShowSessionHistory, serializeShowSessionHistory } from "../utils/canvas/showSessionHistory";

export function useShowSessionHistory(): {
  showSessionHistory: Ref<boolean>;
  setShowSessionHistory: (value: boolean) => void;
  toggleShowSessionHistory: () => void;
} {
  const showSessionHistory = ref<boolean>(parseStoredShowSessionHistory(localStorage.getItem(SHOW_SESSION_HISTORY_STORAGE_KEY)));

  function setShowSessionHistory(value: boolean): void {
    showSessionHistory.value = value;
    localStorage.setItem(SHOW_SESSION_HISTORY_STORAGE_KEY, serializeShowSessionHistory(value));
  }

  function toggleShowSessionHistory(): void {
    setShowSessionHistory(!showSessionHistory.value);
  }

  return { showSessionHistory, setShowSessionHistory, toggleShowSessionHistory };
}
