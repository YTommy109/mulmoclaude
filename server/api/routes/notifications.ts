// PoC push endpoint — proves the server can fire a delayed message
// simultaneously to every open Web tab (pub-sub) and every bridge
// (chat-service `pushToBridge`). Stepping stone for the in-app
// notification center (#144) and external-channel notifications
// (#142); see plans/done/feat-notification-push-scaffold.md for the
// motivation and the production plan.
//
// Usage (basic):
//   curl -X POST http://localhost:3001/api/notifications/test \
//     -H "Authorization: Bearer $(cat ~/mulmoclaude/.session-token)" \
//     -H "Content-Type: application/json" \
//     -d '{"message":"hello","delaySeconds":5}'
//
// Usage (with permalink action — #762):
//   curl -X POST http://localhost:3001/api/notifications/test \
//     -H "Authorization: Bearer $TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"message":"Scheduled task fired","kind":"scheduler",
//          "action":{"type":"navigate",
//                    "target":{"view":"automations",
//                              "taskId":"finance-daily-briefing"}}}'
//
// For a one-shot "fire one of every target kind" run,
// scripts/dev/fire-sample-notifications.sh drives this endpoint.
//
// PR 4 of feat-encore made `publishNotification()` a thin wrapper
// over the notifier engine, so this route no longer needs injected
// pubsub / bridge deps — bridge push fans out via the legacy
// adapter subscribed to the engine, and `scheduleTestNotification`
// just calls the wrapper.

import { Router, type Request, type Response } from "express";
import { scheduleTestNotification, type ScheduleNotificationOptions } from "../../events/notifications.js";
import { log } from "../../system/logger/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import {
  NOTIFICATION_ACTION_TYPES,
  NOTIFICATION_KINDS,
  NOTIFICATION_VIEWS,
  type NotificationAction,
  type NotificationKind,
  type NotificationTarget,
} from "../../../src/types/notification.js";
import { isRecord } from "../../utils/types.js";

interface TestRequestBody {
  message?: unknown;
  body?: unknown;
  delaySeconds?: unknown;
  transportId?: unknown;
  kind?: unknown;
  action?: unknown;
}

interface TestResponse {
  firesAt: string;
  delaySeconds: number;
}

const KIND_SET = new Set<string>(Object.values(NOTIFICATION_KINDS));
const VIEW_SET = new Set<string>(Object.values(NOTIFICATION_VIEWS));

function parseKind(value: unknown): NotificationKind | undefined {
  if (typeof value !== "string") return undefined;
  return KIND_SET.has(value) ? (value as NotificationKind) : undefined;
}

// `path` / `slug` / `anchor` / etc. arrive as `unknown` from the JSON
// body. The URL builders in `legacyActionToNavigateTarget` assume each
// field is `string | undefined`; passing a number through (e.g.
// `path: 123`) would crash later inside `setTimeout` — after the 202
// is sent — when `path.split("/")` runs. So validate per-view here:
// any required field that isn't a non-empty string, or any optional
// field that is present but isn't a string, drops the whole action.
// The notification still fires; it just lands without a click target.
function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Per-view validators — split out so the dispatcher stays under the
// cognitive-complexity threshold. Each validator returns either the
// typed target or `undefined` for any field that doesn't match the
// `src/types/notification.ts` discriminated union.

function validateChatTarget(value: Record<string, unknown>): NotificationTarget | undefined {
  // sessionId required: chat without it would bounce off the catch-all redirect.
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0) return undefined;
  if (!isOptionalString(value.resultUuid)) return undefined;
  return { view: NOTIFICATION_VIEWS.chat, sessionId: value.sessionId, resultUuid: asOptionalString(value.resultUuid) };
}

function validateTodosTarget(value: Record<string, unknown>): NotificationTarget | undefined {
  if (!isOptionalString(value.itemId)) return undefined;
  return { view: NOTIFICATION_VIEWS.todos, itemId: asOptionalString(value.itemId) };
}

