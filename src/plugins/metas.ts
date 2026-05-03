// Vue-free barrel of every built-in plugin's `META` (the central-
// registry-facing metadata). Host aggregators (src/config/*,
// server/workspace/paths.ts) iterate over `BUILT_IN_PLUGIN_METAS`
// and auto-merge per-dimension records — they never hold
// plugin-specific literals.
//
// Why a separate barrel from `src/plugins/index.ts`?
// `src/plugins/index.ts` exports `BUILT_IN_PLUGINS` (plugin
// REGISTRATIONS, including Vue View / Preview components). Server
// code can't import Vue, so this file gives server-side aggregators
// a Vue-free entry point that still co-locates the per-plugin
// metadata.
//
// Adding a new plugin: append the plugin's META import here AND a
// REGISTRATION import in `src/plugins/index.ts`. Both files live
// under `src/plugins/` so the change is plugin-local.

import type { PluginMeta } from "./meta-types";

import { META as accountingMeta } from "./accounting/meta";

// `satisfies` (not `:`) so the literal types of every plugin's
// META survive into host aggregators — `TOOL_NAMES.manageAccounting`
// must end up with type `"manageAccounting"`, not `string`.
export const BUILT_IN_PLUGIN_METAS = [accountingMeta] as const satisfies readonly PluginMeta[];

export type BuiltInPluginMetas = typeof BUILT_IN_PLUGIN_METAS;

/** Throw at module load if a plugin record's keys collide with the
 *  host record. Aggregators spread plugin keys *after* host keys,
 *  so without this guard a typo / rename in a plugin's meta.ts
 *  (e.g. a plugin claiming `apiRoutesKey: "agent"`) would silently
 *  shadow the host's `API_ROUTES.agent`. We'd rather fail fast with
 *  a named error than ship a silently-mis-routed app. */
export function assertNoPluginCollision(hostRecord: Readonly<Record<string, unknown>>, pluginRecord: Readonly<Record<string, unknown>>, label: string): void {
  const hostKeys = new Set(Object.keys(hostRecord));
  const collisions = Object.keys(pluginRecord).filter((key) => hostKeys.has(key));
  if (collisions.length > 0) {
    throw new Error(`${label}: plugin key(s) collide with host key(s): ${collisions.join(", ")}. Rename the colliding key in the plugin's meta.ts.`);
  }
}
