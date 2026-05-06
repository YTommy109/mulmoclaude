// Single dispatch endpoint matching the `manage*` tool pattern.
// Body: { action: "publish" | "clear" | "cancel" | "list", ... }.

import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { cancel, clear, listAll, listHistory, publish } from "../../notifier/engine.js";
import {
  NOTIFIER_LIFECYCLES,
  NOTIFIER_SEVERITIES,
  type NotifierEntry,
  type NotifierHistoryEntry,
  type NotifierLifecycle,
  type NotifierSeverity,
  type PublishInput,
} from "../../notifier/types.js";
import { log } from "../../system/logger/index.js";

interface DispatchBody {
  action?: unknown;
  // publish
  pluginPkg?: unknown;
  severity?: unknown;
  title?: unknown;
  body?: unknown;
  lifecycle?: unknown;
  navigateTarget?: unknown;
  pluginData?: unknown;
  // clear / cancel
  id?: unknown;
}

type DispatchResponse = { id: string } | { ok: true } | { entries: NotifierEntry[] } | { history: NotifierHistoryEntry[] } | { error: string };

const SEVERITY_SET = new Set<string>(NOTIFIER_SEVERITIES);
const LIFECYCLE_SET = new Set<string>(NOTIFIER_LIFECYCLES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asSeverity(value: unknown): NotifierSeverity | null {
  return typeof value === "string" && SEVERITY_SET.has(value) ? (value as NotifierSeverity) : null;
}

function asLifecycle(value: unknown): NotifierLifecycle | undefined {
  // `lifecycle` is optional. An undefined / missing field is fine;
  // a present-but-invalid value is rejected at the HTTP layer rather
  // than silently dropped, so clients get a clear 400.
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && LIFECYCLE_SET.has(value)) return value as NotifierLifecycle;
  return undefined;
}

// `action` lifecycle constraints, mirrored from `engine.publish`
// so HTTP callers get a clean 400 instead of a 500 from the engine
// throw. The engine still enforces independently for plugin-runtime
// callers; this is the route-level mirror.
function validateActionConstraints(severity: NotifierSeverity, lifecycle: NotifierLifecycle | undefined, navigateTarget: string | undefined): string | null {
  if (lifecycle !== "action") return null;
  if (severity === "info") return "action lifecycle is incompatible with info severity (use fyi for low-priority pings)";
  if (navigateTarget === undefined || navigateTarget.length === 0) return "action lifecycle requires a non-empty navigateTarget";
  return null;
}

function checkOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return `${fieldName} must be a string when set`;
  return null;
}

function parsePublishInput(body: DispatchBody): PublishInput | string {
  if (!isNonEmptyString(body.pluginPkg)) return "pluginPkg required";
  if (!isNonEmptyString(body.title)) return "title required";
  const severity = asSeverity(body.severity);
  if (!severity) return "severity must be one of info | nudge | urgent";
  if (body.lifecycle !== undefined && body.lifecycle !== null && asLifecycle(body.lifecycle) === undefined) {
    return "lifecycle must be one of fyi | action when set";
  }
  const bodyError = checkOptionalString(body.body, "body");
  if (bodyError) return bodyError;
  const navigateTargetError = checkOptionalString(body.navigateTarget, "navigateTarget");
  if (navigateTargetError) return navigateTargetError;
  const lifecycle = asLifecycle(body.lifecycle);
  const navigateTarget = typeof body.navigateTarget === "string" ? body.navigateTarget : undefined;
  const actionError = validateActionConstraints(severity, lifecycle, navigateTarget);
  if (actionError) return actionError;
  return {
    pluginPkg: body.pluginPkg,
    severity,
    title: body.title,
    body: typeof body.body === "string" ? body.body : undefined,
    lifecycle,
    navigateTarget,
    pluginData: body.pluginData,
  };
}

const notifierRouter: Router = Router();

notifierRouter.post(API_ROUTES.notifier.dispatch, async (req: Request<object, DispatchResponse, DispatchBody>, res: Response<DispatchResponse>) => {
  const body = req.body ?? {};
  const { action } = body;
  try {
    switch (action) {
      case "publish": {
        const input = parsePublishInput(body);
        if (typeof input === "string") {
          res.status(400).json({ error: input });
          return;
        }
        const result = await publish(input);
        res.json(result);
        return;
      }
      case "clear": {
        if (!isNonEmptyString(body.id)) {
          res.status(400).json({ error: "id required" });
          return;
        }
        await clear(body.id);
        res.json({ ok: true });
        return;
      }
      case "cancel": {
        if (!isNonEmptyString(body.id)) {
          res.status(400).json({ error: "id required" });
          return;
        }
        await cancel(body.id);
        res.json({ ok: true });
        return;
      }
      case "list": {
        const entries = await listAll();
        res.json({ entries });
        return;
      }
      case "listHistory": {
        const history = await listHistory();
        res.json({ history });
        return;
      }
      default:
        res.status(400).json({ error: `unknown action: ${typeof action === "string" ? action : "<missing>"}` });
    }
  } catch (err) {
    log.error("notifier-route", "dispatch failed", {
      action: typeof action === "string" ? action : "<unknown>",
      error: String(err),
    });
    res.status(500).json({ error: String(err) });
  }
});

export default notifierRouter;
