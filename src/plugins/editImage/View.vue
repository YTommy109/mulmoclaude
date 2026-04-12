<template>
  <ImageView
    v-if="selectedResult"
    :selectedResult="selectedResult"
    alt="Edited image"
    prompt-label="Edit prompt"
  />
</template>

<script setup lang="ts">
import { ImageView } from "../ui-image";
import type { ToolResult } from "gui-chat-protocol";
import type { ImageToolData } from "./definition";

defineProps<{
  selectedResult: ToolResult<ImageToolData>;
}>();
</script>
