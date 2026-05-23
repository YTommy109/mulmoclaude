<template>
  <div class="p-2 text-xs font-sans text-slate-800">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <div class="flex items-center gap-1">
          <span
            >Invoices: <strong class="font-extrabold text-slate-900">{{ invoices.length }}</strong></span
          >
        </div>
        <span class="text-slate-300">|</span>
        <div class="flex items-center gap-1">
          <span
            >Unpaid: <strong class="font-extrabold text-slate-900">{{ unpaidCount }}</strong></span
          >
        </div>
      </div>
      <div v-if="candidates.length > 0" class="flex items-center gap-1 shrink-0 text-[10px]">
        <span class="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true"></span>
        <span class="font-bold text-amber-700">{{ candidates.length }} Drafts</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { Invoice, InvoiceCandidate } from "./types";

interface ListResponse {
  ok: boolean;
  jsonData?: {
    invoices?: Invoice[];
    candidates?: InvoiceCandidate[];
  };
}

const props = defineProps<{ result: ToolResultComplete<any> }>();

const invoices = ref<Invoice[]>([]);
const candidates = ref<InvoiceCandidate[]>([]);

const { dispatch, pubsub } = useRuntime();

async function refresh(): Promise<void> {
  try {
    const res = await dispatch<ListResponse>({ action: "list" });
    if (res?.ok && res.jsonData) {
      invoices.value = res.jsonData.invoices || [];
      candidates.value = res.jsonData.candidates || [];
    }
  } catch {
    // Fail silently for thumbnail preview
  }
}

let unsub: (() => void) | undefined;
onMounted(() => {
  void refresh();
  unsub = pubsub.subscribe("changed", () => {
    void refresh();
  });
});

onUnmounted(() => {
  unsub?.();
});

watch(
  () => props.result.uuid,
  () => {
    void refresh();
  },
);

const unpaidCount = computed(() => {
  return invoices.value.filter((i) => i.status === "approved").length;
});
</script>
