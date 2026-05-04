// Built-in plugin registry — single source of truth for "which
// in-tree plugins ship in the bundle".
//
// Each plugin co-locates its TOOL_NAMES key with its Vue entry by
// exporting a `REGISTRATION` (singular) or `REGISTRATIONS` (array,
// for multi-entry plugins like scheduler). The barrel below imports
// each and concatenates into `BUILT_IN_PLUGINS`. The (name → entry)
// map in `src/tools/index.ts` is then derived generically — no
// per-plugin lines there.
//
// Adding a new built-in plugin:
//   1. Create `src/plugins/<name>/` with an `index.ts` that exports
//      `REGISTRATION: PluginRegistration` (or `REGISTRATIONS: PluginRegistration[]`).
//   2. Add the tool name to `src/config/toolNames.ts` (`TOOL_NAMES.x`).
//   3. Add a line below importing the registration and appending it
//      to `BUILT_IN_PLUGINS`.
//
// Renaming a tool: the value lives in `TOOL_NAMES` only. Changing it
// there ripples through the plugin's `REGISTRATION` (which
// references `TOOL_NAMES.x`) and any call site that reads the same
// constant. No drift between the central name list and the registry.
//
// Runtime-installed plugins (#1043 C-2) live in a separate registry
// and are merged at lookup time in `src/tools/index.ts:getPlugin`;
// the array below is build-time-bundled only.

import type { PluginRegistration } from "../tools/types";
import { TOOL_NAMES } from "../config/toolNames";

import { REGISTRATION as accountingRegistration } from "./accounting";
import { REGISTRATION as canvasRegistration } from "./canvas";
import { REGISTRATION as chartRegistration } from "./chart";
import { REGISTRATION as editImagesRegistration } from "./editImages";
import { REGISTRATION as generateImageRegistration } from "./generateImage";
import { REGISTRATION as manageSkillsRegistration } from "./manageSkills";
import { REGISTRATION as manageSourceRegistration } from "./manageSource";
import { REGISTRATION as markdownRegistration } from "./markdown";
import { REGISTRATION as presentFormRegistration } from "./presentForm";
import { REGISTRATION as presentHtmlRegistration } from "./presentHtml";
import { REGISTRATION as presentMulmoScriptRegistration } from "./presentMulmoScript";
import { REGISTRATIONS as schedulerRegistrations } from "./scheduler";
import { REGISTRATION as spreadsheetRegistration } from "./spreadsheet";
import { REGISTRATION as textResponseRegistration } from "./textResponse";
import { REGISTRATION as todoRegistration } from "./todo";
import { REGISTRATION as wikiRegistration } from "./wiki";

// External npm-distributed plugins. They predate the registration
// pattern and don't ship `REGISTRATION` exports of their own; wrap
// their plugin entry locally so the barrel surface stays uniform.
import MindMapPlugin from "@gui-chat-plugin/mindmap/vue";
import QuizPlugin from "@mulmochat-plugin/quiz/vue";
import Present3DPlugin from "@gui-chat-plugin/present3d/vue";

const externalRegistrations: PluginRegistration[] = [
  { toolName: TOOL_NAMES.createMindMap, entry: MindMapPlugin.plugin },
  { toolName: TOOL_NAMES.putQuestions, entry: QuizPlugin.plugin },
  { toolName: TOOL_NAMES.present3D, entry: Present3DPlugin.plugin },
];

// `@gui-chat-plugin/weather` is now installed via the user's
// workspace ledger (`~/mulmoclaude/plugins/plugins.json`) rather
// than as a build-time bundle. The View loads via the runtime-plugin
// dynamic-import path; no static import here. (Briefly registered as
// a preset in `server/plugins/preset-list.ts` — that wedged because
// users who'd already installed it via the ledger then saw a
// "name collides" warning on every boot. Until that double-source
// case is handled cleanly, no presets ship by default.)

export const BUILT_IN_PLUGINS: readonly PluginRegistration[] = [
  textResponseRegistration,
  todoRegistration,
  ...schedulerRegistrations,
  manageSkillsRegistration,
  manageSourceRegistration,
  wikiRegistration,
  accountingRegistration,
  presentMulmoScriptRegistration,
  markdownRegistration,
  spreadsheetRegistration,
  generateImageRegistration,
  presentFormRegistration,
  canvasRegistration,
  editImagesRegistration,
  presentHtmlRegistration,
  chartRegistration,
  ...externalRegistrations,
];
