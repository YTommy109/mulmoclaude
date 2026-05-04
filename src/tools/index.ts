// Central tool registry. Two stages of lookup:
//
//   1. Build-time-bundled plugins (the "built-in" set) — assembled
//      generically from `BUILT_IN_PLUGINS` exported by
//      `src/plugins/index.ts`. Each plugin self-registers via a
//      `REGISTRATION` export co-locating `TOOL_NAMES.x` with its
//      `PluginEntry`. Adding a new built-in plugin does NOT touch
//      this file.
//
//   2. Runtime-installed plugins (#1043 C-2) — loaded from the
//      workspace ledger at boot via `runtimeLoader`. Looked up
//      after the built-in set so a static plugin always wins on
//      collision (mirrors the server-side collision policy in
//      `server/plugins/runtime-registry.ts`).

import type { PluginEntry } from "./types";
import { getRuntimePluginEntry, getRuntimeToolNames } from "./runtimeLoader";
import { BUILT_IN_PLUGINS } from "../plugins";

// Build the lookup with explicit duplicate detection. `BUILT_IN_PLUGINS`
// is the union of generated registrations (one per built-in META) and
// `EXTERNAL_PLUGIN_REGISTRATIONS` (still-unmigrated plugins). The
// META aggregator already screens its half for collisions, but a
// duplicate `toolName` between an external registration and a META
// would slip past `Object.fromEntries` silently with last-writer-wins.
// Throwing at boot is the right move — silent dispatch hijack is
// strictly worse than a hard error during start-up (CR review #1125).
//
// Use a null-prototype dictionary so:
//   1. The `in` / `hasOwn` check doesn't walk a prototype chain — a
//      legitimate `toolName` like `"toString"` or `"hasOwnProperty"`
//      can't false-positive as a duplicate.
//   2. The bracket assign at the end can't trigger `__proto__`
//      prototype-mutation semantics if a future registration value
//      ever flows from less-trusted code.
// Codex review on PR #1156.
const plugins: Record<string, PluginEntry> = (() => {
  const out: Record<string, PluginEntry> = Object.create(null);
  for (const registration of BUILT_IN_PLUGINS) {
    if (Object.prototype.hasOwnProperty.call(out, registration.toolName)) {
      throw new Error(`Duplicate built-in plugin registration for "${registration.toolName}"`);
    }
    out[registration.toolName] = registration.entry;
  }
  return out;
})();

export function getPlugin(name: string): PluginEntry | null {
  // Static (build-time) plugins win on collision — runtime plugins
  // are registered in mcp-server.ts only when their tool name does
  // not already exist in the static set, so this lookup order keeps
  // the contracts symmetric across server and frontend.
  return plugins[name] ?? getRuntimePluginEntry(name);
}

export function getAllPluginNames(): string[] {
  return [...BUILT_IN_PLUGINS.map((registration) => registration.toolName), ...getRuntimeToolNames()];
}
