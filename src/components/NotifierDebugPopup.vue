<script setup lang="ts">
// Top-bar debug surface for the host notifier engine. Visible only
// when `VITE_DEV_MODE === "1"` (the same gate as the Debug role in
// `RoleSelector`). Lives next to the bell so a developer can fire
// the scripted test without leaving whatever screen they're on.
//
// No i18n by design: this popup is dev-only chrome, never seen by
// end users — every string is a literal English value kept in this
// file. Don't extract these into vue-i18n.
//
// Subscribes to the host's `notifier` pub/sub channel directly via
// `usePubSub`. Runtime plugins can't see this channel because their
// `BrowserPluginRuntime.pubsub` is hard-scoped to `plugin:<pkg>:*`,
// which is why the harness lives here in host code rather than under
// `@mulmoclaude/debug-plugin`.

import { computed, onMounted, onUnmounted, ref } from "vue";
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
  pluginData?: unknown;
  createdAt: string;
}

type NotifierEvent = { type: "published"; entry: NotifierEntry } | { type: "cleared"; id: string } | { type: "cancelled"; id: string };

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const entries = ref<NotifierEntry[]>([]);
const status = ref<string>("idle");
const running = ref(false);

const devMode = import.meta.env.VITE_DEV_MODE === "1";

const visibleEntries = computed(() => [...entries.value].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));

const badgeText = computed(() => (entries.value.length > 99 ? "99+" : String(entries.value.length)));

// Worst-severity-wins: any urgent → red, else any nudge → amber,
// else gray. Mirrors the bell-badge color encoding called out in
// plans/feat-encore.md ("one glance answers 'is anything on fire?'
// without opening the panel").
const badgeColor = computed(() => {
  if (entries.value.some((entry) => entry.severity === "urgent")) return "bg-red-500";
  if (entries.value.some((entry) => entry.severity === "nudge")) return "bg-amber-500";
  return "bg-gray-400";
});

async function refreshList(): Promise<void> {
  const result = await apiPost<{ entries: NotifierEntry[] }>(API_ROUTES.notifier.dispatch, { action: "list" });
  if (result.ok) entries.value = result.data.entries;
  else status.value = `list failed: ${result.error}`;
}

function applyEvent(event: NotifierEvent): void {
  switch (event.type) {
    case "published":
      // De-dup: skip if we already have it (e.g. our own publish call
      // returned and we updated locally before the pubsub round-trip).
      if (!entries.value.some((entry) => entry.id === event.entry.id)) {
        entries.value = [...entries.value, event.entry];
      }
      return;
    case "cleared":
    case "cancelled":
      entries.value = entries.value.filter((entry) => entry.id !== event.id);
  }
}

const { subscribe } = usePubSub();
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = subscribe(PUBSUB_CHANNELS.notifier, (data) => applyEvent(data as NotifierEvent));
  document.addEventListener("mousedown", onDocumentClick);
  // Prime the local list so the badge reflects existing entries
  // before the user opens the popup. Fire-and-forget — a transient
  // failure surfaces in the popup's status line on next open.
  void refreshList();
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
  if (open.value) await refreshList();
}

// ── Scripted test ─────────────────────────────────────────────────

