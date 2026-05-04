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
import { META as canvasMeta } from "./canvas/meta";
import { META as chartMeta } from "./chart/meta";
import { META as editImagesMeta } from "./editImages/meta";
import { META as generateImageMeta } from "./generateImage/meta";
import { META as manageSkillsMeta } from "./manageSkills/meta";
import { META as manageSourceMeta } from "./manageSource/meta";
import { META as markdownMeta } from "./markdown/meta";
import { META as presentFormMeta } from "./presentForm/meta";
import { META as presentHtmlMeta } from "./presentHtml/meta";
import { META as presentMulmoScriptMeta } from "./presentMulmoScript/meta";
import { META as schedulerAutomationsMeta } from "./scheduler/automationsMeta";
import { META as schedulerCalendarMeta } from "./scheduler/calendarMeta";
import { META as spreadsheetMeta } from "./spreadsheet/meta";
import { META as todoMeta } from "./todo/meta";

// `satisfies` (not `:`) so the literal types of every plugin's
// META survive into host aggregators — `TOOL_NAMES.manageAccounting`
// must end up with type `"manageAccounting"`, not `string`.
export const BUILT_IN_PLUGIN_METAS = [
  accountingMeta,
  canvasMeta,
  chartMeta,
  editImagesMeta,
  generateImageMeta,
  manageSkillsMeta,
  manageSourceMeta,
  markdownMeta,
  presentFormMeta,
  presentHtmlMeta,
  presentMulmoScriptMeta,
  schedulerAutomationsMeta,
  schedulerCalendarMeta,
  spreadsheetMeta,
  todoMeta,
] as const satisfies readonly PluginMeta[];

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

/** Build a first-write-wins aggregate of a per-plugin record across
 *  all plugins. Duplicate keys (= "intra-plugin collision") are
 *  reported in the returned `collisions` list with the first-claiming
 *  plugin AND the offender; the offender's value is dropped — runtime
 *  routes to the first plugin's handler.
 *
 *  This is the fix for Codex review iter-3+: previously each
 *  aggregator used `Object.fromEntries` / `Object.assign` to merge,
 *  which is JS-level last-write-wins. The diagnostic ran AFTER the
 *  merge and could only describe what was already lost, with the
 *  warning text contradicting actual behavior ("second is ignored"
 *  vs runtime's "second wins"). With this builder the merge IS the
 *  detection point — first-write semantics are enforced. */
export function buildPluginAggregate<V>(
  metas: readonly PluginMeta[],
  extract: (meta: PluginMeta) => Readonly<Record<string, V>> | undefined,
  dimension: IntraPluginCollision["dimension"],
): { aggregate: Record<string, V>; owner: Record<string, string>; collisions: IntraPluginCollision[] } {
  const aggregate: Record<string, V> = {};
  const owner: Record<string, string> = {};
  const collisions: IntraPluginCollision[] = [];
  for (const meta of metas) {
    const record = extract(meta);
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      const priorPlugin = owner[key];
      if (priorPlugin !== undefined) {
        // Two distinct plugins claim the same key. Keep the first
        // entry; report the offender so diagnostics can warn.
        collisions.push({ dimension, key, plugins: [priorPlugin, meta.toolName] });
        continue;
      }
      aggregate[key] = value;
      owner[key] = meta.toolName;
    }
  }
  return { aggregate, owner, collisions };
}

/** Filter a plugin record so only the keys that survive the merge
 *  policy remain: keys not claimed by the host. Returns the cleaned
 *  record AND the list of (label, key, plugin) drops so diagnostics
 *  can report them.
 *
 *  Intra-plugin collisions are filtered EARLIER by
 *  `buildPluginAggregate`; by the time this function runs the input
 *  is already first-write-wins-clean. */
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
