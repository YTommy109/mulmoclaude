// Vue-free server-facing barrel for every built-in plugin's MCP
// binding (ToolDefinition + REST endpoint). Sibling barrels:
//
//   - `src/plugins/index.ts`  — REGISTRATIONS with Vue View / Preview
//                                (frontend uses this; server can't —
//                                Vue dependency)
//   - `src/plugins/metas.ts`   — per-plugin META (toolName, apiRoutes,
//                                workspaceDirs, staticChannels). Both
//                                server and frontend safe.
//   - `src/plugins/server.ts`  — THIS FILE: server-only binding table
//                                (definition + MCP dispatch endpoint).
//                                Imports each plugin's `definition.ts`
//                                directly (no Vue, server-safe).
//
// Adding a plugin = one row to `BUILT_IN_SERVER_BINDINGS`. Server
// callers (`server/agent/plugin-names.ts`) iterate over this list
// — they don't need to know which plugins exist.
//
// External-package plugins (mindmap / quiz / present3d) live here
// alongside built-ins because their MCP wiring needs the same
// (definition, endpoint) pair; they don't have a per-plugin
// `meta.ts` because they aren't co-located in the source tree.

import type { ToolDefinition } from "gui-chat-protocol";

import accountingDef from "./accounting/definition";
import { META as accountingMeta } from "./accounting/meta";
import todoDef from "./todo/definition";
import { META as todoMeta } from "./todo/meta";
import schedulerCalendarDef from "./scheduler/calendarDefinition";
import schedulerAutomationsDef from "./scheduler/automationsDefinition";
import { META as schedulerCalendarMeta } from "./scheduler/calendarMeta";
import presentMulmoScriptDef from "./presentMulmoScript/definition";
import { META as presentMulmoScriptMeta } from "./presentMulmoScript/meta";
import manageSkillsDef from "./manageSkills/definition";
import { META as manageSkillsMeta } from "./manageSkills/meta";
import manageSourceDef from "./manageSource/definition";
import { META as manageSourceMeta } from "./manageSource/meta";
import presentHtmlDef from "./presentHtml/definition";
import { META as presentHtmlMeta } from "./presentHtml/meta";
import presentChartDef from "./chart/definition";
import { META as chartMeta } from "./chart/meta";
import presentDocumentDef from "./markdown/definition";
import { META as markdownMeta } from "./markdown/meta";
import presentSpreadsheetDef from "./spreadsheet/definition";
import { META as spreadsheetMeta } from "./spreadsheet/meta";
import generateImageDef from "./generateImage/definition";
import openCanvasDef from "./canvas/definition";
import { META as canvasMeta } from "./canvas/meta";
import editImagesDef from "./editImages/definition";
import { TOOL_DEFINITION as presentFormDef } from "./presentForm/definition";
import { META as presentFormMeta } from "./presentForm/meta";
import { TOOL_DEFINITION as createMindMapDef } from "@gui-chat-plugin/mindmap";
import { TOOL_DEFINITION as putQuestionsDef } from "@mulmochat-plugin/quiz";
import { TOOL_DEFINITION as present3DDef } from "@gui-chat-plugin/present3d";
import { API_ROUTES } from "../config/apiRoutes";
import type { PluginMeta } from "./meta-types";

export interface ServerPluginBinding {
  /** ToolDefinition object — the plugin's MCP-facing schema. The
   *  `name` field is the lookup key for the MCP tool registry. */
  readonly def: ToolDefinition;
  /** Where the MCP bridge POSTs tool calls for this plugin. */
  readonly endpoint: string;
}

/** Resolve a plugin's MCP-dispatch URL from its META: looks up
 *  `apiNamespace`+`apiRoutes[mcpDispatch]` in the host's API_ROUTES
 *  registry and returns the composed `url`. Throws on a META that
 *  doesn't declare both fields — the binding can't dispatch without
 *  them. The lookup-by-namespace lets the host pick up route shape
 *  changes (path / verb edits) without `BUILT_IN_SERVER_BINDINGS`
 *  needing to know the URL. */
function mcpEndpoint(meta: PluginMeta): string {
  if (!meta.apiNamespace || !meta.mcpDispatch) {
    throw new Error(`Plugin "${meta.toolName}" cannot register MCP binding: missing apiNamespace or mcpDispatch in META`);
  }
  const namespaceRecord = (API_ROUTES as unknown as Record<string, Record<string, { method: string; url: string }>>)[meta.apiNamespace];
  const route = namespaceRecord?.[meta.mcpDispatch];
  if (!route) {
    throw new Error(`Plugin "${meta.toolName}" mcpDispatch route "${meta.mcpDispatch}" not found under API_ROUTES.${meta.apiNamespace}`);
  }
  return route.url;
}

/** All built-in plugin MCP bindings. The two scheduler defs share
 *  one dispatch URL (the server splits calendar vs task actions via
 *  the action enum), so the automations binding is a deliberate
 *  cross-meta lookup against the calendar META. */
export const BUILT_IN_SERVER_BINDINGS: readonly ServerPluginBinding[] = [
  { def: todoDef, endpoint: mcpEndpoint(todoMeta) },
  // Accounting plugin: opt-in only (see plans/feat-accounting.md).
  // The Role layer gates exposure; this row only wires the MCP
  // bridge so an enabling Role can route tool calls.
  { def: accountingDef, endpoint: mcpEndpoint(accountingMeta) },
  { def: schedulerCalendarDef, endpoint: mcpEndpoint(schedulerCalendarMeta) },
  { def: schedulerAutomationsDef, endpoint: mcpEndpoint(schedulerCalendarMeta) },
  { def: presentMulmoScriptDef, endpoint: mcpEndpoint(presentMulmoScriptMeta) },
  { def: manageSkillsDef, endpoint: mcpEndpoint(manageSkillsMeta) },
  { def: manageSourceDef, endpoint: mcpEndpoint(manageSourceMeta) },
  { def: presentHtmlDef, endpoint: mcpEndpoint(presentHtmlMeta) },
  { def: presentChartDef, endpoint: mcpEndpoint(chartMeta) },
  { def: presentDocumentDef, endpoint: mcpEndpoint(markdownMeta) },
  { def: presentSpreadsheetDef, endpoint: mcpEndpoint(spreadsheetMeta) },
  { def: generateImageDef, endpoint: API_ROUTES.image.generate },
  { def: openCanvasDef, endpoint: mcpEndpoint(canvasMeta) },
  { def: editImagesDef, endpoint: API_ROUTES.image.edit },
  { def: presentFormDef, endpoint: mcpEndpoint(presentFormMeta) },
  { def: createMindMapDef, endpoint: API_ROUTES.plugins.mindmap },
  { def: putQuestionsDef, endpoint: API_ROUTES.plugins.quiz },
  { def: present3DDef, endpoint: API_ROUTES.plugins.present3d },
];
