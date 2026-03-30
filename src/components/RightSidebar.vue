<template>
  <div
    class="w-80 flex-shrink-0 border-l border-gray-200 flex flex-col bg-white text-gray-900"
  >
    <div class="p-4 border-b border-gray-200 flex-shrink-0">
      <h2 class="text-lg font-semibold">Tool Call History</h2>
    </div>

    <div
      ref="historyContainer"
      class="flex-1 overflow-y-auto p-2 space-y-2 min-h-0 bg-gray-100"
    >
      <div
        v-if="toolCallHistory.length === 0"
        class="text-gray-400 text-sm text-center py-4"
      >
        No tool calls yet
      </div>
      <div
        v-for="(call, index) in toolCallHistory"
        :key="index"
        class="border border-gray-300 rounded p-3 bg-white text-xs space-y-1"
      >
        <div class="flex justify-between items-start gap-2">
          <span class="font-semibold text-blue-600 break-all">{{ call.toolName }}</span>
          <span class="text-gray-400 flex-shrink-0">{{ formatTime(call.timestamp) }}</span>
        </div>
        <div>
          <div class="font-medium text-gray-500 mb-1">Arguments</div>
          <pre class="bg-gray-50 p-2 rounded overflow-x-auto text-gray-700">{{ formatJson(call.args) }}</pre>
        </div>
        <div v-if="call.error">
          <div class="font-medium text-gray-500 mb-1">Error</div>
          <div class="bg-red-50 p-2 rounded text-red-700">{{ call.error }}</div>
        </div>
        <div v-else-if="call.result !== undefined">
          <div class="font-medium text-gray-500 mb-1">Result</div>
          <pre class="bg-green-50 p-2 rounded overflow-x-auto text-gray-700">{{ call.result }}</pre>
        </div>
        <div v-else>
          <div class="text-gray-400 italic">Running...</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from "vue";

export interface ToolCallHistoryItem {
  toolUseId: string;
  toolName: string;
  args: unknown;
  timestamp: number;
  result?: string;
  error?: string;
}

defineProps<{
  toolCallHistory: ToolCallHistoryItem[];
}>();

const historyContainer = ref<HTMLDivElement | null>(null);

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function scrollToBottom(): void {
  nextTick(() => {
    if (historyContainer.value) {
      historyContainer.value.scrollTop = historyContainer.value.scrollHeight;
    }
  });
}

defineExpose({ scrollToBottom });
</script>
