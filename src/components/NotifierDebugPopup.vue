<script setup lang="ts">
// Top-bar debug surface for the host notifier engine. Visible only
// when `VITE_DEV_MODE === "1"` (the same gate as the Debug role in
// `RoleSelector`). Lives next to the bell so a developer can drive
// the new bell UX without leaving whatever screen they're on.
//
// No i18n by design: this popup is dev-only chrome, never seen by
// end users — every string is a literal English value kept in this
// file. Don't extract these into vue-i18n.
//
// Subscribes to the host's `notifier` pub/sub channel via
// `usePubSub`. Runtime plugins can't see this channel because their
// `BrowserPluginRuntime.pubsub` is hard-scoped to `plugin:<pkg>:*`,
// which is why the new-UX harness lives in host code rather than
// under `@mulmoclaude/debug-plugin`.
//
// The popup mirrors the UX specced in `plans/feat-notifier-ux.md`:
// Active section on top + History section below, single scroll, no
// tabs. Triggers all live through `POST /api/notifier`. Test
// notifications fire from the `/debug` page (separate surface).

import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { usePubSub } from "../composables/usePubSub";
import { apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PUBSUB_CHANNELS } from "../config/pubsubChannels";

interface NotifierEntry {
  id: string;
  pluginPkg: string;
  severity: "info" | "nudge" | "urgent";
  lifecycle?: "fyi" | "action";
  title: string;
  body?: string;
  navigateTarget?: string;
  pluginData?: unknown;
  createdAt: string;
}

interface NotifierHistoryEntry extends NotifierEntry {
  terminalType: "cleared" | "cancelled";
  terminalAt: string;
}

type NotifierEvent = { type: "published"; entry: NotifierEntry } | { type: "cleared"; id: string } | { type: "cancelled"; id: string };

const HISTORY_CAP = 50;

const router = useRouter();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const entries = ref<NotifierEntry[]>([]);
const history = ref<NotifierHistoryEntry[]>([]);
const checkedFyi = ref<Set<string>>(new Set());
const status = ref<string>("idle");

const devMode = import.meta.env.VITE_DEV_MODE === "1";

const visibleEntries = computed(() => [...entries.value].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
const visibleHistory = computed(() => history.value);

const badgeText = computed(() => (entries.value.length > 99 ? "99+" : String(entries.value.length)));

// Worst-severity-wins: any urgent → red, else any nudge → amber,
// else gray. Mirrors the bell-badge color encoding called out in
// plans/feat-notifier-ux.md.
const badgeColor = computed(() => {
  if (entries.value.some((entry) => entry.severity === "urgent")) return "bg-red-500";
  if (entries.value.some((entry) => entry.severity === "nudge")) return "bg-amber-500";
  return "bg-gray-400";
});

const checkedFyiCount = computed(() => visibleEntries.value.filter((entry) => entry.lifecycle === "fyi" && checkedFyi.value.has(entry.id)).length);

async function refreshActive(): Promise<void> {
  const result = await apiPost<{ entries: NotifierEntry[] }>(API_ROUTES.notifier.dispatch, { action: "list" });
  if (result.ok) entries.value = result.data.entries;
  else status.value = `list failed: ${result.error}`;
}

async function refreshHistory(): Promise<void> {
  const result = await apiPost<{ history: NotifierHistoryEntry[] }>(API_ROUTES.notifier.dispatch, { action: "listHistory" });
  if (result.ok) history.value = result.data.history;
  else status.value = `listHistory failed: ${result.error}`;
}

function applyEvent(event: NotifierEvent): void {
  switch (event.type) {
    case "published":
      // De-dup: own publish-driven local update may have landed first.
      if (!entries.value.some((entry) => entry.id === event.entry.id)) {
        entries.value = [...entries.value, event.entry];
      }
      return;
    case "cleared":
    case "cancelled": {
      const removed = entries.value.find((entry) => entry.id === event.id);
      entries.value = entries.value.filter((entry) => entry.id !== event.id);
      checkedFyi.value.delete(event.id);
      if (removed) {
        const historyEntry: NotifierHistoryEntry = {
          ...removed,
          terminalType: event.type === "cleared" ? "cleared" : "cancelled",
          terminalAt: new Date().toISOString(),
        };
        history.value = [historyEntry, ...history.value].slice(0, HISTORY_CAP);
      }
    }
  }
}

const { subscribe } = usePubSub();
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = subscribe(PUBSUB_CHANNELS.notifier, (data) => applyEvent(data as NotifierEvent));
  document.addEventListener("mousedown", onDocumentClick);
  // Prime so the badge reflects existing entries before the user opens
  // the popup. History primed in parallel — display only matters when
  // open, but priming early avoids a flash on first open.
  void refreshActive();
  void refreshHistory();
});

