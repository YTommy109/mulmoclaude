import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME, type ChartEndpoints } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";

export interface ChartEntry {
  title?: string;
  type?: string;
  option: Record<string, unknown>;
}

export interface ChartDocument {
  title?: string;
  charts: ChartEntry[];
}

export interface PresentChartData {
  document: ChartDocument;
  title?: string;
  filePath: string;
}

const presentChartPlugin: ToolPlugin<PresentChartData> = {
  toolDefinition,

  async execute(_context, args) {
    const endpoints = pluginEndpoints<ChartEndpoints>("chart");
    const { method, url } = endpoints.create;
    const result = await apiCall<ToolResult<PresentChartData>>(url, { method, body: args });
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
  generatingMessage: "Rendering chart…",
  viewComponent: wrapWithScope("chart", View),
  previewComponent: wrapWithScope("chart", Preview),
};

export default presentChartPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: presentChartPlugin,
};
