// Vue entry — exports the canvas component the host runtime plugin
// loader dynamic-imports as `dist/vue.js`. Shape matches the bookmarks
// reference (`packages/bookmarks-plugin/src/vue.ts`).
//
// In PR1 the View is a placeholder; the real one moves here in PR4.

import View from "./View.vue";
import { TOOL_DEFINITION } from "./definition";

export const plugin = {
  toolDefinition: TOOL_DEFINITION,
  viewComponent: View,
};
