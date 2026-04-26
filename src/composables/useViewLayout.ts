// View-layout state. Derives one value the template cares about:
//
//  - isStackLayout: true whenever the canvas column should be full-width
//    (no sidebar). This is the case for /chat in stack mode AND for
//    every non-chat page (/files, /todos, /wiki, etc.). Only /chat in
//    single mode shows the left sidebar.
//
// Also flips activePane between "sidebar" and "main" so arrow-key
// navigation follows whichever side of the layout is visible.

import { computed, watch, type ComputedRef, type Ref } from "vue";
import { LAYOUT_MODES, type LayoutMode } from "../utils/canvas/layoutMode";

export function useViewLayout(opts: {
  layoutMode: Ref<LayoutMode> | ComputedRef<LayoutMode>;
  isChatPage: Ref<boolean> | ComputedRef<boolean>;
  activePane: Ref<"sidebar" | "main">;
}) {
  const { layoutMode, isChatPage, activePane } = opts;

  const isStackLayout = computed(() => !(isChatPage.value && layoutMode.value === LAYOUT_MODES.single));

  watch(
    isStackLayout,
    (stack) => {
      activePane.value = stack ? "main" : "sidebar";
    },
    { immediate: true },
  );

  return {
    isStackLayout,
  };
}
