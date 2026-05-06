<script setup lang="ts">
// Debug-plugin View — three modes, branched on URL query.
//
//   /debug                                — button panel (default)
//   /debug?mode=auto-clear&notificationId=…  — clear on mount
//   /debug?mode=manual-clear&notificationId=…  — clear on Done click
//
// The first two URLs are fired by the host's notifier-debug popup
// when an action notification's `navigateTarget` points back here.
// The popup appends `?notificationId=<uuid>` automatically.
//
// No i18n, by design: this page is dev-only chrome behind
// `VITE_DEV_MODE=1`. Strings stay literal English in this file.
//
// URL reactivity: the host's router fires a
// `mulmoclaude:routechange` CustomEvent on every navigation
// (`src/router/index.ts`). We listen for it (plus popstate for
// back/forward) and re-read `window.location.search` on each fire.
// This works around the runtime-plugin sandbox not having direct
// access to vue-router — adding `vue-router` to the host's plugin
// importmap is a separate, larger change, and the custom-event
// bridge keeps this PR's scope contained to the debug surface.

import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";

interface PublishArgs {
  kind: "publish";
  severity: "info" | "nudge" | "urgent";
  lifecycle: "fyi" | "action";
  title: string;
  body?: string;
  navigateTarget?: string;
}

interface ClearArgs {
  kind: "clear";
  id: string;
}

const runtime = useRuntime();

const mode = ref<string | null>(null);
const notificationId = ref<string | null>(null);
const status = ref<string>("");
const autoClearedAt = ref<string | null>(null);
const manualClearedAt = ref<string | null>(null);

function readUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const nextMode = params.get("mode");
  const nextId = params.get("notificationId");
  // Clear the per-mode confirmation state when the URL changes shape.
  // Without this, a user who flips between modes sees stale "cleared
  // at <time>" lines from the previous flow.
  if (nextMode !== mode.value || nextId !== notificationId.value) {
    autoClearedAt.value = null;
    manualClearedAt.value = null;
    status.value = "";
  }
  mode.value = nextMode;
  notificationId.value = nextId;
}

const view = computed<"default" | "auto-clear" | "manual-clear">(() => {
  if (mode.value === "auto-clear") return "auto-clear";
  if (mode.value === "manual-clear") return "manual-clear";
  return "default";
});

