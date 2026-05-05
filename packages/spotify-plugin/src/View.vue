<script setup lang="ts">
// Spotify plugin View. Shows connection state in the header and the
// listening data (liked / playlists / recent / now playing) below.
//
// State machine:
//   - status === null      → loading (initial render)
//   - clientIdConfigured === false → show Configure form
//   - clientIdConfigured === true && connected === false → show Connect button
//   - connected === true   → show tabs + the active tab's data
//
// Each tab fetches lazily on first activation; refreshes on the
// "connected" pubsub event so a freshly authorised user sees data
// immediately without manually clicking Refresh.

import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { useT } from "./lang";
import type { NormalisedPlaylist, NormalisedTrack, RecentlyPlayedItem } from "./types";

interface StatusData {
  clientIdConfigured: boolean;
  connected: boolean;
  expiresAt: string | null;
  scopes: string[];
}

interface StatusResponse {
  ok: true;
  data: StatusData;
}

type Tab = "liked" | "playlists" | "recent" | "nowPlaying";

const { dispatch, openUrl, pubsub, log } = useRuntime();
const t = useT();

const status = ref<StatusData | null>(null);
const activeTab = ref<Tab>("liked");
const liked = ref<NormalisedTrack[] | null>(null);
const playlists = ref<NormalisedPlaylist[] | null>(null);
const recent = ref<RecentlyPlayedItem[] | null>(null);
const nowPlaying = ref<NormalisedTrack | null | undefined>(undefined);
const tabError = ref<string | null>(null);
const isLoadingTab = ref(false);

const clientIdInput = ref("");
const isSavingClientId = ref(false);
const saveError = ref<string | null>(null);

const isConnecting = ref(false);