onUnmounted(() => {
  unsubscribe?.();
  document.removeEventListener("mousedown", onDocumentClick);
});

function onDocumentClick(event: MouseEvent): void {
  if (!open.value || !rootRef.value) return;
  if (!rootRef.value.contains(event.target as Node)) open.value = false;
}

async function toggle(): Promise<void> {
  open.value = !open.value;
  if (open.value) {
    await Promise.all([refreshActive(), refreshHistory()]);
  }
}

function appendNotificationId(target: string, entryId: string): string {
  const separator = target.includes("?") ? "&" : "?";
  return `${target}${separator}notificationId=${encodeURIComponent(entryId)}`;
}

async function clearById(entryId: string): Promise<void> {
  const result = await apiPost<{ ok: true }>(API_ROUTES.notifier.dispatch, { action: "clear", id: entryId });
  if (!result.ok) status.value = `clear failed: ${result.error}`;
}

async function cancelById(entryId: string): Promise<void> {
  const result = await apiPost<{ ok: true }>(API_ROUTES.notifier.dispatch, { action: "cancel", id: entryId });
  if (!result.ok) status.value = `cancel failed: ${result.error}`;
}

function toggleCheck(entryId: string): void {
  const next = new Set(checkedFyi.value);
  if (next.has(entryId)) next.delete(entryId);
  else next.add(entryId);
  checkedFyi.value = next;
}

async function ackSelected(): Promise<void> {
  const ids = visibleEntries.value.filter((entry) => entry.lifecycle === "fyi" && checkedFyi.value.has(entry.id)).map((entry) => entry.id);
  for (const entryId of ids) await clearById(entryId);
}

async function navigateAndClose(target: string, entryId: string): Promise<void> {
  open.value = false;
  await router.push(appendNotificationId(target, entryId));
}

function severityDot(severity: NotifierEntry["severity"]): string {
  switch (severity) {
    case "urgent":
      return "bg-red-500";
    case "nudge":
      return "bg-amber-500";
    case "info":
    default:
      return "bg-gray-300";
  }
}
</script>

<!-- eslint-disable @intlify/vue-i18n/no-raw-text --
  Dev-only debug surface, gated by `VITE_DEV_MODE === "1"`. Strings
  are literal English by design (see file header) — never seen by
  end users, never extracted into vue-i18n. -->