async function publish(args: Omit<PublishArgs, "kind">): Promise<void> {
  status.value = `firing ${args.lifecycle}/${args.severity}…`;
  try {
    const result = await runtime.dispatch<{ ok: boolean; id?: string }>({ kind: "publish", ...args } satisfies PublishArgs);
    status.value = result.id ? `published ${result.id.slice(0, 8)}` : `published`;
  } catch (err) {
    status.value = `publish failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function clearById(id: string): Promise<string> {
  await runtime.dispatch({ kind: "clear", id } satisfies ClearArgs);
  return new Date().toISOString();
}

async function maybeAutoClear(): Promise<void> {
  if (view.value !== "auto-clear" || !notificationId.value || autoClearedAt.value) return;
  try {
    autoClearedAt.value = await clearById(notificationId.value);
    status.value = `auto-cleared on mount`;
  } catch (err) {
    status.value = `auto-clear failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function manualClear(): Promise<void> {
  if (!notificationId.value) return;
  try {
    manualClearedAt.value = await clearById(notificationId.value);
    status.value = `cleared by Done`;
  } catch (err) {
    status.value = `clear failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function onRouteChange(): void {
  readUrl();
  void maybeAutoClear();
}

onMounted(() => {
  readUrl();
  window.addEventListener("mulmoclaude:routechange", onRouteChange);
  window.addEventListener("popstate", onRouteChange);
  void maybeAutoClear();
});

onUnmounted(() => {
  window.removeEventListener("mulmoclaude:routechange", onRouteChange);
  window.removeEventListener("popstate", onRouteChange);
});

// ── Default-mode button scenarios ─────────────────────────────────

interface Scenario {
  label: string;
  args: Omit<PublishArgs, "kind">;
}

const scenarios: Scenario[] = [
  { label: "fyi / info", args: { severity: "info", lifecycle: "fyi", title: "Backup completed" } },
  { label: "fyi / nudge", args: { severity: "nudge", lifecycle: "fyi", title: "Disk usage 85%" } },
  { label: "fyi / urgent", args: { severity: "urgent", lifecycle: "fyi", title: "Service degraded" } },
  { label: "action / info", args: { severity: "info", lifecycle: "action", title: "Weekly summary ready", body: "Click to read" } },
  { label: "action / nudge", args: { severity: "nudge", lifecycle: "action", title: "News digest ready", body: "12 new items" } },
  { label: "action / urgent", args: { severity: "urgent", lifecycle: "action", title: "Pay property tax", body: "Due 2026-12-15" } },
  {
    label: "action — clears on open (hyperlink test)",
    args: {
      severity: "info",
      lifecycle: "action",
      title: "Daily digest is ready",
      body: "Auto-clears when you open this page",
      navigateTarget: "/debug?mode=auto-clear",
    },
  },
  {
    label: "action — clears on Done (hyperlink test)",
    args: {
      severity: "nudge",
      lifecycle: "action",
      title: "Approve this thing",
      body: "Stays until you press Done",
      navigateTarget: "/debug?mode=manual-clear",
    },
  },
];

async function fireMixed(): Promise<void> {
  for (const scenario of scenarios.slice(0, 6)) {
    await publish(scenario.args);
  }
}
</script>

<!-- eslint-disable @intlify/vue-i18n/no-raw-text --
  Dev-only debug page, gated by `VITE_DEV_MODE=1` at the host.
  Strings stay literal English by design (see file header). -->
<template>
  <div class="h-full bg-white text-gray-900 flex flex-col overflow-hidden">
    <header class="flex items-center gap-3 px-3 py-2 border-b border-gray-200">
      <h2 class="text-lg font-semibold text-gray-800">Debug</h2>
      <span class="text-xs text-gray-400">{{ status }}</span>
    </header>

    <div v-if="view === 'default'" class="flex-1 overflow-y-auto p-4">
      <p class="text-sm text-gray-600 mb-3">
        Click a button below to fire a test notification. Watch the bug-icon popup next to the bell — it shows the new Active / History UX.
      </p>
      <div class="flex flex-col gap-2">
        <button
          v-for="scenario in scenarios"
          :key="scenario.label"
          type="button"
          class="text-left px-3 py-2 rounded border border-gray-200 bg-gray-50 hover:bg-gray-100 text-sm"
          :data-testid="`debug-fire-${scenario.label.replace(/[^a-z]+/gi, '-')}`"
          @click="publish(scenario.args)"
        >
          Fire {{ scenario.label }}
        </button>
        <button
          type="button"
          class="text-left px-3 py-2 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-sm"
          data-testid="debug-fire-mixed"
          @click="fireMixed"
        >
          Fire mixed batch (6 entries)
        </button>
      </div>
    </div>

    <div v-else-if="view === 'auto-clear'" class="flex-1 overflow-y-auto p-4">
      <h3 class="text-base font-semibold mb-2">Auto-clear on open</h3>
      <p class="text-sm text-gray-700 mb-2">
        This page cleared the notification automatically when it mounted. The "read-once" pattern: viewing the target IS the close.
      </p>
      <p v-if="autoClearedAt" class="text-sm text-green-700 mb-3">✓ Cleared at {{ autoClearedAt }}</p>
      <p v-else class="text-sm text-amber-600 mb-3">(clearing…)</p>
      <p class="text-xs text-gray-400 font-mono mb-3">id = {{ notificationId }}</p>
      <a href="/debug" class="text-blue-600 hover:underline text-sm">← back to test panel</a>
    </div>

    <div v-else class="flex-1 overflow-y-auto p-4">
      <h3 class="text-base font-semibold mb-2">Manual clear on Done</h3>
      <p class="text-sm text-gray-700 mb-2">
        Press the button below to clear the notification. The "act-on" pattern: opening the page does not by itself satisfy the obligation.
      </p>
      <p v-if="manualClearedAt" class="text-sm text-green-700 mb-3">✓ Cleared at {{ manualClearedAt }}</p>
      <p class="text-xs text-gray-400 font-mono mb-3">id = {{ notificationId }}</p>
      <button
        type="button"
        class="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!notificationId || manualClearedAt !== null"
        data-testid="debug-manual-clear-done"
        @click="manualClear"
      >
        Done
      </button>
      <div class="mt-4">
        <a href="/debug" class="text-blue-600 hover:underline text-sm">← back to test panel</a>
      </div>
    </div>
  </div>
</template>
<!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
