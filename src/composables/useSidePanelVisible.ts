// localStorage-backed ref for the session-history side-panel flag.
// Mirrors the shape of useLayoutMode — one source of truth per chat
// UI preference, kept out of App.vue's already-large state surface.

import { ref, type Ref } from "vue";
import { SIDE_PANEL_VISIBLE_STORAGE_KEY, parseStoredSidePanelVisible, serializeSidePanelVisible } from "../utils/canvas/sidePanelVisible";

export function useSidePanelVisible(): {
  sidePanelVisible: Ref<boolean>;
  setSidePanelVisible: (value: boolean) => void;
  toggleSidePanelVisible: () => void;
} {
  const sidePanelVisible = ref<boolean>(parseStoredSidePanelVisible(localStorage.getItem(SIDE_PANEL_VISIBLE_STORAGE_KEY)));

  function setSidePanelVisible(value: boolean): void {
    sidePanelVisible.value = value;
    localStorage.setItem(SIDE_PANEL_VISIBLE_STORAGE_KEY, serializeSidePanelVisible(value));
  }

  function toggleSidePanelVisible(): void {
    setSidePanelVisible(!sidePanelVisible.value);
  }

  return { sidePanelVisible, setSidePanelVisible, toggleSidePanelVisible };
}
