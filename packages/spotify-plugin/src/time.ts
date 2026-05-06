// Local time-constants. The plugin can't import host's
// `server/utils/time.ts` (the runtime is sandboxed), so we mirror
// the small constants we need. Keeping them in one module preserves
// the "no raw 1000 / 60000" lint convention plugin-side too.

export const ONE_SECOND_MS = 1000;
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
