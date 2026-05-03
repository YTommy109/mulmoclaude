import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition, { TOOL_NAME, type TodoEndpoints } from "./definition";
import { pluginEndpoints } from "../api";
import { apiPost } from "../../utils/api";
import { makeUuid } from "../../utils/id";

export type TodoPriority = "low" | "medium" | "high" | "urgent";

export interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
  completed: boolean;
  createdAt: number;
  // ── Added for the file-explorer kanban view ──
  status?: string;
  priority?: TodoPriority;
  dueDate?: string;
  order?: number;
}

export interface StatusColumn {
  id: string;
  label: string;
  isDone?: boolean;
}

export interface TodoData {
  items: TodoItem[];
  columns?: StatusColumn[];
}

const todoPlugin: ToolPlugin<TodoData> = {
  toolDefinition,

  async execute(_context, args) {
    const endpoints = pluginEndpoints<TodoEndpoints>("todos");
    const result = await apiPost<ToolResult<TodoData>>(endpoints.dispatch, args);
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
      uuid: result.data.uuid ?? makeUuid(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Managing todos...",
  viewComponent: View,
  previewComponent: Preview,
};

export default todoPlugin;

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: todoPlugin,
};
