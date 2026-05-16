<script setup lang="ts">
// Encore chat-on-mount page (skeleton — Step 1 of
// plans/feat-encore-as-builtin.md). Step 5 wires up the real
// dispatch + redirect-to-/chat/<chatId> flow.
//
// Why the page exists at all:
//   - The tick NEVER calls chat.start(). If it did, the chat would
//     appear in the user's sidebar before they engaged with the
//     notification (the "abandoned chat" problem).
//   - Chat creation must be deferred until the user clicks the bell.
//     The bell's `navigateTarget` is just a URL, so to intercept the
//     click we own the destination route (/encore) and run plugin
//     code on mount.
//   - On mount, this view calls `resolveNotification` which starts
//     the chat server-side, then redirects to /chat/<chatId>. The
//     user never actually sees this page beyond a ~300ms
//     "Starting chat…" line.
//
// Notification clearing is NOT done here — that's the LLM's job once
// it's talking to the user in the resulting chat (it calls
// markStepDone / markTargetSkipped with the pendingId; the MCP
// handler reads the pending-clear ticket and calls notifier.clear).

import { computed } from "vue";

const pendingId = computed<string | null>(() => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("pendingId");
});
</script>

<template>
  <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- transient redirect page, not a user-facing surface; strings stay out of the 8-locale bundle (matches debug-plugin's View). -->
  <div class="h-full flex items-center justify-center text-sm text-gray-500">
    <div v-if="pendingId">Encore — pending {{ pendingId }} (skeleton; chat-on-mount flow wires up in Step 5)</div>
    <div v-else>Encore — no pendingId in URL (this page only opens from an Encore notification click).</div>
  </div>
  <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
</template>
