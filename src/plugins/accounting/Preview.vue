<template>
  <!-- Stub compact preview — renders a one-line summary of the
       accounting tool result. The full Preview implementation lands
       in Slice 5; this is enough to satisfy the plugin registry's
       previewComponent contract. -->
  <div class="text-sm text-gray-700" data-testid="accounting-preview">
    <span class="material-icons text-base align-middle mr-1">account_balance</span>
    {{ summary }}
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{ data?: unknown; jsonData?: Record<string, unknown> }>();

const summary = computed<string>(() => {
  const json = (props.jsonData ?? {}) as Record<string, unknown>;
  if (typeof json.error === "string") return t("pluginAccounting.previewError", { error: json.error });
  if (typeof json.bookId === "string") return t("pluginAccounting.previewSummary", { bookId: json.bookId });
  return t("pluginAccounting.previewGeneric");
});
</script>
