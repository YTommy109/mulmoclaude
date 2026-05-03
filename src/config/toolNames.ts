// Single source of truth for every tool name (= MCP tool / plugin key)
// the app knows about. Centralised here so:
//
//   - `Role.availablePlugins` can be typed as `ToolName[]` and typos
//     get caught at compile time instead of silently dropping a
//     plugin at runtime
//   - grep for "every place that handles this tool" returns a list
//     of `TOOL_NAMES.x` references rather than free-form strings
//
// Naming is intentionally the literal string the server / MCP
// protocol / jsonl files expect.
//
// **Aggregator shape**: plugins that own their identity export their
// `toolName` from their `meta.ts` (via `BUILT_IN_PLUGIN_METAS`). This
// file auto-merges them into `TOOL_NAMES` so adding a plugin =
// register its META in `src/plugins/metas.ts`; this file untouched.
// Host-only tool names (textResponse, MCP tools, plus plugins not yet
// migrated to META) keep their literals in `HOST_TOOL_NAMES` below.
//
// First slice of issue #289 (item 4: tool name literals).

import {
  BUILT_IN_PLUGIN_METAS,
  buildPluginAggregate,
  filterPluginKeys,
  type BuiltInPluginMetas,
  type HostPluginCollision,
  type IntraPluginCollision,
} from "../plugins/metas";

const HOST_TOOL_NAMES = {
  // Text / base
  textResponse: "text-response",

  // Management plugins (not yet migrated to META)
  manageTodoList: "manageTodoList",
  // Calendar / Automations split (#824) — replaced the unified
  // `manageScheduler` so the LLM and chat-tool-result UI both have
  // a 1:1 mapping between tool name and domain.
  manageCalendar: "manageCalendar",
  manageAutomations: "manageAutomations",
  manageSkills: "manageSkills",
  manageSource: "manageSource",
  manageWiki: "manageWiki",

  // Presentational plugins
  presentMulmoScript: "presentMulmoScript",
  presentDocument: "presentDocument",
  presentSpreadsheet: "presentSpreadsheet",
  presentHtml: "presentHtml",
  presentChart: "presentChart",
  presentForm: "presentForm",
  present3D: "present3D",

  // Creation / generation
  createMindMap: "createMindMap",
  generateImage: "generateImage",
  editImages: "editImages",
  openCanvas: "openCanvas",

  // Interactive / media
  putQuestions: "putQuestions",
  weather: "weather",

  // MCP tools (server-side, not GUI plugins — registered in
  // `server/mcp-tools/`). Listed here because they appear in a
  // role's `availablePlugins` alongside GUI plugins.
  readXPost: "readXPost",
  searchX: "searchX",
  notify: "notify",
} as const;

// Plugin-owned tool names auto-merged from each plugin's META.
// The mapped type below preserves each plugin's literal toolName
// (e.g. `"manageAccounting"`) so `TOOL_NAMES.manageAccounting` is
// typed as the literal, not just `string`.
type PluginToolNamesMap<T extends BuiltInPluginMetas> = {
  readonly [K in T[number]["toolName"]]: K;
};

// First-write-wins aggregation. See `buildPluginAggregate`'s
// docblock — the merge itself enforces "first plugin claiming a
// `toolName` wins; later collisions are reported and dropped".
const {
  aggregate: pluginToolNamesAggregate,
  owner: TOOL_NAME_OWNER,
  collisions: TOOL_NAMES_INTRA_COLLISIONS_RAW,
} = buildPluginAggregate(BUILT_IN_PLUGIN_METAS, (meta) => ({ [meta.toolName]: meta.toolName }), "toolName");
export const TOOL_NAMES_INTRA_COLLISIONS: readonly IntraPluginCollision[] = TOOL_NAMES_INTRA_COLLISIONS_RAW;

const PLUGIN_TOOL_NAMES = pluginToolNamesAggregate as PluginToolNamesMap<BuiltInPluginMetas>;

// Drop any plugin tool name that collides with a host literal —
// silent override would route the LLM's calls to the wrong handler,
// so the host literal wins. Diagnostics are surfaced via the
// `TOOL_NAMES_HOST_COLLISIONS` export below (consumed by the server
// boot diagnostics module).
// Cast back to the literal-preserving map: `filterPluginKeys` only
// drops keys, so the surviving subset is still a valid
// `PluginToolNamesMap` shape.
const { cleaned: cleanedToolNames, dropped: TOOL_NAMES_DROPPED } = filterPluginKeys(
  "TOOL_NAMES",
  new Set(Object.keys(HOST_TOOL_NAMES)),
  PLUGIN_TOOL_NAMES,
  TOOL_NAME_OWNER,
);
const SAFE_PLUGIN_TOOL_NAMES = cleanedToolNames as PluginToolNamesMap<BuiltInPluginMetas>;
export const TOOL_NAMES_HOST_COLLISIONS: readonly HostPluginCollision[] = TOOL_NAMES_DROPPED;

export const TOOL_NAMES = {
  ...HOST_TOOL_NAMES,
  ...SAFE_PLUGIN_TOOL_NAMES,
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** Runtime predicate — useful when string input (URL param, JSON
 *  payload) needs to be narrowed to a known tool. */
export function isToolName(value: unknown): value is ToolName {
  if (typeof value !== "string") return false;
  return (Object.values(TOOL_NAMES) as readonly string[]).includes(value);
}

/** Array of all known tool names, in declaration order. */
export const ALL_TOOL_NAMES: readonly ToolName[] = Object.values(TOOL_NAMES);
