import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME, type RolesEndpoints } from "./definition";
import { pluginEndpoints } from "../api";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { makeUuid } from "../../utils/id";

export interface CustomRole {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  availablePlugins: string[];
  queries?: string[];
}

export interface ManageRolesData {
  customRoles: CustomRole[];
}

const manageRolesPlugin: ToolPlugin = {
  toolDefinition,
  async execute(_context, args) {
    const endpoints = pluginEndpoints<RolesEndpoints>("roles");
    const result = await apiPost<ToolResult<ManageRolesData>>(endpoints.manage, args);
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
  generatingMessage: "Managing roles…",
  viewComponent: View,
  previewComponent: Preview,
};

export default manageRolesPlugin;
export { TOOL_NAME };
