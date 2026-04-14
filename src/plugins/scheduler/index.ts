import type { ToolPlugin } from "../../tools/types";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

export interface SchedulerData {
  items: ScheduledItem[];
}

const schedulerPlugin: ToolPlugin<SchedulerData> = {
  toolDefinition,

  async execute(_context, args) {
    const response = await fetch("/api/scheduler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const result = await response.json();
    return {
      ...result,
      toolName: "manageScheduler",
      uuid: result.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Managing schedule...",
  viewComponent: View,
  previewComponent: Preview,
};

export default schedulerPlugin;
