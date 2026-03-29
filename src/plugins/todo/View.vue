<template>
  <div class="h-full bg-white flex flex-col p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-800">Todo List</h2>
      <span class="text-sm text-gray-500">{{ completedCount }}/{{ items.length }} completed</span>
    </div>

    <div v-if="items.length === 0" class="flex-1 flex items-center justify-center text-gray-400">
      No todo items yet
    </div>

    <ul v-else class="flex-1 overflow-y-auto space-y-2">
      <li
        v-for="item in items"
        :key="item.id"
        class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 group"
      >
        <input
          type="checkbox"
          :checked="item.completed"
          class="cursor-pointer"
          @change="toggle(item)"
        />
        <span
          class="flex-1 text-sm"
          :class="item.completed ? 'line-through text-gray-400' : 'text-gray-800'"
        >{{ item.text }}</span>
        <button
          class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs px-1"
          @click="remove(item)"
        >✕</button>
      </li>
    </ul>

    <button
      v-if="hasCompleted"
      class="mt-4 text-sm text-gray-500 hover:text-gray-700 self-start"
      @click="clearCompleted"
    >
      Clear completed
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TodoData, TodoItem } from "./index";

const props = defineProps<{ selectedResult: ToolResultComplete }>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const items = computed(() => (props.selectedResult.data as TodoData)?.items ?? []);
const completedCount = computed(() => items.value.filter((i) => i.completed).length);
const hasCompleted = computed(() => items.value.some((i) => i.completed));

async function callApi(body: Record<string, unknown>) {
  const response = await fetch("/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  emit("updateResult", { ...props.selectedResult, ...result, uuid: props.selectedResult.uuid });
}

function toggle(item: TodoItem) {
  callApi({ action: item.completed ? "uncheck" : "check", text: item.text });
}

function remove(item: TodoItem) {
  callApi({ action: "delete", text: item.text });
}

function clearCompleted() {
  callApi({ action: "clear_completed" });
}
</script>
