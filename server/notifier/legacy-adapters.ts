// Bridge + macOS Reminder side-channel adapters for the notifier engine.
//
// These previously fired inline inside `publishNotification()` (legacy
// `server/events/notifications.ts`). PR 4 of feat-encore relocates them
// to in-process listeners on the engine so the wrapper stays concerned
// only with mapping → engine, and any future direct caller of
// `notifier.publish()` automatically gets the same fan-out by setting
// the fields the adapters read.
//
// **No severity-based routing in v1.** The macOS adapter fires for
// every `published` event (gated only by darwin + env flag inside
// `pushToMacosReminder` itself), and the bridge adapter fires only
// when the entry carries a legacy `transportId` in its `pluginData`.
// If a future use case wants severity-driven routing, the engine
// already stores `severity` on every entry — the adapters can grow
// the check without engine changes.
//
// Why in-process listeners (`engine.onEvent`) rather than a pubsub
// subscription: the host's `IPubSub` is fan-out-only with no
// server-side subscribe API. Going through socket.io for an
// in-process notification would mean shipping the event out and
// reading it back through a websocket round-trip, which is silly.

import { onEvent } from "./engine.js";
import { isLegacyNotifierPluginData } from "../events/notifications.js";
import { pushToMacosReminder } from "../system/macosNotify.js";
import { log } from "../system/logger/index.js";
import type { NotifierEntry } from "./types.js";

export type PushToBridge = (transportId: string, chatId: string, message: string) => void;

export interface LegacyAdapterDeps {
  pushToBridge: PushToBridge;
}

/** Format the bridge message identically to the legacy inline path so
 *  Telegram / CLI subscribers see the same text shape they always did
 *  (icon + title + optional body). */
function formatBridgeMessage(entry: NotifierEntry): string {
  const legacy = isLegacyNotifierPluginData(entry.pluginData) ? entry.pluginData : null;
  // U+2705 (white heavy check mark) for the agent kind, U+1F514 (bell)
  // for everything else — same fallback the legacy formatter used.
  const icon = legacy?.kind === "agent" ? "✅" : "\u{1F514}";
  const parts = [icon, entry.title];
  if (entry.body) parts.push(entry.body);
  return parts.join(" ");
}

/** Wire the adapters as in-process listeners on the notifier engine.
 *  Returns an unsubscribe function for tests / teardown. */
export function startLegacyAdapters(deps: LegacyAdapterDeps): () => void {
  return onEvent((event) => {
    if (event.type !== "published") return;
    const { entry } = event;
    // macOS sink is a no-op outside darwin / when
    // DISABLE_MACOS_REMINDER_NOTIFICATIONS=1, so it's safe to fire
    // unconditionally. `pushToMacosReminder` itself wraps every
    // failure path in try / log.warn.
    void pushToMacosReminder(entry.title, entry.body);
    const legacy = isLegacyNotifierPluginData(entry.pluginData) ? entry.pluginData : null;
    if (legacy?.transportId) {
      try {
        // chatId is hardcoded — the legacy `chatId` knob on the PoC
        // endpoint was a one-caller artifact (only `scheduleTestNotification`
        // ever set it) and was removed alongside the migration. If a
        // real production caller later needs per-conversation routing,
        // it deserves a designed surface, not a recreated PoC field.
        deps.pushToBridge(legacy.transportId, "notifications", formatBridgeMessage(entry));
      } catch (err) {
        // Keep the legacy contract: a failing bridge sink must never
        // bubble out of the notifier emit chain.
        log.warn("notifier-legacy-adapters", "bridge push failed", { error: String(err) });
      }
    }
  });
}
