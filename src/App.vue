<template>
  <div class="flex h-screen bg-gray-900 text-white">
    <!-- Sidebar -->
    <div class="w-80 flex-shrink-0 border-r border-gray-700 flex flex-col">
      <div class="p-4 border-b border-gray-700">
        <h1 class="text-lg font-semibold">MulmoClaude</h1>
        <p class="text-sm text-gray-400">{{ currentRole.name }}</p>
      </div>

      <!-- Role selector -->
      <div class="p-4 border-b border-gray-700">
        <select
          v-model="currentRoleId"
          class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
          @change="onRoleChange"
        >
          <option v-for="role in roles" :key="role.id" :value="role.id">
            {{ role.name }}
          </option>
        </select>
      </div>

      <!-- Tool result previews -->
      <div class="flex-1 overflow-y-auto p-4 space-y-2">
        <div
          v-for="result in toolResults"
          :key="result.uuid"
          class="cursor-pointer rounded border p-2 text-sm"
          :class="result.uuid === selectedResultUuid ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 hover:border-gray-500'"
          @click="selectedResultUuid = result.uuid"
        >
          <component
            :is="getPlugin(result.toolName)?.previewComponent"
            v-if="getPlugin(result.toolName)?.previewComponent"
            :result="result"
          />
          <span v-else>{{ result.title || result.toolName }}</span>
        </div>
      </div>

      <!-- Text input -->
      <div class="p-4 border-t border-gray-700">
        <div class="flex gap-2">
          <input
            v-model="userInput"
            type="text"
            placeholder="Type a task..."
            class="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
            @keydown.enter="sendMessage()"
          />
          <button
            class="bg-blue-600 hover:bg-blue-700 rounded px-3 py-2 text-sm"
            :disabled="isRunning"
            @click="sendMessage()"
          >
            <span class="material-icons text-base">send</span>
          </button>
        </div>
        <p v-if="statusMessage" class="mt-2 text-xs text-gray-400">{{ statusMessage }}</p>
      </div>
    </div>

    <!-- Canvas -->
    <div class="flex-1 overflow-auto p-6">
      <div v-if="selectedResult">
        <component
          :is="getPlugin(selectedResult.toolName)?.viewComponent"
          v-if="getPlugin(selectedResult.toolName)?.viewComponent"
          :selected-result="selectedResult"
          :send-text-message="sendMessage"
          @update-result="handleUpdateResult"
        />
        <pre v-else class="text-sm text-gray-300 whitespace-pre-wrap">{{ JSON.stringify(selectedResult, null, 2) }}</pre>
      </div>
      <div v-else class="flex items-center justify-center h-full text-gray-600">
        <p>Start a conversation</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { v4 as uuidv4 } from "uuid";
import { ROLES } from "./config/roles";
import { getPlugin } from "./tools";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

const roles = ROLES;
const currentRoleId = ref(ROLES[0].id);
const currentRole = computed(() => ROLES.find(r => r.id === currentRoleId.value) ?? ROLES[0]);

const userInput = ref("");
const isRunning = ref(false);
const statusMessage = ref("");
const toolResults = ref<ToolResultComplete[]>([]);
const selectedResultUuid = ref<string | null>(null);

const selectedResult = computed(() =>
  toolResults.value.find(r => r.uuid === selectedResultUuid.value) ?? null
);

function makeTextResult(text: string, role: "user" | "assistant"): ToolResultComplete {
  return {
    uuid: uuidv4(),
    toolName: "text-response",
    message: text,
    title: role === "user" ? "You" : "Assistant",
    data: { text, role, transportKind: "text-rest" },
  } as ToolResultComplete;
}

function handleUpdateResult(updatedResult: ToolResultComplete) {
  const index = toolResults.value.findIndex(r => r.uuid === updatedResult.uuid);
  if (index !== -1) {
    Object.assign(toolResults.value[index], updatedResult);
  }
}

function onRoleChange() {
  toolResults.value = [];
  selectedResultUuid.value = null;
  statusMessage.value = "";
}

async function sendMessage(text?: string) {
  const message = typeof text === "string" ? text : userInput.value.trim();
  if (!message || isRunning.value) return;
  userInput.value = "";
  isRunning.value = true;
  statusMessage.value = "Thinking...";

  toolResults.value.push(makeTextResult(message, "user"));

  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, roleId: currentRoleId.value }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = JSON.parse(line.slice(6));

        if (data.type === "status") {
          statusMessage.value = data.message;
        } else if (data.type === "text") {
          toolResults.value.push(makeTextResult(data.message, "assistant"));
        } else if (data.type === "tool_result") {
          const result: ToolResultComplete = data.result;
          const existing = toolResults.value.findIndex(r => r.uuid === result.uuid);
          if (existing >= 0) {
            toolResults.value[existing] = result;
          } else {
            toolResults.value.push(result);
            selectedResultUuid.value = result.uuid;
          }
        }
      }
    }
  } finally {
    isRunning.value = false;
    statusMessage.value = "";
  }
}
</script>
