<template>
  <!-- Sidebar / chat-history thumbnail for a skill envelope.
       Single line: extension icon + skill name. The full body and
       description live behind the canvas's expand toggle. -->
  <div class="flex items-center gap-1.5 text-sm text-gray-700">
    <span class="material-icons text-purple-500 text-sm shrink-0">extension</span>
    <span class="truncate font-medium">{{ skillName }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { SkillData } from "./types";

// Sidebar previews are rendered with `:result="result"` (see
// SessionSidebar.vue), not `:selected-result`. Codex iter-2 review
// on PR #1220 — the previous prop name left `props.result`
// undefined and broke skill rendering in the chat-history sidebar.
const props = defineProps<{
  result: ToolResultComplete<SkillData>;
}>();

const skillName = computed(() => props.result.data?.skillName ?? "skill");
</script>
