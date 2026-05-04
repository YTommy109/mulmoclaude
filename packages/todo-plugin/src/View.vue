<script setup lang="ts">
// PR1 placeholder. The real frontend (View.vue + Preview.vue +
// composables/useTodos.ts) lives in `src/plugins/todo/` and is
// served by the static plugin map until PR4 moves it here.
//
// This file exists so vite's library-mode `entry: { vue: "src/vue.ts" }`
// can resolve a Vue component without producing an empty bundle. It
// is never mounted at runtime in PR1 — the static plugin's View is
// what shows up in the canvas.

defineProps<{ selectedResult?: unknown }>();
</script>

<template>
  <div class="todo-plugin-pr1-placeholder">
    todo-plugin (runtime, PR1 scaffold) — actual View not yet migrated; the static `src/plugins/todo/View.vue` is what renders.
  </div>
</template>
