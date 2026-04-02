<template>
  <div :class="['text-sm leading-snug', colorClass]">
    <div class="preview-markdown" v-html="renderedMarkdown" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import type { ToolResultComplete } from "gui-chat-protocol";
import type { TextResponseData } from "@gui-chat-plugin/text-response";

const props = defineProps<{
  result: ToolResultComplete<TextResponseData>;
}>();

const text = computed(() => props.result.data?.text ?? "");
const role = computed(() => props.result.data?.role ?? "assistant");

const colorClass = computed(() => {
  switch (role.value) {
    case "system":
      return "text-blue-700";
    case "user":
      return "text-green-700 font-medium";
    default:
      return "text-gray-700";
  }
});

const renderedMarkdown = computed(() =>
  marked(text.value, { breaks: true, gfm: true }),
);
</script>

<style scoped>
.preview-markdown {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
}

.preview-markdown :deep(p) {
  margin: 0;
  display: inline;
}

.preview-markdown :deep(h1),
.preview-markdown :deep(h2),
.preview-markdown :deep(h3),
.preview-markdown :deep(h4),
.preview-markdown :deep(h5),
.preview-markdown :deep(h6) {
  font-size: inherit;
  font-weight: bold;
  display: inline;
}

.preview-markdown :deep(ul),
.preview-markdown :deep(ol) {
  display: inline;
  margin: 0;
  padding: 0;
  list-style: none;
}

.preview-markdown :deep(li) {
  display: inline;
}

.preview-markdown :deep(li)::before {
  content: "• ";
}

.preview-markdown :deep(strong) {
  font-weight: bold;
}

.preview-markdown :deep(em) {
  font-style: italic;
}

.preview-markdown :deep(code) {
  font-family: monospace;
  font-size: 0.9em;
}

.preview-markdown :deep(pre) {
  display: inline;
  white-space: pre-wrap;
}
</style>
