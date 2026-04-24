<template>
  <!-- Shared header cluster: role selector + new-session + side-panel
       toggle. Rendered in two places:
       1. Row 2 (top bar) when the session-history side panel is closed
       2. The side-panel's own header row when it's open
       The outer is `w-full`; parents constrain the width (the Row 2
       wrapper forces 264px to match the side-panel's internal width,
       so the controls don't visually shift when the panel toggles).
       Toggle behaviour differs slightly between callers — the side
       panel also collapses when hidden — so we emit a plain
       `update:sidePanelVisible` and let the parent decide. -->
  <div class="flex items-center gap-2 w-full min-w-0">
    <RoleSelector
      :current-role-id="currentRoleId"
      :roles="roles"
      fluid
      @update:current-role-id="(value: string) => emit('update:currentRoleId', value)"
      @change="() => emit('roleChange')"
    />
    <div class="flex items-center gap-0.5 shrink-0">
      <button
        class="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
        data-testid="new-session-btn"
        :title="t('sessionTabBar.newSession')"
        :aria-label="t('sessionTabBar.newSession')"
        @click="emit('newSession')"
      >
        <span class="material-icons text-sm">add</span>
      </button>
      <SessionHistoryToggleButton
        :model-value="sidePanelVisible"
        :active-session-count="activeSessionCount"
        :unread-count="unreadCount"
        @update:model-value="(value: boolean) => emit('update:sidePanelVisible', value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import RoleSelector from "./RoleSelector.vue";
import SessionHistoryToggleButton from "./SessionHistoryToggleButton.vue";

const { t } = useI18n();

defineProps<{
  roles: Role[];
  currentRoleId: string;
  sidePanelVisible: boolean;
  activeSessionCount: number;
  unreadCount: number;
}>();

const emit = defineEmits<{
  "update:currentRoleId": [value: string];
  roleChange: [];
  newSession: [];
  "update:sidePanelVisible": [value: boolean];
}>();
</script>
