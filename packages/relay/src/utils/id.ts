// ID helper for the relay Worker. Copy of `src/utils/id.ts` — the
// relay is an independent npm package and can't import across
// repositories, so the helper is duplicated. Keep the two in sync
// when the signature changes. See issue #723 for the design
// rationale.

/**
 * Full UUID v4 (36 chars, hyphenated).
 *
 * Used as the per-message `id` on `RelayMessage` payloads emitted
 * from webhook handlers so the forwarding pipeline can de-dupe and
 * correlate replies.
 */
export function makeUuid(): string {
  return crypto.randomUUID();
}
