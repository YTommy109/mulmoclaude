// Vue entry — the host runtime plugin loader dynamic-imports
// `dist/vue.js` and reads `plugin.viewComponent` to mount the canvas.

import View from "./View.vue";
import { TOOL_DEFINITION } from "./definition";

export const plugin = {
  toolDefinition: TOOL_DEFINITION,
  viewComponent: View,
};
