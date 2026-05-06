// Vue entry — exports the canvas + preview components the host's
// runtime plugin loader dynamic-imports as `dist/vue.js`. Same shape
// as bookmarks-plugin / todo-plugin so the host's loader registers
// them without special-casing.

import View from "./View.vue";
import Preview from "./Preview.vue";
import { TOOL_DEFINITION } from "./definition";

export const plugin = {
  toolDefinition: TOOL_DEFINITION,
  viewComponent: View,
  previewComponent: Preview,
};
