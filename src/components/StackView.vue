<template>
  <div
    ref="containerRef"
    class="h-full overflow-y-auto bg-gray-50 p-4 space-y-4"
  >
    <div
      v-if="toolResults.length === 0"
      class="flex items-center justify-center h-full text-gray-400 text-sm"
    >
      No results yet
    </div>
    <div
      v-for="result in toolResults"
      :key="result.uuid"
      :ref="(el) => setItemRef(result.uuid, el as HTMLElement | null)"
      class="bg-white rounded-lg border flex flex-col overflow-hidden transition-colors"
      :class="
        result.uuid === selectedResultUuid
          ? 'border-blue-400 ring-2 ring-blue-200'
          : 'border-gray-200'
      "
      :style="{ height: ITEM_HEIGHT }"
    >
      <button
        class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 text-left hover:bg-gray-50 shrink-0"
        :title="result.title || result.toolName"
        @click="emit('select', result.uuid)"
      >
        <span class="material-icons text-sm text-gray-400">{{
          iconFor(result.toolName)
        }}</span>
        <span class="text-sm font-medium text-gray-800 truncate">{{
          result.title || result.toolName
        }}</span>
        <span class="font-mono text-xs text-gray-400 ml-auto shrink-0">{{
          result.toolName
        }}</span>
      </button>
      <div class="flex-1 min-h-0 overflow-hidden">
        <component
          :is="getPlugin(result.toolName)?.viewComponent"
          v-if="getPlugin(result.toolName)?.viewComponent"
          :selected-result="result"
          :send-text-message="sendTextMessage"
          @update-result="(r: ToolResultComplete) => emit('updateResult', r)"
        />
        <pre
          v-else
          class="text-xs text-gray-500 whitespace-pre-wrap p-4 overflow-auto h-full"
          >{{ JSON.stringify(result, null, 2) }}</pre
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { getPlugin } from "../tools";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

// Each card is a fixed slice of viewport height. Plugin viewComponents
// rely on a defined parent height (most use h-full internally), so a
// fixed-height card is what lets them render naturally.
const ITEM_HEIGHT = "min(70vh, 720px)";

const props = defineProps<{
  toolResults: ToolResultComplete[];
  selectedResultUuid: string | null;
  sendTextMessage?: (text: string) => void;
}>();

const emit = defineEmits<{
  select: [uuid: string];
  updateResult: [result: ToolResultComplete];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const itemRefs = new Map<string, HTMLElement>();

function setItemRef(uuid: string, el: HTMLElement | null): void {
  if (el) itemRefs.set(uuid, el);
  else itemRefs.delete(uuid);
}

function iconFor(toolName: string): string {
  if (toolName === "text-response") return "chat";
  return "extension";
}

watch(
  () => props.selectedResultUuid,
  (uuid) => {
    if (!uuid) return;
    nextTick(() => {
      const el = itemRefs.get(uuid);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  },
);

watch(
  () => props.toolResults.length,
  () => {
    nextTick(() => {
      if (containerRef.value) {
        containerRef.value.scrollTop = containerRef.value.scrollHeight;
      }
    });
  },
);
</script>
