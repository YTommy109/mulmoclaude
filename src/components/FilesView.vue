<template>
  <div class="h-full flex bg-white">
    <!-- Tree pane -->
    <div
      class="w-72 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-2 bg-gray-50"
    >
      <div v-if="treeError" class="p-2 text-xs text-red-600">
        {{ treeError }}
      </div>
      <div v-else-if="!tree" class="p-2 text-xs text-gray-400">Loading...</div>
      <FileTree
        v-else
        :node="tree"
        :selected-path="selectedPath"
        :recent-paths="recentPaths"
        @select="selectFile"
      />
    </div>
    <!-- Content pane -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div
        v-if="selectedPath"
        class="px-4 py-2 border-b border-gray-200 text-xs text-gray-500 font-mono shrink-0 flex items-center gap-2"
      >
        <span class="truncate">{{ selectedPath }}</span>
        <span v-if="content" class="text-gray-400 shrink-0"
          >· {{ formatBytes(content.size) }}</span
        >
        <span v-if="content?.modifiedMs" class="text-gray-400 shrink-0"
          >· {{ formatTime(content.modifiedMs) }}</span
        >
      </div>
      <div class="flex-1 overflow-auto min-h-0">
        <div
          v-if="!selectedPath"
          class="h-full flex items-center justify-center text-gray-400 text-sm"
        >
          Select a file
        </div>
        <div v-else-if="contentError" class="p-4 text-sm text-red-600">
          {{ contentError }}
        </div>
        <div v-else-if="contentLoading" class="p-4 text-sm text-gray-400">
          Loading...
        </div>
        <template v-else-if="content">
          <!-- Markdown -->
          <div
            v-if="isMarkdown && content.kind === 'text'"
            class="h-full overflow-auto"
          >
            <TextResponseView
              :selected-result="markdownResult(content.content)"
            />
          </div>
          <!-- Text -->
          <pre
            v-else-if="content.kind === 'text'"
            class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"
            >{{ content.content }}</pre
          >
          <!-- Image -->
          <div
            v-else-if="content.kind === 'image'"
            class="h-full flex items-center justify-center p-4"
          >
            <img
              :src="rawUrl(selectedPath)"
              :alt="selectedPath"
              class="max-w-full max-h-full object-contain"
            />
          </div>
          <!-- PDF -->
          <iframe
            v-else-if="content.kind === 'pdf'"
            :src="rawUrl(selectedPath)"
            class="w-full h-full border-0"
            title="PDF preview"
          />
          <!-- Binary or too-large -->
          <div v-else class="p-4 text-sm text-gray-500">
            {{ content.message }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import FileTree, { type TreeNode } from "./FileTree.vue";
import TextResponseView from "../plugins/textResponse/View.vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "@gui-chat-plugin/text-response";

const STORAGE_KEY = "files_selected_path";
const RECENT_THRESHOLD_MS = 60 * 1000;

interface TextContent {
  kind: "text";
  path: string;
  content: string;
  size: number;
  modifiedMs: number;
}

interface MetaContent {
  kind: "image" | "pdf" | "binary" | "too-large";
  path: string;
  size: number;
  modifiedMs: number;
  message?: string;
}

type FileContent = TextContent | MetaContent;

const props = defineProps<{
  refreshToken?: number;
}>();

const tree = ref<TreeNode | null>(null);
const treeError = ref<string | null>(null);
const selectedPath = ref<string | null>(null);

const content = ref<FileContent | null>(null);
const contentLoading = ref(false);
const contentError = ref<string | null>(null);

const isMarkdown = computed(() => {
  const p = selectedPath.value ?? "";
  return p.endsWith(".md") || p.endsWith(".markdown");
});

const recentPaths = computed(() => {
  const set = new Set<string>();
  const now = Date.now();
  function visit(node: TreeNode) {
    if (
      node.type === "file" &&
      node.modifiedMs &&
      now - node.modifiedMs < RECENT_THRESHOLD_MS
    ) {
      set.add(node.path);
    }
    if (node.children) node.children.forEach(visit);
  }
  if (tree.value) visit(tree.value);
  return set;
});

function markdownResult(text: string): ToolResultComplete<TextResponseData> {
  return {
    uuid: "files-preview",
    toolName: "text-response",
    message: text,
    title: selectedPath.value ?? "",
    // role: "user" hides the PDF download button in TextResponseView
    data: { text, role: "user", transportKind: "text-rest" },
  };
}

function rawUrl(filePath: string): string {
  return `/api/files/raw?path=${encodeURIComponent(filePath)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadTree(): Promise<void> {
  treeError.value = null;
  try {
    const res = await fetch("/api/files/tree");
    if (!res.ok) throw new Error(`tree: ${res.status}`);
    tree.value = await res.json();
  } catch (err) {
    treeError.value = err instanceof Error ? err.message : String(err);
  }
}

async function loadContent(filePath: string): Promise<void> {
  contentLoading.value = true;
  contentError.value = null;
  content.value = null;
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(filePath)}`,
    );
    if (!res.ok) {
      const errBody: { error?: string } = await res.json().catch(() => ({}));
      throw new Error(errBody.error ?? `HTTP ${res.status}`);
    }
    content.value = await res.json();
  } catch (err) {
    contentError.value = err instanceof Error ? err.message : String(err);
  } finally {
    contentLoading.value = false;
  }
}

function selectFile(filePath: string): void {
  selectedPath.value = filePath;
  localStorage.setItem(STORAGE_KEY, filePath);
  loadContent(filePath);
}

watch(
  () => props.refreshToken,
  () => {
    loadTree();
    if (selectedPath.value) loadContent(selectedPath.value);
  },
);

onMounted(async () => {
  await loadTree();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) selectFile(saved);
});
</script>