async function refreshStatus(): Promise<void> {
  try {
    const response = await dispatch<StatusResponse>({ kind: "status" });
    if (response.ok) status.value = response.data;
  } catch (err) {
    log.warn("status fetch failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function saveClientId(): Promise<void> {
  if (clientIdInput.value.trim().length === 0) return;
  isSavingClientId.value = true;
  saveError.value = null;
  try {
    await dispatch({ kind: "configure", clientId: clientIdInput.value.trim() });
    clientIdInput.value = "";
    await refreshStatus();
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    isSavingClientId.value = false;
  }
}

async function startConnect(): Promise<void> {
  isConnecting.value = true;
  try {
    const redirectUri = `${window.location.origin}/api/plugins/runtime/oauth-callback/spotify`;
    const response = await dispatch<{ ok: boolean; data?: { authorizeUrl?: string }; message?: string }>({ kind: "connect", redirectUri });
    if (response.ok && response.data?.authorizeUrl) {
      window.location.href = response.data.authorizeUrl;
    } else {
      log.warn("connect failed", { response });
    }
  } catch (err) {
    log.warn("connect dispatch threw", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    isConnecting.value = false;
  }
}

async function loadActiveTab(): Promise<void> {
  if (!status.value?.connected) return;
  isLoadingTab.value = true;
  tabError.value = null;
  try {
    if (activeTab.value === "liked") {
      const response = await dispatch<{ ok: boolean; data?: NormalisedTrack[]; message?: string }>({ kind: "liked" });
      if (response.ok && response.data) liked.value = response.data;
      else tabError.value = response.message ?? t.value.loadFailed;
    } else if (activeTab.value === "playlists") {
      const response = await dispatch<{ ok: boolean; data?: NormalisedPlaylist[]; message?: string }>({ kind: "playlists" });
      if (response.ok && response.data) playlists.value = response.data;
      else tabError.value = response.message ?? t.value.loadFailed;
    } else if (activeTab.value === "recent") {
      const response = await dispatch<{ ok: boolean; data?: RecentlyPlayedItem[]; message?: string }>({ kind: "recent" });
      if (response.ok && response.data) recent.value = response.data;
      else tabError.value = response.message ?? t.value.loadFailed;
    } else if (activeTab.value === "nowPlaying") {
      const response = await dispatch<{ ok: boolean; data?: NormalisedTrack | null; message?: string }>({ kind: "nowPlaying" });
      if (response.ok) nowPlaying.value = response.data ?? null;
      else tabError.value = response.message ?? t.value.loadFailed;
    }
  } catch (err) {
    tabError.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoadingTab.value = false;
  }
}

function selectTab(next: Tab): void {
  activeTab.value = next;
  void loadActiveTab();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const expiryDisplay = computed(() => {
  if (!status.value?.expiresAt) return "";
  try {
    return new Date(status.value.expiresAt).toLocaleString();
  } catch {
    return status.value.expiresAt;
  }
});

const unsubs: Array<() => void> = [];
onMounted(() => {
  unsubs.push(
    pubsub.subscribe("connected", () => {
      void refreshStatus().then(() => loadActiveTab());
    }),
  );
  void refreshStatus().then(() => loadActiveTab());
});
onUnmounted(() => {
  for (const unsub of unsubs) unsub();
});
</script>

<template>
  <div class="spotify-view">
    <header class="spotify-header">
      <h2>{{ t.title }}</h2>
      <div class="spotify-status">
        <template v-if="status === null">{{ t.loading }}</template>
        <template v-else-if="!status.clientIdConfigured">{{ t.notConfigured }}</template>
        <template v-else-if="!status.connected">{{ t.notConnected }}</template>
        <template v-else>
          <span class="spotify-connected-pill">{{ t.connected }}</span>
          <span class="spotify-expiry">{{ t.expiresAt }}: {{ expiryDisplay }}</span>
        </template>
      </div>
    </header>

    <!-- Configure form (no Client ID yet) -->
    <section v-if="status && !status.clientIdConfigured" class="spotify-configure">
      <p class="spotify-configure-help">{{ t.configureHelp }}</p>
      <form class="spotify-configure-form" @submit.prevent="saveClientId">
        <input v-model="clientIdInput" :placeholder="t.configurePlaceholder" class="spotify-input" type="text" autocomplete="off" />
        <button type="submit" :disabled="isSavingClientId || clientIdInput.trim().length === 0" class="spotify-btn-primary">
          {{ isSavingClientId ? t.saving : t.save }}
        </button>
      </form>
      <p v-if="saveError" class="spotify-error">{{ saveError }}</p>
    </section>

    <!-- Connect button (Client ID set, no tokens) -->
    <section v-else-if="status && status.clientIdConfigured && !status.connected" class="spotify-connect-section">
      <button type="button" :disabled="isConnecting" class="spotify-btn-primary" @click="startConnect">
        {{ isConnecting ? t.connecting : t.connect }}
      </button>
    </section>

    <!-- Connected: tabs + content -->
    <template v-else-if="status?.connected">
      <nav class="spotify-tabs" role="tablist">
        <button
          v-for="tab in ['liked', 'playlists', 'recent', 'nowPlaying'] as const"
          :key="tab"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab"
          :class="['spotify-tab', { 'spotify-tab-active': activeTab === tab }]"
          @click="selectTab(tab)"
        >
          {{ tab === "liked" ? t.tabLiked : tab === "playlists" ? t.tabPlaylists : tab === "recent" ? t.tabRecent : t.tabNowPlaying }}
        </button>
        <button type="button" class="spotify-refresh" @click="loadActiveTab">{{ t.refresh }}</button>
      </nav>

      <p v-if="isLoadingTab" class="spotify-loading">{{ t.loading }}</p>
      <p v-else-if="tabError" class="spotify-error">
        {{ tabError }} <button class="spotify-retry" @click="loadActiveTab">{{ t.retry }}</button>
      </p>

      <ul v-else-if="activeTab === 'liked' && liked && liked.length > 0" class="spotify-list">
        <li v-for="track in liked" :key="track.id" class="spotify-track-row">
          <button type="button" class="spotify-track-link" @click="openUrl(track.url)">
            <img v-if="track.imageUrl" :src="track.imageUrl" alt="" class="spotify-cover" />
            <span class="spotify-track-meta">
              <span class="spotify-track-name">{{ track.name }}</span>
              <span class="spotify-track-artists">{{ t.trackBy }} {{ track.artists.join(", ") }}</span>
            </span>
            <span class="spotify-track-duration">{{ formatDuration(track.durationMs) }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="activeTab === 'liked'" class="spotify-empty">{{ t.emptyLiked }}</p>

      <ul v-else-if="activeTab === 'playlists' && playlists && playlists.length > 0" class="spotify-list">
        <li v-for="playlist in playlists" :key="playlist.id" class="spotify-playlist-row">
          <button type="button" class="spotify-track-link" @click="openUrl(playlist.url)">
            <img v-if="playlist.imageUrl" :src="playlist.imageUrl" alt="" class="spotify-cover" />
            <span class="spotify-track-meta">
              <span class="spotify-track-name">{{ playlist.name }}</span>
              <span class="spotify-track-artists">{{ playlist.trackCount }} {{ t.tracksCount }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="activeTab === 'playlists'" class="spotify-empty">{{ t.emptyPlaylists }}</p>

      <ul v-else-if="activeTab === 'recent' && recent && recent.length > 0" class="spotify-list">
        <li v-for="item in recent" :key="`${item.track.id}-${item.playedAt}`" class="spotify-track-row">
          <button type="button" class="spotify-track-link" @click="openUrl(item.track.url)">
            <img v-if="item.track.imageUrl" :src="item.track.imageUrl" alt="" class="spotify-cover" />
            <span class="spotify-track-meta">
              <span class="spotify-track-name">{{ item.track.name }}</span>
              <span class="spotify-track-artists">{{ t.trackBy }} {{ item.track.artists.join(", ") }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="activeTab === 'recent'" class="spotify-empty">{{ t.emptyRecent }}</p>

      <div v-else-if="activeTab === 'nowPlaying' && nowPlaying" class="spotify-now-playing">
        <button type="button" class="spotify-track-link" @click="openUrl(nowPlaying.url)">
          <img v-if="nowPlaying.imageUrl" :src="nowPlaying.imageUrl" alt="" class="spotify-now-cover" />
          <span class="spotify-track-meta">
            <span class="spotify-track-name">{{ nowPlaying.name }}</span>
            <span class="spotify-track-artists">{{ t.trackBy }} {{ nowPlaying.artists.join(", ") }}</span>
            <span class="spotify-track-album">{{ nowPlaying.album }}</span>
          </span>
        </button>
      </div>
      <p v-else-if="activeTab === 'nowPlaying'" class="spotify-empty">{{ t.emptyNowPlaying }}</p>
    </template>
  </div>
</template>

<style scoped>
.spotify-view {
  padding: 1rem;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.spotify-header h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
}
.spotify-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
  margin-bottom: 1rem;
}
.spotify-connected-pill {
  background: #1ed760;
  color: white;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}
.spotify-expiry {
  font-size: 0.75rem;
  color: #9ca3af;
}
.spotify-configure {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fafafa;
}
.spotify-configure-help {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
}
.spotify-configure-form {
  display: flex;
  gap: 0.5rem;
}
.spotify-input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-family: inherit;
}
.spotify-btn-primary {
  background: #1ed760;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-weight: 500;
  cursor: pointer;
}
.spotify-btn-primary:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}
.spotify-connect-section {
  display: flex;
  justify-content: center;
  padding: 2rem;
}
.spotify-tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 1rem;
}
.spotify-tab {
  background: none;
  border: none;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.875rem;
  color: #6b7280;
  border-bottom: 2px solid transparent;
}
.spotify-tab-active {
  color: #1ed760;
  border-bottom-color: #1ed760;
  font-weight: 500;
}
.spotify-refresh {
  margin-left: auto;
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  font-size: 0.75rem;
}
.spotify-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.spotify-track-row,
.spotify-playlist-row {
  border-radius: 0.375rem;
}
.spotify-track-row:hover,
.spotify-playlist-row:hover {
  background: #f5f5f5;
}
.spotify-track-link {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.spotify-cover {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.25rem;
  object-fit: cover;
  flex-shrink: 0;
}
.spotify-track-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}
.spotify-track-name {
  font-weight: 500;
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spotify-track-artists {
  font-size: 0.75rem;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spotify-track-album {
  font-size: 0.75rem;
  color: #9ca3af;
}
.spotify-track-duration {
  font-size: 0.75rem;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}
.spotify-now-playing {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  padding: 1rem;
}
.spotify-now-cover {
  width: 4rem;
  height: 4rem;
  border-radius: 0.375rem;
}
.spotify-empty,
.spotify-loading {
  color: #6b7280;
  font-size: 0.875rem;
  text-align: center;
  padding: 2rem;
}
.spotify-error {
  color: #dc2626;
  font-size: 0.875rem;
  padding: 0.5rem;
  background: #fef2f2;
  border-radius: 0.375rem;
}
.spotify-retry {
  background: none;
  border: 1px solid currentColor;
  border-radius: 0.25rem;
  padding: 0.125rem 0.5rem;
  margin-left: 0.5rem;
  cursor: pointer;
  color: inherit;
  font-size: inherit;
}
</style>
