// Vue entry — exports the canvas component the host runtime plugin
// loader dynamic-imports as `dist/vue.js`.
//
// Shape matches the existing `@gui-chat-plugin/*` convention so the
// host's loader (src/tools/runtimeLoader.ts) registers the components
// without special-casing factory-shape plugins:
//
//   plugin: { toolDefinition, viewComponent, previewComponent? }

import View from "./View.vue";
import { TOOL_DEFINITION } from "./definition";

export const plugin = {
  toolDefinition: TOOL_DEFINITION,
  viewComponent: View,
};
