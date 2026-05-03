// Browser-side plugin runtime construction (#1110). The host's runtime
// plugin loader provides one of these per plugin via Vue's
// `provide(PLUGIN_RUNTIME_KEY, ...)`; the plugin's components fetch
// it via `useRuntime()` from `gui-chat-protocol/vue`.
//
// Every helper closes over `pkgName` so the plugin's pubsub channel
// and notify call cannot leak into another plugin's namespace.

import { computed, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserPluginRuntime, PluginNotifyMessage } from "gui-chat-protocol/vue";
import { usePubSub } from "../../composables/usePubSub";
import { apiPost } from "../api";

/** Build the channel name for a plugin's event. Must stay in lockstep
 *  with `server/plugins/runtime.ts:pluginChannelName`. */
export function pluginChannelName(pkgName: string, eventName: string): string {
  return `plugin:${pkgName}:${eventName}`;
}

function makeScopedPubSub(pkgName: string): BrowserPluginRuntime["pubsub"] {
  const { subscribe } = usePubSub();
  return {
    subscribe(eventName, handler) {
      // The host pubsub fans payloads as `unknown`; the plugin
      // declares the expected shape via the generic at the call
      // site. Validation is the plugin's responsibility (Zod or
      // hand-written guard).
      return subscribe(pluginChannelName(pkgName, eventName), handler as (data: unknown) => void);
    },
  };
}

function makeScopedLogger(pkgName: string): BrowserPluginRuntime["log"] {
  // Frontend logger maps to `console.*` in v1. The host's central
  // logger lives server-side; routing browser logs there is a future
  // enhancement that doesn't change this surface.
  const tag = `[plugin/${pkgName}]`;
  return {
    debug: (msg, data) => console.debug(tag, msg, data),
    info: (msg, data) => console.info(tag, msg, data),
    warn: (msg, data) => console.warn(tag, msg, data),
    error: (msg, data) => console.error(tag, msg, data),
  };
}

function makeOpenUrl(pkgName: string): BrowserPluginRuntime["openUrl"] {
  return (url: string) => {
    // `noopener` prevents the opened tab from accessing `window.opener`
    // and snooping; `noreferrer` strips the Referer header so the
    // destination can't see what page sent the user. Forced at the
    // platform level so individual plugin links can't drop them.
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      // Popup blocker engaged or url malformed.
      console.warn(`[plugin/${pkgName}] window.open returned null`, { url });
    }
  };
}

function makeDispatch(pkgName: string): BrowserPluginRuntime["dispatch"] {
  // Encode the pkg name into the URL the same way the host's
  // runtime asset / dispatch routes expect (encodeURIComponent
  // collapses scoped names into one path segment).
  const url = `/api/plugins/runtime/${encodeURIComponent(pkgName)}/dispatch`;
  return async <T = unknown>(args: object): Promise<T> => {
    const result = await apiPost<T>(url, args);
    if (!result.ok) {
      throw new Error(`plugin/${pkgName} dispatch failed (${result.status}): ${result.error}`);
    }
    return result.data;
  };
}

function makeNotify(pkgName: string): BrowserPluginRuntime["notify"] {
  // Browser-side notify mirrors the API surface of the server-side
  // notify, but actual delivery happens server-side (the bell badge,
  // macOS Reminder, bridge fan-out, etc.). For v1 we just log;
  // hooking through to the host's notification channel from the
  // browser is a follow-up.
  return (msg: PluginNotifyMessage) => {
    console.info(`[plugin/${pkgName}] notify`, msg);
  };
}

export interface MakeBrowserPluginRuntimeDeps {
  /** npm package name. Used both as the namespace prefix for
   *  pubsub channels and as the log prefix. */
  pkgName: string;
}

export function makeBrowserPluginRuntime(deps: MakeBrowserPluginRuntimeDeps): BrowserPluginRuntime {
  const { pkgName } = deps;
  // `useI18n()` exposes `locale` as `WritableComputedRef<Locales>`.
  // Wrapping in a fresh `computed` widens it to `Ref<string>` for
  // plugin authors (so they don't need to import the host's locale
  // union) while preserving reactivity.
  const { locale: hostLocale } = useI18n();
  const locale = computed(() => String(hostLocale.value)) as Ref<string>;
  return {
    pubsub: makeScopedPubSub(pkgName),
    locale,
    log: makeScopedLogger(pkgName),
    openUrl: makeOpenUrl(pkgName),
    notify: makeNotify(pkgName),
    dispatch: makeDispatch(pkgName),
  };
}
