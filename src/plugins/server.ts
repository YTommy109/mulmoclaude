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
import todoDef from "./todo/definition";
import schedulerCalendarDef from "./scheduler/calendarDefinition";
import schedulerAutomationsDef from "./scheduler/automationsDefinition";
import presentMulmoScriptDef from "./presentMulmoScript/definition";
import manageSkillsDef from "./manageSkills/definition";
import manageSourceDef from "./manageSource/definition";
import presentHtmlDef from "./presentHtml/definition";
import presentChartDef from "./chart/definition";
import presentDocumentDef from "./markdown/definition";
import presentSpreadsheetDef from "./spreadsheet/definition";
import generateImageDef from "./generateImage/definition";
import openCanvasDef from "./canvas/definition";
import editImagesDef from "./editImages/definition";
import { TOOL_DEFINITION as presentFormDef } from "./presentForm/definition";
import { TOOL_DEFINITION as createMindMapDef } from "@gui-chat-plugin/mindmap";
import { TOOL_DEFINITION as putQuestionsDef } from "@mulmochat-plugin/quiz";
import { TOOL_DEFINITION as present3DDef } from "@gui-chat-plugin/present3d";
import { API_ROUTES } from "../config/apiRoutes";

export interface ServerPluginBinding {
  /** ToolDefinition object — the plugin's MCP-facing schema. The
   *  `name` field is the lookup key for the MCP tool registry. */
  readonly def: ToolDefinition;
  /** Where the MCP bridge POSTs tool calls for this plugin. */
  readonly endpoint: string;
}

/** All built-in plugin MCP bindings. Two scheduler defs share
 *  `scheduler.base` (calendar + automations are sub-actions of the
 *  same dispatch endpoint). */
export const BUILT_IN_SERVER_BINDINGS: readonly ServerPluginBinding[] = [
  { def: todoDef, endpoint: API_ROUTES.todos.dispatch },
  // Accounting plugin: opt-in only (see plans/feat-accounting.md).
  // The Role layer gates exposure; this row only wires the MCP
  // bridge so an enabling Role can route tool calls.
  { def: accountingDef, endpoint: API_ROUTES.accounting.dispatch },
  { def: schedulerCalendarDef, endpoint: API_ROUTES.scheduler.base },
  { def: schedulerAutomationsDef, endpoint: API_ROUTES.scheduler.base },
  { def: presentMulmoScriptDef, endpoint: API_ROUTES.mulmoScript.save },
  { def: manageSkillsDef, endpoint: API_ROUTES.skills.create },
  { def: manageSourceDef, endpoint: API_ROUTES.sources.manage },
  { def: presentHtmlDef, endpoint: API_ROUTES.html.present },
  { def: presentChartDef, endpoint: API_ROUTES.chart.present },
  { def: presentDocumentDef, endpoint: API_ROUTES.presentDocument.presentDocument },
  { def: presentSpreadsheetDef, endpoint: API_ROUTES.presentSpreadsheet.presentSpreadsheet },
  { def: generateImageDef, endpoint: API_ROUTES.image.generate },
  { def: openCanvasDef, endpoint: API_ROUTES.canvas.dispatch },
  { def: editImagesDef, endpoint: API_ROUTES.image.edit },
  { def: presentFormDef, endpoint: API_ROUTES.presentForm.dispatch },
  { def: createMindMapDef, endpoint: API_ROUTES.plugins.mindmap },
  { def: putQuestionsDef, endpoint: API_ROUTES.plugins.quiz },
  { def: present3DDef, endpoint: API_ROUTES.plugins.present3d },
];
