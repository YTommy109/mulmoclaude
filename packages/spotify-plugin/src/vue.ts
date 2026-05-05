// Vue entry — exports the canvas component the host runtime plugin
// loader dynamic-imports as `dist/vue.js`.
//
// PR 1 ships **no View** yet — the plugin's user-facing UI (Connect
// button, configure form for Client ID, scope display, error
// banners) lands in PR 2. The host loader gracefully handles a
// plugin without `viewComponent` (it just doesn't register a
// canvas slot for it), so this stub is enough to satisfy the
// loader's `dist/vue.js` dynamic import.

import { TOOL_DEFINITION } from "./definition";

export const plugin = {
  toolDefinition: TOOL_DEFINITION,
  // No viewComponent yet — PR 2 adds it.
};
