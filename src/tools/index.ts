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

const plugins: Record<string, PluginEntry> = Object.fromEntries(BUILT_IN_PLUGINS.map((registration) => [registration.toolName, registration.entry]));

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
