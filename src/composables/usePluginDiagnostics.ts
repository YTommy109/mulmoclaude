// One-shot fetch of the boot-time plugin META aggregator
// diagnostics. Lives separately from `useNotifications` because:
//
//   - It runs at most once per session (the diagnostic list is
//     server-fixed at boot — no need to refetch).
//   - It owns the API call + payload validation; the notifications
//     composable stays a pure pub-sub consumer.
//
// Mount this once at the top of the app (e.g. from `App.vue`).
// Boot-time `publishNotification(...)` already pushes the same
// items via the live pubsub — this composable handles the
// "user opens a tab AFTER server boot" path so they still get a
// warning toast + bell entry.

import { onMounted } from "vue";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { useNotifications } from "./useNotifications";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_KINDS, NOTIFICATION_PRIORITIES, type NotificationPayload } from "../types/notification";
import { isRecord } from "../utils/types";

interface DiagnosticDto {
  id: string;
  message: string;
  // kind / scope / key / plugins are useful for richer UI later but
  // the bell only needs `id` + `message`. We forward them verbatim
  // to keep the door open for a future "diagnostics view".
  kind: "host-plugin" | "intra-plugin";
  scope: string;
  key: string;
  plugins: readonly string[];
}

function isDiagnosticDto(value: unknown): value is DiagnosticDto {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.message !== "string") return false;
  if (value.kind !== "host-plugin" && value.kind !== "intra-plugin") return false;
  if (typeof value.scope !== "string") return false;
  if (typeof value.key !== "string") return false;
  if (!Array.isArray(value.plugins) || !value.plugins.every((entry) => typeof entry === "string")) return false;
  return true;
}

function toNotificationPayload(diag: DiagnosticDto): NotificationPayload {
  return {
    id: diag.id,
    kind: NOTIFICATION_KINDS.system,
    title: "Plugin configuration issue",
    body: diag.message,
    action: { type: NOTIFICATION_ACTION_TYPES.none },
    firedAt: new Date().toISOString(),
    priority: NOTIFICATION_PRIORITIES.high,
  };
}

export function usePluginDiagnostics(): void {
  const { addLocal } = useNotifications();
  onMounted(async () => {
    const result = await apiGet<{ diagnostics: unknown }>(API_ROUTES.plugins.diagnostics);
    if (!result.ok) return;
    const list = result.data.diagnostics;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!isDiagnosticDto(item)) continue;
      addLocal(toNotificationPayload(item));
    }
  });
}
