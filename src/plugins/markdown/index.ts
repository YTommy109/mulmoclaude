import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { API_ENDPOINT, TOOL_NAME } from "./definition";
import type { MarkdownToolData } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { makeUuid } from "../../utils/id";

const markdownPlugin: ToolPlugin<MarkdownToolData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<MarkdownToolData>>(API_ENDPOINT, args);
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
  generatingMessage: "Creating document...",
  viewComponent: View,
  previewComponent: Preview,
};

export default markdownPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: markdownPlugin,
};
