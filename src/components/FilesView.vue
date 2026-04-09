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
        <span class="truncate min-w-0">{{ selectedPath }}</span>
        <span v-if="content" class="text-gray-400 shrink-0"
          >· {{ formatBytes(content.size) }}</span
        >
        <span v-if="content?.modifiedMs" class="text-gray-400 shrink-0"
          >· {{ formatTime(content.modifiedMs) }}</span
        >
        <button
          v-if="isMarkdown"
          class="ml-auto shrink-0 px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 font-sans"
          :title="mdRawMode ? 'Show rendered Markdown' : 'Show raw source'"
          @click="toggleMdRaw"
        >
          {{ mdRawMode ? "Rendered" : "Raw" }}
        </button>
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
          <template v-if="content.kind === 'text'">
            <!-- Markdown rendered: frontmatter panel + body -->
            <div
              v-if="isMarkdown && !mdRawMode"
              class="h-full flex flex-col overflow-auto"
            >
              <div
                v-if="mdFrontmatter && mdFrontmatter.fields.length > 0"
                class="shrink-0 m-4 mb-0 rounded border border-gray-200 bg-gray-50 p-3 text-xs"
              >
                <div
                  v-for="field in mdFrontmatter.fields"
                  :key="field.key"
                  class="flex items-baseline gap-2 py-0.5"
                >
                  <span class="font-semibold text-gray-600 shrink-0"
                    >{{ field.key }}:</span
                  >
                  <template v-if="Array.isArray(field.value)">
                    <span class="flex flex-wrap gap-1">
                      <span
                        v-for="item in field.value"
                        :key="item"
                        class="rounded-full bg-white border border-gray-300 px-2 py-0.5 text-gray-700"
                      >
                        {{ item }}
                      </span>
                    </span>
                  </template>
                  <span v-else class="text-gray-800 break-words">{{
                    field.value
                  }}</span>
                </div>
              </div>
              <div class="flex-1 min-h-0">
                <TextResponseView
                  :selected-result="
                    markdownResult(
                      mdFrontmatter ? mdFrontmatter.body : content.content,
                    )
                  "
                />
              </div>
            </div>
            <!-- Markdown raw source (includes frontmatter) -->
            <pre
              v-else-if="isMarkdown && mdRawMode"
              class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"
              >{{ content.content }}</pre
            >
            <!-- HTML: sandboxed iframe preview (scripts disabled) -->
            <iframe
              v-else-if="isHtml"
              :srcdoc="content.content"
              class="w-full h-full border-0"
              sandbox=""
              title="HTML preview"
            />
            <!-- JSON: pretty-printed with simple syntax coloring. Fall
                 back to raw content if the file is malformed. -->
            <pre
              v-else-if="isJson"
              class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"
            ><span
              v-for="(tok, i) in jsonTokens"
              :key="i"
              :class="JSON_TOKEN_CLASS[tok.type]"
            >{{ tok.value }}</span></pre>
            <!-- Plain text fallback -->
            <pre
              v-else
              class="p-4 text-xs whitespace-pre-wrap font-mono text-gray-800"
              >{{ content.content }}</pre
            >
          </template>
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
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import FileTree, { type TreeNode } from "./FileTree.vue";
import TextResponseView from "../plugins/textResponse/View.vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { TextResponseData } from "@gui-chat-plugin/text-response";
import {
  tokenizeJson,
  prettyJson,
  JSON_TOKEN_CLASS,
} from "../utils/jsonSyntax";
import { extractFrontmatter } from "../utils/frontmatter";

const STORAGE_KEY = "files_selected_path";
const MD_RAW_STORAGE_KEY = "files_md_raw_mode";
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

function hasExt(filePath: string | null, exts: string[]): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

const isMarkdown = computed(() =>
  hasExt(selectedPath.value, [".md", ".markdown"]),
);

const mdRawMode = ref(localStorage.getItem(MD_RAW_STORAGE_KEY) === "true");

function toggleMdRaw(): void {
  mdRawMode.value = !mdRawMode.value;
  localStorage.setItem(MD_RAW_STORAGE_KEY, String(mdRawMode.value));
}
const isHtml = computed(() => hasExt(selectedPath.value, [".html", ".htm"]));
const isJson = computed(() => hasExt(selectedPath.value, [".json"]));

const jsonTokens = computed(() => {
  if (!content.value || content.value.kind !== "text") return [];
  return tokenizeJson(prettyJson(content.value.content));
});

const mdFrontmatter = computed(() => {
  if (!content.value || content.value.kind !== "text") return null;
  if (!isMarkdown.value) return null;
  return extractFrontmatter(content.value.content);
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

// Tracks the currently in-flight content fetch so a stale response from
// a previously-clicked file can't overwrite the latest selection.
let contentAbort: AbortController | null = null;

async function loadContent(filePath: string): Promise<void> {
  contentAbort?.abort();
  const controller = new AbortController();
  contentAbort = controller;

  contentLoading.value = true;
  contentError.value = null;
  content.value = null;
  try {
    const res = await fetch(
      `/api/files/content?path=${encodeURIComponent(filePath)}`,
      { signal: controller.signal },
    );
    if (controller.signal.aborted) return;
    if (!res.ok) {
      const errBody: { error?: string } = await res.json().catch(() => ({}));
      throw new Error(errBody.error ?? `HTTP ${res.status}`);
    }
    const body: FileContent = await res.json();
    if (controller.signal.aborted) return;
    content.value = body;
  } catch (err) {
    if (controller.signal.aborted) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    contentError.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (contentAbort === controller) {
      contentLoading.value = false;
      contentAbort = null;
    }
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

onUnmounted(() => {
  contentAbort?.abort();
});
</script>
