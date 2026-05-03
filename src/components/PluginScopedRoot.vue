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
}

const props = defineProps<Props>();

// Construct once — `pkgName` is fixed for the lifetime of a mounted
// plugin. If the host needs to rotate the scope (rare), it should
// remount the entire wrapper rather than mutate `pkgName`.
const runtime = makeBrowserPluginRuntime({ pkgName: props.pkgName });
provide(PLUGIN_RUNTIME_KEY, runtime);
</script>

<template>
  <slot />
</template>
