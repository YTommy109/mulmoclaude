<template>
  <!-- Stub View — full <AccountingApp> implementation lands in
       Slice 5 (see plans/feat-accounting.md). For now this just
       acknowledges the openApp tool-result so the plugin registry
       imports cleanly and developers exercising the REST surface
       can verify routing. -->
  <div class="h-full bg-white p-6 flex flex-col gap-3" data-testid="accounting-app">
    <h2 class="text-lg font-semibold">{{ t("pluginAccounting.title") }}</h2>
    <p class="text-sm text-gray-600">
      {{ bookLine }}<span v-if="initialTab">{{ tabFragment }}</span>
    </p>
    <p class="text-xs text-gray-400">{{ t("pluginAccounting.stubFollowupNote") }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

interface AccountingAppPayload {
  kind?: string;
  bookId?: string;
  initialTab?: string;
}

// Tool-result envelopes arrive on different prop shapes depending
// on which renderer wraps the View. Accept both `data` (the common
// case) and `jsonData` so this stub works in either harness.
const props = defineProps<{ data?: AccountingAppPayload; jsonData?: AccountingAppPayload }>();

const payload = computed<AccountingAppPayload>(() => props.data ?? props.jsonData ?? {});
const bookId = computed(() => payload.value.bookId ?? "(unknown)");
const initialTab = computed(() => payload.value.initialTab);
const bookLine = computed(() => t("pluginAccounting.stubBookLine", { bookId: bookId.value }));
const tabFragment = computed(() => t("pluginAccounting.stubTabFragment", { tab: initialTab.value ?? "" }));
</script>
