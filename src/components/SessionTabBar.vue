<template>
  <div class="flex-1 flex gap-1 items-center min-w-0">
    <button
      class="flex-shrink-0 flex items-center justify-center w-7 py-1 rounded border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
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
        class="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 py-0.5 rounded transition-colors"
        :class="sessions[i - 1].id === currentSessionId ? 'border border-gray-300 bg-white shadow-sm' : 'hover:bg-gray-100'"
        :title="tabTooltip(sessions[i - 1])"
        :data-testid="`session-tab-${sessions[i - 1].id}`"
        @click="emit('loadSession', sessions[i - 1].id)"
      >
        <span
          class="material-icons text-base leading-none"
          :class="[tabColor(sessions[i - 1]), sessions[i - 1].isRunning ? 'animate-spin [animation-duration:3s]' : '']"
          >{{ roleIcon(roles, sessions[i - 1].roleId) }}</span
        >
        <span class="text-[10px] leading-none text-gray-600 truncate max-w-full">{{ tabLabel(sessions[i - 1]) }}</span>
        <!-- Unread dot — inactive sessions only; active tab is what the user's looking at. -->
        <span
          v-if="sessions[i - 1].hasUnread && sessions[i - 1].id !== currentSessionId"
          class="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full"
          :title="t('sessionTabBar.unreadDot')"
          :aria-label="t('sessionTabBar.unreadDot')"
        />
        <!-- Origin glyph — marks non-human-started sessions (scheduler / skill / bridge). -->
        <span
          v-if="originIcon(sessions[i - 1].origin)"
          class="material-icons absolute top-0 left-0.5 text-[10px] text-gray-400 leading-none"
          :title="originTooltip(sessions[i - 1].origin)"
          :aria-label="originTooltip(sessions[i - 1].origin)"
          >{{ originIcon(sessions[i - 1].origin) }}</span
        >
      </button>
      <div v-else class="flex-1" />
    </template>
    <button
      ref="historyButton"
      data-testid="history-btn"
      class="relative flex-shrink-0 flex items-center justify-center w-7 py-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      :class="{ 'text-blue-500': historyOpen }"
      :title="t('sessionTabBar.sessionHistory')"
      @click="emit('toggleHistory')"
    >
      <span class="material-icons text-base">expand_more</span>
      <span
        v-if="activeSessionCount > 0"
        class="absolute -top-0.5 -left-0.5 min-w-[1rem] h-4 px-0.5 bg-yellow-400 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
        :title="t('sessionTabBar.activeSessions', activeSessionCount, { named: { count: activeSessionCount } })"
        >{{ activeSessionCount }}</span
      >
      <span
        v-if="unreadCount > 0"
        class="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none cursor-help"
        :title="t('sessionTabBar.unreadReplies', unreadCount, { named: { count: unreadCount } })"
        >{{ unreadCount }}</span
      >
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Role } from "../config/roles";
import { SESSION_ORIGINS, type SessionOrigin, type SessionSummary } from "../types/session";
import { roleIcon, roleName } from "../utils/role/icon";

const { t } = useI18n();

const props = defineProps<{
  sessions: SessionSummary[];
  currentSessionId: string;
  roles: Role[];
  activeSessionCount: number;
  unreadCount: number;
  historyOpen: boolean;
}>();

const emit = defineEmits<{
  newSession: [];
  loadSession: [id: string];
  toggleHistory: [];
}>();

const historyButton = ref<HTMLButtonElement | null>(null);
defineExpose({ historyButton });

function tabColor(session: SessionSummary): string {
  if (session.isRunning) return "text-yellow-400";
  if (session.hasUnread) return "text-gray-900";
  return "text-gray-400";
}

// Short label shown under the role icon so users can tell sessions
// apart at a glance. Prefers the indexer-generated `summary`
// (title-like), falls back to the first user message `preview`,
// finally the role name so a brand-new empty session still has a
// visible identifier.
const MAX_LABEL_CHARS = 10;
function tabLabel(session: SessionSummary): string {
  const src = (session.summary ?? session.preview ?? "").trim();
  if (src.length > 0) return src.slice(0, MAX_LABEL_CHARS);
  return roleName(props.roles, session.roleId);
}

function tabTooltip(session: SessionSummary): string {
  return session.summary || session.preview || roleName(props.roles, session.roleId);
}

function originIcon(origin: SessionOrigin | undefined): string | null {
  if (!origin || origin === SESSION_ORIGINS.human) return null;
  if (origin === SESSION_ORIGINS.scheduler) return "schedule";
  if (origin === SESSION_ORIGINS.skill) return "build";
  if (origin === SESSION_ORIGINS.bridge) return "sync_alt";
  return null;
}

function originTooltip(origin: SessionOrigin | undefined): string {
  if (!origin || origin === SESSION_ORIGINS.human) return "";
  return t(`sessionTabBar.origin.${origin}`);
}
</script>
