<script setup lang="ts">
// Scope-provider wrapper for runtime plugin Vue components (#1110).
// Builds a per-plugin BrowserPluginRuntime and `provide`s it under
// PLUGIN_RUNTIME_KEY, so plugin descendants can pull it via
// `useRuntime()` from `gui-chat-protocol/vue`.
//
// One instance per mounted plugin component subtree. Mount this in
// the host's runtime plugin loader (the place that dynamically
// imports the plugin's `dist/vue.js` and instantiates its
// `viewComponent` / `previewComponent`).

import { provide } from "vue";
import { PLUGIN_RUNTIME_KEY } from "gui-chat-protocol/vue";
import { makeBrowserPluginRuntime } from "../utils/plugin/runtime";

interface Props {
  /** npm package name of the plugin whose subtree we're scoping. */
  pkgName: string;
  /** Optional URL map exposed to the plugin via `runtime.endpoints`.
   *  Multi-URL built-in plugins (todos, scheduler, mulmoScript, …)
   *  pass their endpoint group ({ method, url } records since #1141);
   *  runtime-loaded plugins (the common single-dispatch shape) omit
   *  this AND host-shared scopes (`files`, `imageStore`, `mcpTools`)
   *  pass plain string URLs. Treated opaquely here — each consumer
   *  asserts the shape it expects via `pluginEndpoints<E>(scope)`.
   *  Contract: `gui-chat-protocol@>=0.3.1`. */
  endpoints?: Readonly<Record<string, unknown>>;
}

const props = defineProps<Props>();

// Construct once — `pkgName` and `endpoints` are fixed for the
// lifetime of a mounted plugin. If the host needs to rotate the
// scope (rare), it should remount the entire wrapper rather than
// mutate either prop.
const runtime = makeBrowserPluginRuntime({ pkgName: props.pkgName, endpoints: props.endpoints });
provide(PLUGIN_RUNTIME_KEY, runtime);
</script>

<template>
  <slot />
</template>
