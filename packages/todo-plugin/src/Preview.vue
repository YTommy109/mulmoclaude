<template>
  <div class="p-2 text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span aria-hidden="true">{{ t("previewHeaderIcon") }}</span>
      <span>{{ t("completedRatio", { done: completedCount, total: items.length }) }}</span>
    </div>
    <div
      v-for="item in preview"
      :key="item.id"
      class="text-xs truncate flex items-center gap-1"
      :class="item.completed ? 'line-through text-gray-400' : 'text-gray-600'"
    >
      <span class="shrink-0">{{ item.completed ? t("previewDoneIcon") : t("previewPendingIcon") }}</span>
      <span class="truncate">{{ item.text }}</span>
      <template v-if="(item.labels?.length ?? 0) > 0">
        <span
          v-for="label in (item.labels ?? []).slice(0, 2)"
          :key="label"
          class="px-1 rounded-full text-[9px] font-medium shrink-0"
          :class="colorForLabel(label)"
          >{{ label }}</span
        >
        <span v-if="(item.labels?.length ?? 0) > 2" class="text-[9px] text-gray-400 shrink-0">{{
          t("previewMoreLabels", { count: (item.labels?.length ?? 0) - 2 })
        }}</span>
      </template>
    </div>
    <div v-if="more > 0" class="text-xs text-gray-400">{{ t("previewMoreItems", { count: more }) }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TodoData, TodoItem } from "./types";
import { colorForLabel } from "./labels";
import { useT, format } from "./lang";

const messages = useT();

function t(key: keyof typeof messages.value, params?: Record<string, string | number>): string {
  const template = messages.value[key];
  return params ? format(template, params) : template;
}

const props = defineProps<{ result: ToolResultComplete<TodoData> }>();

const items = ref<TodoItem[]>(props.result.data?.items ?? []);

const { dispatch, pubsub } = useRuntime();

interface ListResponse {
  data?: { items?: TodoItem[] };
}

async function refresh(): Promise<void> {
  try {
    const result = await dispatch<ListResponse>({ kind: "listAll" });
    if (Array.isArray(result.data?.items)) items.value = result.data.items;
  } catch {
    // Preview keeps its prop-initialised state on failure — silent
    // by design (it's a thumbnail, not the canonical view).
  }
}

let unsub: (() => void) | undefined;
onMounted(() => {
  unsub = pubsub.subscribe("changed", () => {
    void refresh();
  });
});
onUnmounted(() => unsub?.());

watch(
  () => props.result.uuid,
  () => {
    items.value = props.result.data?.items ?? [];
    void refresh();
  },
);
const completedCount = computed(() => items.value.filter((i) => i.completed).length);
const preview = computed(() => items.value.slice(0, 3));
const more = computed(() => Math.max(0, items.value.length - 3));
</script>
