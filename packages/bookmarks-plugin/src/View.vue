<script setup lang="ts">
// Bookmarks plugin View — renders inside the host's canvas via the
// runtime plugin loader. Demonstrates `useRuntime()` + scoped pubsub +
// plugin-local i18n on a tiny surface.
//
// HTTP dispatch URL is the contracted runtime route shape;
// `manageBookmarks` calls land in `definePlugin`'s handler in
// `../index.ts`.

import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { useT } from "./lang";

interface Bookmark {
  id: string;
  url: string;
  title: string;
  addedAt: string;
}

// gui-chat-protocol's ViewComponentProps: the host passes
// `selectedResult` as the latest tool-call result. For our handler
// `selectedResult` looks like one of:
//   - { ok: true, bookmarks: [...] }  (after `list`)
//   - { ok: true, bookmark: {...} }   (after `add`)
//   - { ok: true }                    (after `remove` / `setSort`)
// The View always re-fetches on mount + on every `changed` pubsub
// event so the displayed list stays current regardless of which
// action triggered the mount.
interface Props {
  selectedResult: { bookmarks?: Bookmark[] };
}
const props = defineProps<Props>();

const { pubsub, openUrl, dispatch, log } = useRuntime();
const t = useT();

// Seed from `selectedResult` so the initial paint shows whatever the
// LLM's tool call returned (e.g. the freshly added bookmark) without
// waiting for `refetch()` to win the race. CodeRabbit review on PR
// #1124 caught the empty-on-mount flicker this used to cause.
const bookmarks = ref<Bookmark[]>(props.selectedResult.bookmarks ?? []);

// If the host swaps in a new tool result while this component stays
// mounted, mirror it. Cheap because Vue's prop watcher fires only on
// reference change.
watch(
  () => props.selectedResult.bookmarks,
  (next) => {
    if (next) bookmarks.value = next;
  },
);

async function refetch(): Promise<void> {
  try {
    const json = await dispatch<{ ok: boolean; bookmarks?: Bookmark[] }>({ kind: "list" });
    if (json.ok && json.bookmarks) bookmarks.value = json.bookmarks;
  } catch (err) {
    // CLAUDE.md mandate: every fetch must handle errors. Log + leave
    // the existing list visible so the user has SOMETHING rather than
    // a blank canvas (CodeRabbit review on PR #1124).
    log.warn("refetch failed; keeping last-known list", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function remove(id: string): Promise<void> {
  try {
    await dispatch({ kind: "remove", id });
    // The "changed" pubsub event from the server fires refetch below.
  } catch (err) {
    log.warn("remove failed", { id, error: err instanceof Error ? err.message : String(err) });
  }
}

let unsub: (() => void) | undefined;
onMounted(() => {
  unsub = pubsub.subscribe("changed", () => {
    void refetch();
  });
  // Refetch on mount in case the inline `result` is stale (page refresh).
  void refetch();
});
onUnmounted(() => unsub?.());
</script>

<template>
  <!--
    Vue 3 <script setup> auto-unwraps top-level refs in the template,
    so `t` (a ComputedRef) is accessed as `t.title`, not `t.value.title`.
    Writing `t.value.title` would compile to `unref(t).value.title` —
    double unwrap = `undefined.value.title` = runtime crash.
  -->
  <div class="bookmarks-view">
    <h2 class="bookmarks-title">
      {{ t.title }} <span class="bookmarks-count">({{ bookmarks.length }} {{ t.countSuffix }})</span>
    </h2>
    <ul v-if="bookmarks.length" class="bookmarks-list">
      <li v-for="bookmark in bookmarks" :key="bookmark.id" class="bookmarks-item">
        <button class="bookmarks-link" type="button" @click="openUrl(bookmark.url)">
          <span class="bookmarks-link-title">{{ bookmark.title }}</span>
          <span class="bookmarks-link-url">{{ bookmark.url }}</span>
        </button>
        <button class="bookmarks-remove" type="button" @click="remove(bookmark.id)">{{ t.remove }}</button>
      </li>
    </ul>
    <p v-else class="bookmarks-empty">{{ t.empty }}</p>
  </div>
</template>

<style scoped>
.bookmarks-view {
  padding: 1rem;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.bookmarks-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}
.bookmarks-count {
  color: #6b7280;
  font-weight: 400;
  font-size: 0.875rem;
}
.bookmarks-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.bookmarks-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
}
.bookmarks-link {
  flex: 1;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.bookmarks-link:hover .bookmarks-link-title {
  text-decoration: underline;
}
.bookmarks-link-title {
  display: block;
  font-weight: 500;
}
.bookmarks-link-url {
  display: block;
  font-size: 0.75rem;
  color: #6b7280;
}
.bookmarks-remove {
  background: none;
  border: none;
  color: #ef4444;
  font-size: 0.875rem;
  cursor: pointer;
}
.bookmarks-empty {
  color: #6b7280;
}
</style>
