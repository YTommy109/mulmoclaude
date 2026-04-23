// Pure helpers for the "show session history side-panel" preference.
//
// Independent of layoutMode (single vs stack) — this toggle controls
// whether `SessionHistoryPanel` is rendered as a standalone column
// to the left of the existing chat sidebar / canvas. Persisted in
// localStorage so the user's choice survives reloads.
//
// Only takes effect on `/chat`; non-chat pages ignore the preference
// (they already have their own canvas content).

export const SHOW_SESSION_HISTORY_STORAGE_KEY = "chat_show_session_history";

// Default is OFF — the feature is opt-in so the existing two-column
// layout keeps working for users who never click the toggle.
export function parseStoredShowSessionHistory(stored: string | null): boolean {
  return stored === "1" || stored === "true";
}

export function serializeShowSessionHistory(value: boolean): string {
  return value ? "1" : "0";
}
