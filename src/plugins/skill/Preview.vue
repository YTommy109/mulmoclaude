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

const props = defineProps<{
  selectedResult: ToolResultComplete<SkillData>;
}>();

const skillName = computed(() => props.selectedResult.data?.skillName ?? "skill");
</script>
