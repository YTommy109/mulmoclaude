// Cross-surface DOM CustomEvent names the host emits for plugin /
// extension consumers. These ride the global `window` so runtime-
// loaded plugins (which can't import vue-router or other host
// internals without extra plumbing) can subscribe via
// `addEventListener` without bringing in the whole host bundle.
//
// Centralised here as `as const` so the event-string contract is a
// single greppable value — host emitter and plugin subscriber can't
// drift independently (CodeRabbit review on PR #1198).

export const HOST_EVENTS = {
  /** Fired by the SPA router on every commit (including query-only
   *  changes that don't remount the matched component). Detail
   *  shape: `{ fullPath: string }`. Currently consumed by
   *  `@mulmoclaude/debug-plugin` to re-read URL query params. */
  routeChange: "mulmoclaude:routechange",
} as const;
