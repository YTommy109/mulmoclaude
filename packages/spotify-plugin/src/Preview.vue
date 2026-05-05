<script setup lang="ts">
// Preview shown inline in the chat thread (alongside the LLM's text
// response) when the LLM calls one of `manageSpotify`'s read kinds.
// The full View opens on click via the parent thread's standard
// "open in canvas" affordance — Preview just gives a glanceable
// summary so the user knows what data was returned without needing
// to expand the canvas.

import { computed } from "vue";
import { useT } from "./lang";
import type { NormalisedPlaylist, NormalisedTrack, RecentlyPlayedItem } from "./types";

interface Props {
  selectedResult: {
    ok?: boolean;
    data?: NormalisedTrack[] | NormalisedPlaylist[] | RecentlyPlayedItem[] | NormalisedTrack | null | { connected?: boolean; clientIdConfigured?: boolean };
    error?: string;
    message?: string;
  };
}
const props = defineProps<Props>();
const t = useT();

const summary = computed<string>(() => {
  const result = props.selectedResult;
  if (!result.ok) return result.message ?? t.value.notConnected;
  const data = result.data;
  if (Array.isArray(data)) return `${data.length} ${t.value.tracksCount}`;
  if (data === null) return t.value.emptyNowPlaying;
  if (data && typeof data === "object" && "connected" in data) {
    return data.connected ? t.value.connected : data.clientIdConfigured ? t.value.notConnected : t.value.notConfigured;
  }
  if (data && typeof data === "object" && "name" in data) {
    return (data as NormalisedTrack).name;
  }
  return t.value.previewSummary;
});
</script>

<template>
  <div class="spotify-preview">
    <span class="spotify-preview-icon" aria-hidden="true">♪</span>
    <span class="spotify-preview-label">{{ t.previewSummary }}</span>
    <span class="spotify-preview-summary">{{ summary }}</span>
  </div>
</template>

<style scoped>
.spotify-preview {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  background: #f5f5f5;
  font-size: 0.875rem;
}
.spotify-preview-icon {
  color: #1ed760;
  font-weight: 600;
}
.spotify-preview-label {
  font-weight: 500;
}
.spotify-preview-summary {
  color: #6b7280;
  font-size: 0.75rem;
}
</style>
