<template>
  <div class="text-sm">
    <div class="flex items-center gap-1 font-medium text-gray-700 mb-1">
      <span class="material-icons" style="font-size: 14px"
        >manage_accounts</span
      >
      <span
        >{{ customRoles.length }} custom role{{
          customRoles.length !== 1 ? "s" : ""
        }}</span
      >
    </div>
    <div
      v-for="role in customRoles"
      :key="role.id"
      class="text-xs text-gray-600 flex items-center gap-1"
    >
      <span class="material-icons" style="font-size: 12px">{{
        role.icon
      }}</span>
      {{ role.name }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageRolesData } from "./index";

const props = defineProps<{ result: ToolResultComplete<ManageRolesData> }>();
const customRoles = computed(() => props.result.data?.customRoles ?? []);
</script>
