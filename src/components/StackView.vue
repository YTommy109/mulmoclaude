<template>
  <div
    ref="containerRef"
    class="h-full overflow-y-auto bg-gray-50 p-4 space-y-3"
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
      class="bg-white rounded-lg border transition-colors"
      :class="
        result.uuid === selectedResultUuid
          ? 'border-blue-400 ring-2 ring-blue-200'
          : 'border-gray-200'
      "
    >
      <button
        class="w-full flex items-center gap-2 px-3 py-2 border-b border-gray-100 text-left hover:bg-gray-50"
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
      <!-- text-response: render the message directly so the card sizes
           naturally to its text content -->
      <div
        v-if="isTextResponse(result)"
        class="px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap break-words"
      >
        {{ messageText(result) }}
      </div>
      <!-- Document-like plugins: let the content flow at its natural
           height by overriding the plugin's internal h-full / overflow
           / flex-1 via the .stack-natural scoped styles below. For
           plugins that embed iframes (e.g. presentHtml) we also size
           each iframe to its content after load. -->
      <div
        v-else-if="isStackNatural(result.toolName)"
        :ref="
          (el) => setNaturalWrapperRef(result.uuid, el as HTMLElement | null)
        "
        class="stack-natural"
      >
        <component
          :is="getPlugin(result.toolName)?.viewComponent"
          v-if="getPlugin(result.toolName)?.viewComponent"
          :selected-result="result"
          :send-text-message="sendTextMessage"
          @update-result="(r: ToolResultComplete) => emit('updateResult', r)"
        />
      </div>
      <!-- Other plugins: fixed height wrapper so plugins that rely on
           h-full continue to render properly. -->
      <div v-else :style="{ height: PLUGIN_HEIGHT }">
        <component
          :is="getPlugin(result.toolName)?.viewComponent"
          v-if="getPlugin(result.toolName)?.viewComponent"
          :selected-result="result"
          :send-text-message="sendTextMessage"
          @update-result="(r: ToolResultComplete) => emit('updateResult', r)"
        />
        <pre
          v-else
          class="h-full overflow-auto p-4 text-xs text-gray-500 whitespace-pre-wrap"
          >{{ JSON.stringify(result, null, 2) }}</pre
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue";
import { getPlugin } from "../tools";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

// Most plugin viewComponents use h-full internally, so a defined parent
// height is required for them to render. text-response and the
// "stack-natural" plugins below are special-cased.
const PLUGIN_HEIGHT = "min(60vh, 560px)";

// Plugins that look better flowing at natural height in stack view
// rather than being clipped to PLUGIN_HEIGHT with an inner scrollbar.
const STACK_NATURAL_TOOLS = new Set<string>([
  "presentHtml",
  "presentDocument",
  "presentSpreadsheet",
]);

function isStackNatural(toolName: string): boolean {
  return STACK_NATURAL_TOOLS.has(toolName);
}

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
const naturalWrapperRefs = new Map<string, HTMLElement>();

function setItemRef(uuid: string, el: HTMLElement | null): void {
  if (el) itemRefs.set(uuid, el);
  else itemRefs.delete(uuid);
}

function setNaturalWrapperRef(uuid: string, el: HTMLElement | null): void {
  if (el) {
    naturalWrapperRefs.set(uuid, el);
    nextTick(() => sizeIframesIn(el));
  } else {
    naturalWrapperRefs.delete(uuid);
  }
}

// Sandboxed iframes inside stack-natural plugins (e.g. presentHtml)
// have no intrinsic content height, so CSS alone collapses them. Set
// each iframe's height to match its document's scrollHeight on load.
function sizeIframesIn(wrapper: HTMLElement): void {
  const iframes = wrapper.querySelectorAll<HTMLIFrameElement>("iframe");
  for (const iframe of iframes) {
    if (iframe.dataset.stackSized === "true") continue;
    iframe.dataset.stackSized = "true";
    const resize = () => resizeOneIframe(iframe);
    iframe.addEventListener("load", resize);
    // If the iframe already finished loading before we attached the
    // listener, size it now as well.
    try {
      if (iframe.contentDocument?.readyState === "complete") {
        resize();
      }
    } catch {
      // cross-origin — leave default height
    }
  }
}

function resizeOneIframe(iframe: HTMLIFrameElement): void {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    const height = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
    );
    if (height > 0) iframe.style.height = `${height}px`;
  } catch {
    // cross-origin sandbox — can't measure, leave default
  }
}

function isTextResponse(result: ToolResultComplete): boolean {
  return result.toolName === "text-response";
}

function messageText(result: ToolResultComplete): string {
  if (typeof result.message === "string") return result.message;
  const data = result.data;
  if (
    typeof data === "object" &&
    data !== null &&
    "text" in data &&
    typeof (data as { text: unknown }).text === "string"
  ) {
    return (data as { text: string }).text;
  }
  return "";
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
      // New items may have brought in more iframes to size.
      for (const wrapper of naturalWrapperRefs.values()) {
        sizeIframesIn(wrapper);
      }
    });
  },
);

onUnmounted(() => {
  naturalWrapperRefs.clear();
});
</script>

<style scoped>
/* Force document-like plugin viewComponents (presentHtml,
   presentDocument, presentSpreadsheet) to flow at their natural
   height inside stack view instead of clipping to the wrapper with
   an inner scrollbar. */
.stack-natural :deep(.h-full),
.stack-natural :deep(.min-h-full) {
  height: auto !important;
  min-height: 0 !important;
}
.stack-natural :deep(.overflow-hidden),
.stack-natural :deep(.overflow-auto),
.stack-natural :deep(.overflow-y-auto),
.stack-natural :deep(.overflow-x-auto) {
  overflow: visible !important;
}
.stack-natural :deep(.flex-1) {
  flex: 0 0 auto !important;
}
</style>
