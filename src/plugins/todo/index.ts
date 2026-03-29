import type { ToolPlugin } from "../../tools/types";
import View from "./View.vue";
import Preview from "./Preview.vue";

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

export interface TodoData {
  items: TodoItem[];
}

const todoPlugin: ToolPlugin<TodoData> = {
  toolDefinition: {
    type: "function",
    name: "manageTodoList",
    description:
      "Manage a todo list — show items, add, update, check/uncheck, or delete them. Use this whenever the user mentions tasks, todos, or things to remember.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["show", "add", "delete", "update", "check", "uncheck", "clear_completed"],
          description: "Action to perform on the todo list.",
        },
        text: {
          type: "string",
          description:
            "For 'add': the todo item text. For 'delete', 'update', 'check', 'uncheck': partial text to find the item.",
        },
        newText: {
          type: "string",
          description: "For 'update' only: the replacement text.",
        },
      },
      required: ["action"],
    },
  },

  async execute(_context, args) {
    const response = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const result = await response.json();
    return {
      ...result,
      toolName: "manageTodoList",
      uuid: result.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Managing todos...",
  systemPrompt:
    "When users mention tasks, things to do, or ask about their todo list, use manageTodoList to help them track items.",
  viewComponent: View,
  previewComponent: Preview,
};

export default todoPlugin;
