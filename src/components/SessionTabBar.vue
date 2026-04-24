<template>
  <div class="flex-1 flex gap-1 items-center min-w-0">
    <button
      class="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
      data-testid="new-session-btn"
      :title="t('sessionTabBar.newSession')"
      :aria-label="t('sessionTabBar.newSession')"
      @click="emit('newSession')"
    >
      <span class="material-icons text-sm">add</span>
    </button>
    <template v-for="i in 6" :key="i">
      <button
        v-if="sessions[i - 1]"
        class="relative flex-1 min-w-0 h-8 flex items-center justify-start gap-1 px-2 rounded overflow-hidden transition-colors"
        :class="sessions[i - 1].id === currentSessionId ? 'border border-gray-300 bg-white shadow-sm' : 'hover:bg-gray-100'"
        :title="tabTooltip(sessions[i - 1])"
        :data-testid="`session-tab-${sessions[i - 1].id}`"
        :aria-current="sessions[i - 1].id === currentSessionId ? 'page' : undefined"
        @click="emit('loadSession', sessions[i - 1].id)"
      >
        <!-- Role + origin glyph. Rendering lives in SessionRoleIcon
             so the SessionHistoryPanel picks up the same treatment. -->
        <SessionRoleIcon :session="sessions[i - 1]" :roles="roles" />
        <span class="text-xs text-gray-700 truncate min-w-0" :class="sessions[i - 1].hasUnread ? 'font-bold' : ''">{{ tabLabel(sessions[i - 1]) }}</span>
        <!-- Unread dot. Suppressed only when the user is actually
             looking at that chat session — otherwise
             `currentSessionId` keeps pointing at the last chat
             even when the user is on /wiki, /files, etc., and the
             dot would silently disappear on the tab that most
             needs it. -->
        <span
          v-if="sessions[i - 1].hasUnread && !(isChatPage && sessions[i - 1].id === currentSessionId)"
          class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white"
          :aria-label="t('sessionTabBar.unreadDot')"
        />
      </button>
      <div v-else class="flex-1" />
    </template>
    <!-- Session-history side-panel toggle. Carries the aggregate
         session-status badges (active = yellow, unread = red) that
         used to live on the separate /history entry button. -->
    <SessionHistoryToggleButton
      :model-value="sidePanelVisible"
      :active-session-count="activeSessionCount"
      :unread-count="unreadCount"
      @update:model-value="(value: boolean) => emit('update:sidePanelVisible', value)"
    />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import { type SessionSummary } from "../types/session";
import { roleName } from "../utils/role/icon";
import SessionHistoryToggleButton from "./SessionHistoryToggleButton.vue";
import SessionRoleIcon from "./SessionRoleIcon.vue";

const { t } = useI18n();

const props = defineProps<{
  sessions: SessionSummary[];
  currentSessionId: string;
  // `currentSessionId` is "the last chat session the user was on".
  // It does NOT clear when the user navigates to /wiki /files etc.,
  // so we need a separate flag to know whether that session is
  // actually on-screen. Only then does it make sense to suppress
  // the unread dot on its tab.
  isChatPage: boolean;
  roles: Role[];
  activeSessionCount: number;
  unreadCount: number;
  sidePanelVisible: boolean;
}>();

const emit = defineEmits<{
  newSession: [];
  loadSession: [id: string];
  "update:sidePanelVisible": [value: boolean];
}>();

// Short label shown next to the role icon so users can tell
// sessions apart at a glance. Prefers the indexer-generated
// `summary` (title-like), falls back to the first user-message
// `preview`, finally the role name so a brand-new empty session
// still has a visible identifier. We rely on CSS `truncate` for
// the visual cap; this char cap just keeps the DOM text short
// enough that layout doesn't overflow before clipping kicks in.
const MAX_LABEL_CHARS = 20;
function tabLabel(session: SessionSummary): string {
  const src = (session.summary ?? session.preview ?? "").trim();
  if (src.length > 0) return src.slice(0, MAX_LABEL_CHARS);
  return roleName(props.roles, session.roleId);
}

// Tooltip on the tab button itself — session summary / preview /
// role fallback only. Origin ("Started by scheduler") lives on the
// origin badge's own tooltip so the two don't duplicate.
function tabTooltip(session: SessionSummary): string {
  return session.summary || session.preview || roleName(props.roles, session.roleId);
}
</script>
