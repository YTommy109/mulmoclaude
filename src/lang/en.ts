// English dictionary for vue-i18n.
//
// Structure is grouped by feature area (common, chat, session, ...).
// Prefer nested objects over flat keys so related strings stay
// together and the namespace serves as self-documentation.

// No `as const` — the module augmentation in src/types/vue-i18n.d.ts
// reads `typeof en` to feed `DefineLocaleMessage`, and readonly literal
// types would conflict with vue-i18n's writable message interface.

const en = {
  common: {
    save: "Save",
    cancel: "Cancel",
  },
  sessionTabBar: {
    newSession: "New session",
    sessionHistory: "Session history",
    // vue-i18n pluralization: `t(key, count)` picks singular / plural
    // based on the number. `{count}` is interpolated.
    activeSessions: "{count} active session (agent running) | {count} active sessions (agent running)",
    unreadReplies: "{count} unread reply | {count} unread replies",
  },
  chatInput: {
    placeholder: "Type a task...",
    expandEditor: "Expand editor",
    composeMessage: "Compose message",
    sendHint: "Cmd+Enter to send",
    send: "Send",
    fileTooLarge: "File too large ({sizeMB} MB). Maximum is 30 MB.",
  },
};

export default en;
