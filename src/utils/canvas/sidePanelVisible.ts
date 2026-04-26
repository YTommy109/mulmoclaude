// Pure helpers for the session-history side-panel visibility flag.
//
// `sidePanelVisible` is the single source of truth for whether the
// `SessionHistoryPanel` is rendered as a left column. When true the
// panel shows on every page and Row 2 (RoleSelector + SessionTabBar)
// is hidden; when false Row 2 shows and the panel is gone. Persisted
// in localStorage so the user's choice survives reloads.

export const SIDE_PANEL_VISIBLE_STORAGE_KEY = "side_panel_visible";

// Default is OFF — the feature is opt-in so the existing two-column
// layout keeps working for users who never click the toggle.
export function parseStoredSidePanelVisible(stored: string | null): boolean {
  return stored === "1" || stored === "true";
}

export function serializeSidePanelVisible(value: boolean): string {
  return value ? "1" : "0";
}
