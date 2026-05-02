<template>
  <!-- One row in the AccountsModal list. Read-only display +
       Edit button. The editor itself is AccountEditor.vue, mounted
       in place of this row by the parent when editing. -->
  <div class="flex items-center gap-2 px-2 py-2 text-sm border-b border-gray-100" :data-testid="`accounting-accounts-row-${account.code}`">
    <span class="font-mono text-xs text-gray-500 w-16 shrink-0">{{ account.code }}</span>
    <span class="grow min-w-0 truncate">{{ account.name }}</span>
    <span v-if="account.note" class="text-xs text-gray-400 truncate max-w-[8rem]" :title="account.note">{{ account.note }}</span>
    <button
      type="button"
      class="h-8 px-2.5 rounded text-sm text-blue-600 hover:bg-blue-50"
      :data-testid="`accounting-accounts-edit-${account.code}`"
      @click="emit('edit')"
    >
      {{ t("pluginAccounting.accounts.edit") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { Account } from "../api";

const { t } = useI18n();

defineProps<{ account: Account }>();
const emit = defineEmits<{ edit: [] }>();
</script>
