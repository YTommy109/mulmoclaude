<template>
  <div ref="rootRef" class="inline-flex w-fit border border-gray-300 rounded overflow-hidden text-xs" data-testid="plugin-launcher">
    <template v-for="(target, idx) in visibleTargets" :key="target.key">
      <!-- Visual separator between data plugins and management plugins -->
      <div v-if="idx === separatorAfterIndex" class="w-px bg-gray-300 my-0.5" />
      <button
        :class="[
          'h-8 px-2.5 flex items-center gap-1 border-r border-gray-200 last:border-r-0 transition-colors',
          isActive(target) ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
        ]"
        :title="target.literalTitle ?? t(`pluginLauncher.${target.key}.title`)"
        :data-testid="`plugin-launcher-${target.key}`"
        @click="emit('navigate', target)"
      >
        <span class="material-icons text-sm">{{ target.icon }}</span>
        <span v-if="!compact">{{ target.literalLabel ?? t(`pluginLauncher.${target.key}.label`) }}</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

// Quick-access toolbar sitting above the canvas. Each button
// navigates to a dedicated page (/todos, /wiki, etc.). The "invoke"
// kind is kept in the union for future use but currently all targets
// use "view".

const props = defineProps<{
  /** Current page route name — the matching button lights up. */
  activeViewMode?: string | null;
}>();

export type PluginLauncherKind = "view"; // Switch the canvas to a dedicated view mode

// The `key` is also the i18n lookup prefix (see pluginLauncher.*
// in src/lang/en.ts). Templates resolve the label / tooltip via
// `t(\`pluginLauncher.\${target.key}.label\`)` — keeping label/title
// strings out of this file avoids duplication across locales.
export interface PluginLauncherTarget {
  /** Stable key for testid + dispatch in App.vue. */
  key: "todos" | "calendar" | "automations" | "wiki" | "sources" | "news" | "skills" | "roles" | "files" | "debug";
  kind: PluginLauncherKind;
  /** Material-icons glyph. */
  icon: string;
  /** When true, only visible if `VITE_DEV_MODE=1`. The corresponding
   *  page itself is still reachable via direct URL (`/debug`) — only
   *  the launcher button is gated. */
  devOnly?: boolean;
  /** Literal label / tooltip used in place of the i18n lookup. Set on
   *  dev-only targets so the host's 8-locale bundle doesn't carry
   *  strings that only English-speaking developers ever see. When
   *  unset (the production case), label/title come from
   *  `pluginLauncher.<key>.{label,title}` in `src/lang/*.ts`. */
  literalLabel?: string;
  literalTitle?: string;
}

const TARGETS: PluginLauncherTarget[] = [
  // ─── Data plugins ───
  { key: "todos", kind: "view", icon: "checklist" },
  // Calendar + Automations were a single "Scheduler" entry until
  // #758 split them. Calendar keeps the former ⌘4 shortcut; the
  // Automations entry picks up ⌘9 (the first unused number).
  { key: "calendar", kind: "view", icon: "calendar_month" },
  { key: "automations", kind: "view", icon: "schedule" },
  { key: "wiki", kind: "view", icon: "menu_book" },
  { key: "sources", kind: "view", icon: "rss_feed" },
  // News viewer (#761) — a reader UI for items aggregated by the
  // sources pipeline. Sits next to the source-registry button so the
  // pair reads as "manage sources" → "read what they fetched".
  { key: "news", kind: "view", icon: "newspaper" },
  // ─── Management / navigation ───
  { key: "skills", kind: "view", icon: "psychology" },
  { key: "roles", kind: "view", icon: "manage_accounts" },
  { key: "files", kind: "view", icon: "folder" },
  // ─── Dev-only ───
  // Encore plan PR 1 follow-up. Hidden in production builds; the
  // /debug route stays reachable by typing the URL even with the
  // button hidden. Owned by `@mulmoclaude/debug-plugin`. Literal
  // label/title — the debug surface is dev-only, so we deliberately
  // keep the strings out of the 8-locale i18n bundle.
  { key: "debug", kind: "view", icon: "bug_report", devOnly: true, literalLabel: "Debug", literalTitle: "Open debug playground (dev mode only)" },
];

// Index AFTER which the visual separator is inserted (between data
// plugins on the left and management on the right). Data plugins are
// todos / calendar / automations / wiki / sources / news (indices
// 0-5), so the divider renders before index 6 (skills).
const SEPARATOR_AFTER_INDEX = 6;

// Dev-mode flag — set `VITE_DEV_MODE=1` in `.env`. Anything else
// (including unset) hides any target with `devOnly: true`.
const DEV_MODE = import.meta.env.VITE_DEV_MODE === "1";

// Targets that should render given the current dev-mode flag.
const visibleTargets = computed(() => TARGETS.filter((target) => !target.devOnly || DEV_MODE));

// Recompute the separator index after the dev-only filter — without
// this, hiding a dev-only target before the separator would shift the
// divider one slot to the left. Today the only dev-only target sits
// at the end, so this matches the static constant; the computed keeps
// future entries safe.
const separatorAfterIndex = computed(() => {
  const fullIndexOfSeparator = SEPARATOR_AFTER_INDEX;
  const hiddenBefore = TARGETS.slice(0, fullIndexOfSeparator).filter((target) => target.devOnly && !DEV_MODE).length;
  return fullIndexOfSeparator - hiddenBefore;
});

function isActive(target: PluginLauncherTarget): boolean {
  return props.activeViewMode === target.key;
}

const emit = defineEmits<{
  navigate: [target: PluginLauncherTarget];
}>();

// Compact mode (icons only) kicks in when the toolbar's parent row
// is narrower than this threshold. Tuned against the six labelled
// buttons + the canvas-view toggle sharing one row.
const COMPACT_BREAKPOINT_PX = 640;

const rootRef = ref<HTMLElement | null>(null);
const compact = ref(false);
let observer: ResizeObserver | null = null;

onMounted(() => {
  const parent = rootRef.value?.parentElement;
  if (!parent) return;
  const update = (width: number) => {
    compact.value = width < COMPACT_BREAKPOINT_PX;
  };
  update(parent.clientWidth);
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) update(entry.contentRect.width);
  });
  observer.observe(parent);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>