function validateAutomationsTarget(value: Record<string, unknown>): NotificationTarget | undefined {
  if (!isOptionalString(value.taskId)) return undefined;
  return { view: NOTIFICATION_VIEWS.automations, taskId: asOptionalString(value.taskId) };
}

function validateSourcesTarget(value: Record<string, unknown>): NotificationTarget | undefined {
  if (!isOptionalString(value.slug)) return undefined;
  return { view: NOTIFICATION_VIEWS.sources, slug: asOptionalString(value.slug) };
}

function validateFilesTarget(value: Record<string, unknown>): NotificationTarget | undefined {
  if (!isOptionalString(value.path)) return undefined;
  return { view: NOTIFICATION_VIEWS.files, path: asOptionalString(value.path) };
}

function validateWikiTarget(value: Record<string, unknown>): NotificationTarget | undefined {
  if (!isOptionalString(value.slug)) return undefined;
  if (!isOptionalString(value.anchor)) return undefined;
  return { view: NOTIFICATION_VIEWS.wiki, slug: asOptionalString(value.slug), anchor: asOptionalString(value.anchor) };
}

function validateNavigateTarget(value: unknown): NotificationTarget | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.view !== "string" || !VIEW_SET.has(value.view)) return undefined;
  switch (value.view) {
    case NOTIFICATION_VIEWS.chat:
      return validateChatTarget(value);
    case NOTIFICATION_VIEWS.todos:
      return validateTodosTarget(value);
    case NOTIFICATION_VIEWS.calendar:
      return { view: NOTIFICATION_VIEWS.calendar };
    case NOTIFICATION_VIEWS.automations:
      return validateAutomationsTarget(value);
    case NOTIFICATION_VIEWS.sources:
      return validateSourcesTarget(value);
    case NOTIFICATION_VIEWS.files:
      return validateFilesTarget(value);
    case NOTIFICATION_VIEWS.wiki:
      return validateWikiTarget(value);
    default:
      return undefined;
  }
}

/** Exported for unit tests. Production callers go through
 *  `createNotificationsRouter` and never see this function directly. */
export function parseAction(value: unknown): NotificationAction | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === NOTIFICATION_ACTION_TYPES.none) {
    return { type: NOTIFICATION_ACTION_TYPES.none };
  }
  if (value.type !== NOTIFICATION_ACTION_TYPES.navigate) return undefined;
  const target = validateNavigateTarget(value.target);
  if (!target) return undefined;
  return { type: NOTIFICATION_ACTION_TYPES.navigate, target };
}

function parseBody(body: TestRequestBody): ScheduleNotificationOptions {
  const opts: ScheduleNotificationOptions = {};
  if (typeof body.message === "string" && body.message.length > 0) {
    opts.message = body.message;
  }
  if (typeof body.body === "string" && body.body.length > 0) {
    opts.body = body.body;
  }
  if (typeof body.delaySeconds === "number") {
    opts.delaySeconds = body.delaySeconds;
  }
  if (typeof body.transportId === "string" && body.transportId.length > 0) {
    opts.transportId = body.transportId;
  }
  const kind = parseKind(body.kind);
  if (kind) opts.kind = kind;
  const action = parseAction(body.action);
  if (action) opts.action = action;
  return opts;
}

export function createNotificationsRouter(): Router {
  const router = Router();
  router.post(API_ROUTES.notifications.test, (req: Request<object, unknown, TestRequestBody>, res: Response<TestResponse>) => {
    const opts = parseBody(req.body ?? {});
    const scheduled = scheduleTestNotification(opts);
    log.info("notifications", "scheduled test push", {
      delaySeconds: scheduled.delaySeconds,
      firesAt: scheduled.firesAt,
      transportId: opts.transportId,
    });
    res.status(202).json({
      firesAt: scheduled.firesAt,
      delaySeconds: scheduled.delaySeconds,
    });
  });
  return router;
}
