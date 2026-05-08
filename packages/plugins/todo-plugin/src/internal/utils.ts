// Tiny utilities the plugin needs that the runtime doesn't provide.
// Kept minimal (no host imports) so the plugin stays self-contained.

// `crypto.randomUUID()` is on globalThis in modern browsers and
// Node 20+. Avoiding `import { randomUUID } from "node:crypto"`
// because the plugin's vue.ts entry transitively pulls
// index.ts → handlers/items.ts → here during the browser bundle,
// and Vite externalises `node:*` for browsers — which would leave
// the import unresolved at runtime.
export function makeId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Minimal slugify for column ids. Lowercase alphanumeric + hyphens,
// trimmed, with a fallback when the input has no usable characters.
// The host's `server/utils/slug.ts` is more sophisticated (handles
// non-ASCII via base64-encoded hash); for column labels which are
// typed in by the user in the kanban UI a simple pass is plenty.
const MAX_SLUG_LEN = 60;

export function slugify(label: string, fallback: string): string {
  const normalised = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LEN);
  return normalised.length > 0 ? normalised : fallback;
}

export function disambiguateSlug(base: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