interface ScriptStep {
  delayMs: number;
  do: () => Promise<void>;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function publish(args: {
  pluginPkg: string;
  severity: "info" | "nudge" | "urgent";
  lifecycle: "fyi" | "action";
  title: string;
  body?: string;
}): Promise<string | null> {
  const result = await apiPost<{ id: string }>(API_ROUTES.notifier.dispatch, { action: "publish", ...args });
  if (result.ok) return result.data.id;
  status.value = `publish failed: ${result.error}`;
  return null;
}

async function clear(entryId: string): Promise<void> {
  const result = await apiPost<{ ok: true }>(API_ROUTES.notifier.dispatch, { action: "clear", id: entryId });
  if (!result.ok) status.value = `clear failed: ${result.error}`;
}

async function cancel(entryId: string): Promise<void> {
  const result = await apiPost<{ ok: true }>(API_ROUTES.notifier.dispatch, { action: "cancel", id: entryId });
  if (!result.ok) status.value = `cancel failed: ${result.error}`;
}

async function cleanupLeftoverDebugEntries(): Promise<void> {
  const result = await apiPost<{ entries: NotifierEntry[] }>(API_ROUTES.notifier.dispatch, { action: "list" });
  if (!result.ok) return;
  const stale = result.data.entries.filter((entry) => entry.pluginPkg.startsWith("debug__"));
  // Sequential rather than parallel: parallel `clear` calls would
  // race through the engine's drain queue but offer no real speedup
  // here, and sequential keeps the visible state changes orderly.
  for (const entry of stale) await clear(entry.id);
}

async function runScriptedTest(): Promise<void> {
  if (running.value) return;
  running.value = true;
  status.value = "cleaning up leftover entries…";
  await cleanupLeftoverDebugEntries();

  const startedAt = performance.now();
  status.value = "running…";

  // Capture ids of the entries we publish so we can clear/cancel
  // them later in the script. Local state — the engine assigns
  // the canonical id and returns it from `publish`.
  const ids: Record<string, string | null> = { a: null, b: null, c: null, d: null, e: null, f: null, g: null, h: null };

  const steps: ScriptStep[] = [
    {
      delayMs: 0,
      do: async () => {
        ids.a = await publish({ pluginPkg: "debug__system", severity: "info", lifecycle: "fyi", title: "Backup completed" });
      },
    },
    {
      delayMs: 400,
      do: async () => {
        ids.b = await publish({
          pluginPkg: "debug__news",
          severity: "nudge",
          lifecycle: "action",
          title: "News digest ready",
          body: "12 new items since yesterday",
        });
      },
    },
    {
      delayMs: 400,
      do: async () => {
        ids.c = await publish({ pluginPkg: "debug__encore", severity: "urgent", lifecycle: "action", title: "Pay property tax", body: "Due 2026-12-15" });
      },
    },
    {
      delayMs: 400,
      do: async () => {
        ids.d = await publish({ pluginPkg: "debug__system", severity: "info", lifecycle: "fyi", title: "Build #42 finished" });
      },
    },
    {
      delayMs: 400,
      do: async () => {
        ids.e = await publish({ pluginPkg: "debug__news", severity: "info", lifecycle: "action", title: "Weekly summary ready" });
      },
    },
    {
      delayMs: 400,
      do: async () => {
        ids.f = await publish({
          pluginPkg: "debug__journal",
          severity: "nudge",
          lifecycle: "action",
          title: "Yesterday's journal needs review",
          body: "3 sections drafted, awaiting your sign-off",
        });
      },
    },
    {
      delayMs: 400,
      do: async () => {
        ids.g = await publish({
          pluginPkg: "debug__taxes",
          severity: "urgent",
          lifecycle: "action",
          title: "W-2 received, file by Apr 15",
          body: "Auto-imported from email",
        });
      },
    },
    {
      delayMs: 400,
      do: async () => {
        ids.h = await publish({ pluginPkg: "debug__system", severity: "info", lifecycle: "fyi", title: "Disk usage 78%" });
      },
    },
    {
      // Peak: 8 entries visible across 5 plugin namespaces. The
      // cleanup phase below interleaves clear and cancel to show
      // both terminal verbs in flight.
      delayMs: 600,
      do: async () => {
        if (ids.b) await clear(ids.b);
      },
    },
    {
      delayMs: 400,
      do: async () => {
        if (ids.a) await clear(ids.a);
      },
    },
    {
      delayMs: 500,
      do: async () => {
        if (ids.f) await cancel(ids.f);
      },
    },
    {
      delayMs: 500,
      do: async () => {
        if (ids.h) await clear(ids.h);
      },
    },
    {
      delayMs: 500,
      do: async () => {
        if (ids.e) await clear(ids.e);
      },
    },
    {
      delayMs: 500,
      do: async () => {
        if (ids.c) await cancel(ids.c);
      },
    },
    {
      delayMs: 600,
      do: async () => {
        if (ids.d) await clear(ids.d);
      },
    },
    {
      delayMs: 600,
      do: async () => {
        if (ids.g) await clear(ids.g);
      },
    },
  ];

  for (const step of steps) {
    if (step.delayMs > 0) await sleep(step.delayMs);
    await step.do();
  }

  const elapsed = Math.round(performance.now() - startedAt);
  status.value = `✓ done in ${elapsed}ms`;
  running.value = false;
}

// ── Display helpers (literal strings, dev-only) ───────────────────

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
      class="absolute left-0 top-full mt-1 w-96 max-h-[70vh] bg-white border border-gray-200 rounded-lg shadow-lg z-50 flex flex-col text-xs"
    >
      <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <span class="font-semibold text-gray-700">Notifier debug</span>
        <span class="text-gray-400">— {{ visibleEntries.length }} active</span>
        <span class="ml-auto text-gray-500">{{ status }}</span>
      </div>
      <div class="px-3 py-2 border-b border-gray-100">
        <button
          type="button"
          data-testid="notifier-debug-run"
          class="w-full px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="running"
          @click="runScriptedTest"
        >
          {{ running ? "Running…" : "Run scripted test" }}
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <p v-if="visibleEntries.length === 0" class="px-3 py-4 text-gray-400 italic">No active entries</p>
        <ul v-else class="divide-y divide-gray-100">
          <li v-for="entry in visibleEntries" :key="entry.id" data-testid="notifier-debug-entry" class="px-3 py-2">
            <div class="flex items-start gap-2">
              <span :class="['mt-1 inline-block w-2 h-2 rounded-full shrink-0', severityDot(entry.severity)]" :title="entry.severity"></span>
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2">
                  <span class="font-medium text-gray-800 truncate">{{ entry.title }}</span>
                  <span v-if="entry.lifecycle" class="text-[10px] uppercase tracking-wide text-gray-400">{{ entry.lifecycle }}</span>
                </div>
                <div v-if="entry.body" class="text-gray-600 mt-0.5 truncate">{{ entry.body }}</div>
                <div class="text-gray-400 mt-0.5 font-mono text-[10px]">{{ entry.pluginPkg }} · {{ entry.id.slice(0, 8) }}</div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
<!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
