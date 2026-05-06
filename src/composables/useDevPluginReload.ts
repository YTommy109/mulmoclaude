// Auto-reload the page when a `--dev-plugin` (PR2 of #1159) project's
// `dist/` is rebuilt — see `server/plugins/dev-watcher.ts` for the
// publisher side. Subscription is wired once at app boot via main.ts.
//
// Only browser-side files (View.vue / vue.js / *.css) hot-load
// usefully; the server-side `dist/index.js` cannot be hot-replaced
// because Node's ESM module cache has no public invalidation API.
// The watcher logs a prominent server warning when index.js is in
// the change set; the browser reload still happens because it's a
// cheap idempotent cleanup. See PR3's plan for the trade-off.

import { PUBSUB_CHANNELS } from "../config/pubsubChannels";
import { usePubSub } from "./usePubSub";
import { isRecord } from "../utils/types";

export function startDevPluginReloadListener(): void {
  const { subscribe } = usePubSub();
  subscribe(PUBSUB_CHANNELS.devPluginChanged, (payload) => {
    const name = isRecord(payload) && typeof payload.name === "string" ? payload.name : "(unknown)";
    console.info(`[dev-plugin] ${name} changed — reloading`);
    window.location.reload();
  });
}
