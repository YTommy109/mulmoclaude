// Client-side ID helpers. Mirrors `server/utils/id.ts` for the
// frontend — see issue #723 for the full design rationale.
//
// The client only needs `makeUuid()` at the moment: all per-action
// tool-call `uuid` fields emitted by `src/plugins/*/index.ts`. If a
// client-side file-naming use case emerges, mirror `shortId()` from
// the server helper.

/**
 * Full UUID v4 (36 chars, hyphenated).
 *
 * Used as the per-action `uuid` on ToolResult payloads so the
 * renderer can track which action a result belongs to across a
 * session.
 */
export function makeUuid(): string {
  return crypto.randomUUID();
}
