<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
    data-testid="settings-modal-backdrop"
    @click="close"
  >
    <div
      class="bg-white rounded-lg shadow-xl w-[36rem] max-h-[85vh] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      data-testid="settings-modal"
      @click.stop
    >
      <div
        class="px-5 py-4 border-b border-gray-200 flex items-center justify-between"
      >
        <h2
          id="settings-modal-title"
          class="text-base font-semibold text-gray-900"
        >
          Settings
        </h2>
        <button
          class="text-gray-400 hover:text-gray-700"
          title="Close"
          data-testid="settings-close-btn"
          @click="close"
        >
          <span class="material-icons">close</span>
        </button>
      </div>

      <div class="flex border-b border-gray-200 px-5">
        <button
          class="px-3 py-2 text-sm border-b-2"
          :class="
            activeTab === 'tools'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          "
          data-testid="settings-tab-tools"
          @click="activeTab = 'tools'"
        >
          Allowed Tools
        </button>
        <button
          class="px-3 py-2 text-sm border-b-2"
          :class="
            activeTab === 'mcp'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          "
          data-testid="settings-tab-mcp"
          @click="activeTab = 'mcp'"
        >
          MCP Servers
        </button>
      </div>

      <div class="px-5 py-4 overflow-y-auto flex-1 space-y-4 text-gray-900">
        <div v-if="loadError" class="text-sm text-red-600">
          {{ loadError }}
        </div>

        <div v-if="activeTab === 'tools'" class="space-y-3">
          <p class="text-xs text-gray-600 leading-relaxed">
            Extra tool names to pass to Claude via
            <code class="bg-gray-100 px-1 rounded">--allowedTools</code>. One
            per line. Useful for built-in Claude Code MCP servers like Gmail /
            Google Calendar after you have authenticated via
            <code class="bg-gray-100 px-1 rounded">claude mcp</code>.
          </p>
          <label class="block">
            <span class="text-xs font-semibold text-gray-700">Tool names</span>
            <textarea
              v-model="toolsText"
              class="mt-1 w-full h-48 px-2 py-1.5 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
              placeholder="mcp__claude_ai_Gmail&#10;mcp__claude_ai_Google_Calendar"
              data-testid="settings-tools-textarea"
              @keydown.stop
            ></textarea>
          </label>
          <p v-if="invalidToolNames.length > 0" class="text-xs text-amber-700">
            These look non-standard (expected prefix
            <code class="bg-gray-100 px-1 rounded">mcp__</code>):
            {{ invalidToolNames.join(", ") }}
          </p>
        </div>

        <div v-else-if="activeTab === 'mcp'" class="space-y-3">
          <SettingsMcpTab
            :servers="mcpServers"
            :docker-mode="dockerMode"
            @add="addMcpServer"
            @update="updateMcpServer"
            @remove="removeMcpServer"
          />
        </div>
      </div>

      <div
        class="px-5 py-3 border-t border-gray-200 flex items-center justify-between gap-3"
      >
        <span
          v-if="statusMessage"
          class="text-xs"
          :class="statusError ? 'text-red-600' : 'text-green-600'"
          data-testid="settings-status"
        >
          {{ statusMessage }}
        </span>
        <span v-else class="text-xs text-gray-500">
          Changes apply on the next message. No restart needed.
        </span>
        <div class="flex gap-2">
          <button
            class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            data-testid="settings-cancel-btn"
            @click="close"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300"
            :disabled="saving"
            data-testid="settings-save-btn"
            @click="save"
          >
            {{ saving ? "Saving…" : "Save" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import SettingsMcpTab from "./SettingsMcpTab.vue";
import type { McpServerEntry } from "./SettingsMcpTab.vue";

interface Props {
  open: boolean;
  dockerMode?: boolean;
}

const props = withDefaults(defineProps<Props>(), { dockerMode: false });
const emit = defineEmits<{
  "update:open": [value: boolean];
  saved: [];
}>();

const activeTab = ref<"tools" | "mcp">("tools");
const toolsText = ref("");
const mcpServers = ref<McpServerEntry[]>([]);
const loadError = ref("");
const statusMessage = ref("");
const statusError = ref(false);
const saving = ref(false);

const parsedToolNames = computed(() =>
  toolsText.value
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
);

const invalidToolNames = computed(() =>
  parsedToolNames.value.filter((n) => !n.startsWith("mcp__") && !isBuiltIn(n)),
);

function isBuiltIn(name: string): boolean {
  return [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "WebFetch",
    "WebSearch",
  ].includes(name);
}

async function loadConfig(): Promise<void> {
  loadError.value = "";
  statusMessage.value = "";
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      loadError.value = `Failed to load settings (HTTP ${response.status})`;
      return;
    }
    const data: {
      settings: { extraAllowedTools: string[] };
      mcp?: { servers: McpServerEntry[] };
    } = await response.json();
    toolsText.value = data.settings.extraAllowedTools.join("\n");
    mcpServers.value = data.mcp?.servers ?? [];
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : "Network error";
  }
}

async function save(): Promise<void> {
  saving.value = true;
  statusMessage.value = "";
  statusError.value = false;
  try {
    const settingsResponse = await fetch("/api/config/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraAllowedTools: parsedToolNames.value }),
    });
    if (!settingsResponse.ok) {
      const text = await settingsResponse.text();
      throw new Error(text || `HTTP ${settingsResponse.status}`);
    }

    const mcpResponse = await fetch("/api/config/mcp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servers: mcpServers.value }),
    });
    if (!mcpResponse.ok) {
      const text = await mcpResponse.text();
      throw new Error(text || `HTTP ${mcpResponse.status}`);
    }

    statusMessage.value = "Saved. Changes take effect on the next message.";
    emit("saved");
  } catch (err) {
    statusError.value = true;
    statusMessage.value = err instanceof Error ? err.message : "Save failed";
  } finally {
    saving.value = false;
  }
}

function close(): void {
  emit("update:open", false);
}

function addMcpServer(entry: McpServerEntry): void {
  mcpServers.value = [...mcpServers.value, entry];
}

function updateMcpServer(index: number, entry: McpServerEntry): void {
  const next = [...mcpServers.value];
  next[index] = entry;
  mcpServers.value = next;
}

function removeMcpServer(index: number): void {
  const next = [...mcpServers.value];
  next.splice(index, 1);
  mcpServers.value = next;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      loadConfig();
      statusMessage.value = "";
      statusError.value = false;
    }
  },
  { immediate: true },
);
</script>