<template>
  <div v-if="devMode" ref="rootRef" class="relative">
    <button
      type="button"
      data-testid="notifier-debug-button"
      class="relative h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700"
      title="Notifier debug"
      aria-label="Notifier debug"
      @click="toggle"
    >
      <span class="material-icons">bug_report</span>
      <span
        v-if="entries.length > 0"
        :class="[
          'absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-0.5 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none',
          badgeColor,
        ]"
        data-testid="notifier-debug-badge"
      >
        {{ badgeText }}
      </span>
    </button>
    <div
      v-if="open"
      data-testid="notifier-debug-popup"
      class="absolute left-0 top-full mt-1 w-96 max-h-[80vh] bg-white border border-gray-200 rounded-lg shadow-lg z-50 flex flex-col text-xs overflow-hidden"
    >
      <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <span class="font-semibold text-gray-700">Notifications</span>
        <span class="ml-auto text-gray-400">{{ status }}</span>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div class="px-3 py-1.5 text-gray-500 font-medium border-b border-gray-100 bg-gray-50">Active ({{ visibleEntries.length }})</div>
        <p v-if="visibleEntries.length === 0" class="px-3 py-3 text-gray-400 italic">No active notifications</p>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="entry in visibleEntries" :key="entry.id" data-testid="notifier-debug-active-entry" class="px-3 py-2">
            <div class="flex items-start gap-2">
              <input
                v-if="entry.lifecycle === 'fyi'"
                type="checkbox"
                :checked="checkedFyi.has(entry.id)"
                class="mt-0.5 shrink-0 cursor-pointer"
                data-testid="notifier-debug-fyi-check"
                @click.stop="toggleCheck(entry.id)"
              />
              <span :class="['mt-1 inline-block w-2 h-2 rounded-full shrink-0', severityDot(entry.severity)]" :title="entry.severity"></span>
              <div
                :class="[
                  'flex-1 min-w-0',
                  entry.lifecycle === 'action' && entry.navigateTarget ? 'cursor-pointer hover:underline' : entry.lifecycle === 'fyi' ? 'cursor-pointer' : '',
                ]"
                @click="
                  () => {
                    if (entry.lifecycle === 'action' && entry.navigateTarget) navigateAndClose(entry.navigateTarget, entry.id);
                    else if (entry.lifecycle === 'fyi') toggleCheck(entry.id);
                  }
                "
              >
                <div class="flex items-baseline gap-2">
                  <span class="font-medium text-gray-800 truncate">{{ entry.title }}</span>
                  <span v-if="entry.lifecycle" class="text-[10px] uppercase tracking-wide text-gray-400">{{ entry.lifecycle }}</span>
                </div>
                <div v-if="entry.body" class="text-gray-600 mt-0.5 truncate">{{ entry.body }}</div>
                <div class="text-gray-400 mt-0.5 font-mono text-[10px]">{{ entry.pluginPkg }} · {{ entry.id.slice(0, 8) }}</div>
              </div>
              <button
                v-if="entry.lifecycle === 'action'"
                type="button"
                class="text-gray-400 hover:text-red-500 shrink-0"
                title="Cancel"
                aria-label="Cancel"
                data-testid="notifier-debug-action-cancel"
                @click.stop="cancelById(entry.id)"
              >
                <span class="material-icons text-sm">close</span>
              </button>
            </div>
          </li>
        </ul>
        <div v-if="checkedFyiCount > 0" class="px-3 py-2 border-y border-gray-100 bg-white sticky bottom-0">
          <button
            type="button"
            data-testid="notifier-debug-ack-bulk"
            class="w-full px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
            @click="ackSelected"
          >
            Acknowledge selected ({{ checkedFyiCount }})
          </button>
        </div>
        <div class="px-3 py-1.5 text-gray-500 font-medium border-y border-gray-100 bg-gray-50">History ({{ visibleHistory.length }})</div>
        <p v-if="visibleHistory.length === 0" class="px-3 py-3 text-gray-400 italic">No recent activity</p>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="entry in visibleHistory" :key="`${entry.id}-${entry.terminalAt}`" data-testid="notifier-debug-history-entry" class="px-3 py-2">
            <div class="flex items-start gap-2">
              <span :class="['mt-0.5 shrink-0 font-bold', entry.terminalType === 'cleared' ? 'text-green-600' : 'text-gray-400']">
                {{ entry.terminalType === "cleared" ? "✓" : "✗" }}
              </span>
              <span :class="['mt-1 inline-block w-2 h-2 rounded-full shrink-0 opacity-60', severityDot(entry.severity)]"></span>
              <div
                :class="['flex-1 min-w-0', entry.navigateTarget ? 'cursor-pointer hover:underline' : '']"
                @click="
                  () => {
                    if (entry.navigateTarget) navigateAndClose(entry.navigateTarget, entry.id);
                  }
                "
              >
                <div class="flex items-baseline gap-2">
                  <span class="text-gray-700 truncate">{{ entry.title }}</span>
                </div>
                <div class="text-gray-400 mt-0.5 font-mono text-[10px]">{{ entry.pluginPkg }} · {{ entry.terminalType }}</div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
<!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
