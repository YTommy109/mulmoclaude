import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { PluginRegistration } from "../../tools/types";
import type { FormData, FormArgs } from "./types";
import { TOOL_DEFINITION } from "./definition";
import { executeForm } from "./plugin";
import { TOOL_NAMES } from "../../config/toolNames";
import View from "./View.vue";
import Preview from "./Preview.vue";

const presentFormPlugin: ToolPlugin<FormData, FormData, FormArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: executeForm,
  generatingMessage: "Preparing form...",
  isEnabled: () => true,
  viewComponent: View,
  previewComponent: Preview,
};

export default presentFormPlugin;
export { TOOL_NAME } from "./definition";

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAMES.presentForm,
  entry: presentFormPlugin,
};
