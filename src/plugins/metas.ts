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

// ────────────────────────────────────────────────────────────────
// Collision detection
// ────────────────────────────────────────────────────────────────
//
// Aggregators spread plugin-owned records into host records. Without
// a guard, a plugin claiming a host-reserved key (`apiRoutesKey:
// "agent"`) or two plugins claiming the same key (both with
// `workspaceDirs.images`) would silently win the merge and route
// real traffic to the wrong handler.
//
// We don't `throw` at module load — that would brick the whole app
// for a single buggy plugin (especially relevant once user-installed
// runtime plugins land). Instead the helpers below are pure,
// returning collision lists; callers decide the policy:
//
//   - Built-in aggregators FILTER colliding plugin keys before merge
//     (host wins / first-registered plugin wins).
//   - `server/plugins/diagnostics.ts` collects the lists at boot,
//     surfaces them via `log.warn` + a system notification, and
//     persists them so a UI mounting later can still display them.

/** A plugin key colliding with a host-owned key in one aggregator. */
export interface HostPluginCollision {
  /** Aggregator label (`"API_ROUTES"`, `"WORKSPACE_DIRS"`, …). */
  label: string;
  /** The key claimed by both host and plugin. */
  key: string;
  /** `toolName` of the plugin claiming it. Empty for legacy callers
   *  that don't pass per-key plugin attribution. */
  plugin: string;
}

/** Two plugins claiming the same key in the same dimension. */
export interface IntraPluginCollision {
  /** Which dimension the duplicate appears in. */
  dimension: "toolName" | "apiRoutesKey" | "workspaceDirs" | "staticChannels";
  /** The duplicated key. */
  key: string;
  /** `toolName`s of the two plugins claiming it (first-registered, second). */
  plugins: [string, string];
}

/** Pure check — does any plugin key shadow a host key? Returns the
 *  list of colliding keys (empty when clean). Aggregators call this
 *  to decide which plugin keys to drop during the merge. */
export function findHostPluginCollisions(hostRecord: Readonly<Record<string, unknown>>, pluginRecord: Readonly<Record<string, unknown>>): readonly string[] {
  const hostKeys = new Set(Object.keys(hostRecord));
  return Object.keys(pluginRecord).filter((key) => hostKeys.has(key));
}

/** Build an attributed collision list — one entry per (key, plugin)
 *  pair, where `pluginAttribution[key]` names the plugin claiming
 *  that key. Used by aggregators that aggregate ACROSS plugins
 *  (workspaceDirs, staticChannels) where each key may come from a
 *  different plugin. */
export function attributeHostPluginCollisions(
  label: string,
  hostRecord: Readonly<Record<string, unknown>>,
  pluginRecord: Readonly<Record<string, unknown>>,
  pluginByKey: Readonly<Record<string, string>>,
): HostPluginCollision[] {
  return findHostPluginCollisions(hostRecord, pluginRecord).map((key) => ({ label, key, plugin: pluginByKey[key] ?? "" }));
}

interface KeyClaim {
  plugin: string;
  keys: readonly string[];
}

function findDuplicate(claims: readonly KeyClaim[], dimension: IntraPluginCollision["dimension"]): IntraPluginCollision[] {
  const seen = new Map<string, string>();
  const collisions: IntraPluginCollision[] = [];
  for (const { plugin, keys } of claims) {
    for (const key of keys) {
      const prior = seen.get(key);
      if (prior !== undefined) {
        // Two different plugins claim this key (or two plugins
        // share the same `toolName`, which is itself the bug).
        collisions.push({ dimension, key, plugins: [prior, plugin] });
      } else {
        seen.set(key, plugin);
      }
    }
  }
  return collisions;
}

/** Pure check — across all plugins, does any (toolName / apiRoutesKey
 *  / workspaceDirs key / staticChannels key) appear twice? Empty
 *  when clean. */
export function findIntraPluginCollisions(metas: readonly PluginMeta[]): IntraPluginCollision[] {
  const toolNameClaims: KeyClaim[] = metas.map((meta) => ({ plugin: meta.toolName, keys: [meta.toolName] }));
  const apiKeyClaims: KeyClaim[] = metas
    .filter((meta) => meta.apiRoutes !== undefined)
    .map((meta) => ({ plugin: meta.toolName, keys: [meta.apiRoutesKey ?? meta.toolName] }));
  const dirClaims: KeyClaim[] = metas
    .filter((meta) => meta.workspaceDirs !== undefined)
    .map((meta) => ({ plugin: meta.toolName, keys: Object.keys(meta.workspaceDirs ?? {}) }));
  const channelClaims: KeyClaim[] = metas
    .filter((meta) => meta.staticChannels !== undefined)
    .map((meta) => ({ plugin: meta.toolName, keys: Object.keys(meta.staticChannels ?? {}) }));
  return [
    ...findDuplicate(toolNameClaims, "toolName"),
    ...findDuplicate(apiKeyClaims, "apiRoutesKey"),
    ...findDuplicate(dirClaims, "workspaceDirs"),
    ...findDuplicate(channelClaims, "staticChannels"),
  ];
}

/** Filter a plugin record so only the keys that survive the merge
 *  policy remain: keys not claimed by the host, and not already
 *  claimed by an earlier plugin. Returns the cleaned record AND the
 *  list of (label, key, plugin) drops so diagnostics can report them. */
export function filterPluginKeys<V>(
  label: string,
  hostKeys: ReadonlySet<string>,
  pluginRecord: Readonly<Record<string, V>>,
  pluginByKey: Readonly<Record<string, string>>,
): { cleaned: Record<string, V>; dropped: HostPluginCollision[] } {
  const cleaned: Record<string, V> = {};
  const dropped: HostPluginCollision[] = [];
  for (const [key, value] of Object.entries(pluginRecord)) {
    if (hostKeys.has(key)) {
      dropped.push({ label, key, plugin: pluginByKey[key] ?? "" });
      continue;
    }
    cleaned[key] = value;
  }
  return { cleaned, dropped };
}

// Module-level: the intra-plugin collision list for the current
// `BUILT_IN_PLUGIN_METAS`. Computed once at module load.
// `server/plugins/diagnostics.ts` imports this; aggregators don't
// need to inspect it (they already drop second-registered keys at
// merge time — see `buildPluginAggregate` callers).
export const INTRA_PLUGIN_COLLISIONS: readonly IntraPluginCollision[] = findIntraPluginCollisions(BUILT_IN_PLUGIN_METAS);
