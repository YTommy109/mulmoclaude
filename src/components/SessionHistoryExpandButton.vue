<template>
  <button
    class="flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-gray-700 transition-colors hover:bg-gray-100"
    :title="modelValue ? t('sessionHistoryExpand.collapseTooltip') : t('sessionHistoryExpand.expandTooltip')"
    :aria-label="modelValue ? t('sessionHistoryExpand.collapse') : t('sessionHistoryExpand.expand')"
    :aria-pressed="modelValue"
    :data-testid="`session-history-expand-${modelValue ? 'on' : 'off'}`"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="material-icons text-lg" aria-hidden="true">{{ modelValue ? "close_fullscreen" : "open_in_full" }}</span>
  </button>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>
