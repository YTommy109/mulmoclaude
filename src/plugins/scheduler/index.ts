// #824: two plugins share /api/scheduler — the server already dispatches per-action via TASK_ACTIONS, so each plugin
// just differs in the tool definition (action enum the LLM sees) and the View component.

import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import CalendarView from "./CalendarView.vue";
import AutomationsView from "./AutomationsView.vue";
import Preview from "./Preview.vue";
import AutomationsPreview from "./AutomationsPreview.vue";
import calendarDefinition, { TOOL_NAME as MANAGE_CALENDAR } from "./calendarDefinition";
import automationsDefinition, { TOOL_NAME as MANAGE_AUTOMATIONS, type SchedulerEndpoints } from "./automationsDefinition";
import { pluginEndpoints } from "../api";
import { apiPost } from "../../utils/api";
import { makeUuid } from "../../utils/id";

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

export interface SchedulerData {
  items: ScheduledItem[];
}

// `toolName` is captured so the result carries the matching name through to chat history and View lookup.
function makeExecute(toolName: typeof MANAGE_CALENDAR | typeof MANAGE_AUTOMATIONS): ToolPlugin<SchedulerData>["execute"] {
  return async function execute(_context, args) {
    const endpoints = pluginEndpoints<SchedulerEndpoints>("scheduler");
    const result = await apiPost<ToolResult<SchedulerData>>(endpoints.base, args);
    if (!result.ok) {
      return {
        toolName,
        uuid: makeUuid(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName,
      uuid: result.data.uuid ?? makeUuid(),
    };
  };
}

export const manageCalendarPlugin: ToolPlugin<SchedulerData> = {
  toolDefinition: calendarDefinition,
  execute: makeExecute(MANAGE_CALENDAR),
  isEnabled: () => true,
  generatingMessage: "Updating calendar...",
  viewComponent: CalendarView,
  previewComponent: Preview,
};

export const manageAutomationsPlugin: ToolPlugin<SchedulerData> = {
  toolDefinition: automationsDefinition,
  execute: makeExecute(MANAGE_AUTOMATIONS),
  isEnabled: () => true,
  generatingMessage: "Managing automations...",
  viewComponent: AutomationsView,
  // Cannot share Preview.vue with manageCalendar — Preview auto-refreshes from /api/scheduler (calendar items), and
  // the automations sidebar would otherwise show calendar data after the first refresh tick (#828 follow-up).
  previewComponent: AutomationsPreview,
};

// One plugin module, two tool registrations — see #824 split.
export const REGISTRATIONS: PluginRegistration[] = [
  { toolName: MANAGE_CALENDAR, entry: manageCalendarPlugin },
  { toolName: MANAGE_AUTOMATIONS, entry: manageAutomationsPlugin },
];
