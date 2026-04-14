// Composable that wires all the window-level event listeners used by
// App.vue (click-outside handlers for 3 popups, global keydown for
// navigation + view-mode shortcuts, and the `roles-updated` custom
// event) and tears them down on unmount.
//
// Each listener is supplied as an option so the composable stays
// independent of App.vue's local state; the caller passes the
// already-bound handlers.

import { onMounted, onUnmounted } from "vue";

export interface EventListenerHandlers {
  /** Called when the manageRoles plugin dispatches a `roles-updated` CustomEvent. */
  onRolesUpdated: () => void | Promise<void>;
  /** Called when the manageSkills View dispatches a `skill-run` CustomEvent —
   *  detail.message is the composed prompt to send via the chat pipeline. */
  onSkillRun?: (message: string) => void;
  /** Global keydown for arrow-key navigation / Esc handling. */
  onKeyNavigation: (e: KeyboardEvent) => void;
  /** Global keydown for Cmd/Ctrl+1/2/3 view-mode shortcut. */
  onViewModeShortcut: (e: KeyboardEvent) => void;
  /** mousedown click-outside handlers for each popup. */
  onClickOutsideHistory: (e: MouseEvent) => void;
  onClickOutsideLock: (e: MouseEvent) => void;
  onClickOutsideRoleDropdown: (e: MouseEvent) => void;
  /** Called in onUnmounted after all window listeners are removed. */
  onTeardown?: () => void;
}

export function useEventListeners(handlers: EventListenerHandlers): void {
  // `skill-run` is a CustomEvent<{ message: string }>. We wrap the
  // caller's onSkillRun in a typed dispatcher so callers stay
  // unaware of the event shape.
  const skillRunWrapper = (e: Event): void => {
    if (!handlers.onSkillRun) return;
    const custom = e as CustomEvent<{ message?: unknown }>;
    const msg = custom.detail?.message;
    if (typeof msg === "string") handlers.onSkillRun(msg);
  };

  onMounted(() => {
    window.addEventListener("roles-updated", handlers.onRolesUpdated);
    window.addEventListener("keydown", handlers.onKeyNavigation);
    window.addEventListener("keydown", handlers.onViewModeShortcut);
    window.addEventListener("mousedown", handlers.onClickOutsideHistory);
    window.addEventListener("mousedown", handlers.onClickOutsideLock);
    window.addEventListener("mousedown", handlers.onClickOutsideRoleDropdown);
    if (handlers.onSkillRun) {
      window.addEventListener("skill-run", skillRunWrapper);
    }
  });

  onUnmounted(() => {
    window.removeEventListener("roles-updated", handlers.onRolesUpdated);
    window.removeEventListener("keydown", handlers.onKeyNavigation);
    window.removeEventListener("keydown", handlers.onViewModeShortcut);
    window.removeEventListener("mousedown", handlers.onClickOutsideHistory);
    window.removeEventListener("mousedown", handlers.onClickOutsideLock);
    window.removeEventListener(
      "mousedown",
      handlers.onClickOutsideRoleDropdown,
    );
    if (handlers.onSkillRun) {
      window.removeEventListener("skill-run", skillRunWrapper);
    }
    handlers.onTeardown?.();
  });
}
