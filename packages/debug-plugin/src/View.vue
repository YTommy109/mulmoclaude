<script setup lang="ts">
// Debug-plugin View. Deliberately a bare "Debug Page" title for now —
// content gets added on demand as we wire up experimental host
// features (the Notifier engine in plans/feat-encore.md, etc.).
//
// No i18n, by design: this page is dev-only chrome behind
// `VITE_DEV_MODE=1`. The set of users who ever see it is "developers
// reading the source", so every string is a literal English value,
// kept in this file. Don't add translation tables for the debug page;
// don't extract these strings into the host's vue-i18n bundle.
</script>

<template>
  <div class="h-full bg-white text-gray-900 flex flex-col overflow-hidden">
    <h2 class="text-lg font-semibold text-gray-800 px-3 py-2">Debug Page</h2>
  </div>
</template>
