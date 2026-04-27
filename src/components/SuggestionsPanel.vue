<template>
  <div v-if="expanded && queries.length > 0" ref="listRef" class="border-t border-gray-200 px-4 pt-2 pb-2 max-h-64 overflow-y-auto flex flex-col gap-1">
    <button
      v-for="query in queries"
      :key="query"
      class="text-left text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded px-3 py-1.5 border border-gray-300 transition-colors"
      @click="onClick($event, query)"
    >
      {{ query }}
    </button>
    <p class="text-center text-[10px] text-gray-400 py-0.5">{{ t("suggestionsPanel.sendEditHint") }}</p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  queries: string[];
  expanded: boolean;
}>();

const emit = defineEmits<{
  "update:expanded": [value: boolean];
  send: [query: string];
  edit: [query: string];
}>();

const listRef = ref<HTMLDivElement | null>(null);

watch(
  () => props.expanded,
  (isExpanded) => {
    if (!isExpanded) return;
    nextTick(() => {
      if (listRef.value) {
        listRef.value.scrollTop = listRef.value.scrollHeight;
      }
    });
  },
);

function onClick(event: MouseEvent, query: string): void {
  emit("update:expanded", false);
  if (event.shiftKey) {
    emit("edit", query);
    return;
  }
  emit("send", query);
}
</script>
