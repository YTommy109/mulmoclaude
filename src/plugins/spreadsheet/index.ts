import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME, type SpreadsheetEndpoints, type SpreadsheetToolData } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { makeUuid } from "../../utils/id";

const spreadsheetPlugin: ToolPlugin<SpreadsheetToolData> = {
  toolDefinition,

  async execute(_context, args) {
    const endpoints = pluginEndpoints<SpreadsheetEndpoints>("presentSpreadsheet");
    const result = await apiPost<ToolResult<SpreadsheetToolData>>(endpoints.presentSpreadsheet, args);
    if (!result.ok) {
      return {
        toolName: TOOL_NAME,
        uuid: makeUuid(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName: TOOL_NAME,
      uuid: makeUuid(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Creating spreadsheet...",
  viewComponent: wrapWithScope("presentSpreadsheet", View),
  previewComponent: wrapWithScope("presentSpreadsheet", Preview),
};

export default spreadsheetPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: spreadsheetPlugin,
};
