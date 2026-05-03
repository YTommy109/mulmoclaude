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
import { API_ROUTES } from "../../config/apiRoutes";

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

/** Allowlisted URL schemes for `runtime.openUrl`. The two http schemes
 *  cover the legitimate "open this external page" use case; everything
 *  else (`javascript:`, `data:`, `vbscript:`, `file:`, custom schemes)
 *  is rejected. The `noopener,noreferrer` flags on `window.open`
 *  prevent the opened tab from snooping the opener but do NOT stop
 *  `javascript:` execution — that's why scheme filtering is the actual
 *  XSS guard. CodeRabbit review caught this on PR #1124. */
const OPEN_URL_ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

function makeOpenUrl(pkgName: string): BrowserPluginRuntime["openUrl"] {
  return (url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      console.warn(`[plugin/${pkgName}] openUrl rejected unparseable URL`, { url });
      return;
    }
    if (!OPEN_URL_ALLOWED_SCHEMES.has(parsed.protocol)) {
      console.warn(`[plugin/${pkgName}] openUrl rejected non-http(s) scheme`, { scheme: parsed.protocol });
      return;
    }
    // `noopener` prevents the opened tab from accessing `window.opener`
    // and snooping; `noreferrer` strips the Referer header so the
    // destination can't see what page sent the user. Forced at the
    // platform level so individual plugin links can't drop them.
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      // Popup blocker engaged.
      console.warn(`[plugin/${pkgName}] window.open returned null`, { url });
    }
  };
}

function makeDispatch(pkgName: string): BrowserPluginRuntime["dispatch"] {
  // Substitute `:pkg` in the contracted dispatch route. encodeURIComponent
  // collapses scoped names (`@org/pkg`) into one URL path segment;
  // the parameter pattern `:pkg` matches any segment.
  const url = API_ROUTES.plugins.runtimeDispatch.replace(":pkg", encodeURIComponent(pkgName));
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
