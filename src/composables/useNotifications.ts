// Web-side subscriber for the `notifications` pub-sub channel.
// Stores incoming NotificationPayloads for the bell badge + panel.
//
// Uses a singleton subscription pattern: the first component that
// calls useNotifications() subscribes to the pub-sub channel; the
// last one to unmount unsubscribes. All consumers share the same
// module-level state (notifications + readIds).
//
// Read tracking is per-id via a Set. The unread badge decreases
// only when the user **interacts** with a notification — either
// clicking it (markRead) or dismissing it via × (dismiss removes
// the notification entirely, so it leaves the unread tally as a
// side effect). Opening the panel does NOT auto-mark everything
// read; the user has to explicitly act on each item, or hit the
// "Mark all read" button.

import { onUnmounted, ref, computed, type Ref, type ComputedRef } from "vue";
import { PUBSUB_CHANNELS } from "../config/pubsubChannels";
import { usePubSub } from "./usePubSub";
import { NOTIFICATION_KINDS } from "../types/notification";
import type { NotificationPayload } from "../types/notification";
import { isRecord } from "../utils/types";

const MAX_RECENT = 50;

const VALID_KINDS = new Set<string>(Object.values(NOTIFICATION_KINDS));

function isNotificationPayload(value: unknown): value is NotificationPayload {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.kind !== "string" || !VALID_KINDS.has(value.kind)) return false;
  if (typeof value.title !== "string") return false;
  if (typeof value.firedAt !== "string") return false;
  if (!isValidAction(value.action)) return false;
  return true;
}

function isValidAction(action: unknown): boolean {
  if (!isRecord(action)) return false;
  return typeof action.type === "string";
}

// Module-level state so all components share the same list and the
// same per-id read state.
const notifications = ref<NotificationPayload[]>([]);
// Set of notification ids the user has explicitly read (clicked or
// dismissed-as-read). A Set so add/lookup are O(1) per entry.
const readIds = ref<Set<string>>(new Set());

// Singleton subscription — ref-counted across consumers.
let subscriberCount = 0;
let unsubscribeFn: (() => void) | null = null;

function ensureSubscribed(subscribe: ReturnType<typeof usePubSub>["subscribe"]): void {
  subscriberCount++;
  if (unsubscribeFn) return; // already listening
  unsubscribeFn = subscribe(PUBSUB_CHANNELS.notifications, (data) => {
    if (!isNotificationPayload(data)) return;
    notifications.value = [data, ...notifications.value].slice(0, MAX_RECENT);
  });
}

function releaseSubscription(): void {
  subscriberCount--;
  if (subscriberCount <= 0 && unsubscribeFn) {
    unsubscribeFn();
    unsubscribeFn = null;
    subscriberCount = 0;
  }
}

export function useNotifications(): {
  notifications: Ref<NotificationPayload[]>;
  latest: ComputedRef<NotificationPayload | null>;
  unreadCount: ComputedRef<number>;
  isRead: (id: string) => boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
} {
  const { subscribe } = usePubSub();
  ensureSubscribed(subscribe);
  onUnmounted(releaseSubscription);

  const latest = computed(() => notifications.value[0] ?? null);

  const unreadCount = computed(() => notifications.value.filter((notif) => !readIds.value.has(notif.id)).length);

  function isRead(notifId: string): boolean {
    return readIds.value.has(notifId);
  }

  function markRead(notifId: string): void {
    if (readIds.value.has(notifId)) return;
    // Replace the Set so Vue's reactivity fires on consumers that
    // depend on `readIds` via `unreadCount` / `isRead`.
    const next = new Set(readIds.value);
    next.add(notifId);
    readIds.value = next;
  }

  function markAllRead(): void {
    if (notifications.value.length === 0) return;
    const next = new Set(readIds.value);
    for (const notif of notifications.value) {
      next.add(notif.id);
    }
    readIds.value = next;
  }

  function dismiss(notifId: string): void {
    notifications.value = notifications.value.filter((notif) => notif.id !== notifId);
    // No need to clean up readIds — the entry it might contain is
    // harmless once the notification itself is gone, and the Set
    // is bounded by MAX_RECENT in practice (every payload that
    // could land here was once in `notifications`).
  }

  return { notifications, latest, unreadCount, isRead, markRead, markAllRead, dismiss };
}
