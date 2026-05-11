// POST /api/hooks/log — receives one structured log line from the
// PostToolUse dispatcher and forwards it into the server's logger.
//
// Why: hook handlers run inside Claude CLI's process space and have
// no path to the server's structured logger. Without this endpoint,
// every hook side-effect (skill-bridge mirror copy, future ones)
// silently succeeds — a user trying to verify a copy actually
// happened has no signal to look at, and a partial failure is
// indistinguishable from "the hook didn't fire". This endpoint is
// the bridge from "the hook side did something" to the same log
// stream the rest of the server writes to.
//
// Body shape:
//
//   { namespace: string; message: string;
//     level?: "info" | "warn" | "error"; data?: object }
//
// Authentication: bearer auth (same as every other internal hook
// endpoint). The dispatcher reads the workspace's `.session-token`
// sidecar before POSTing.

import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { badRequest } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";
import { isRecord } from "../../utils/types.js";

type Level = "info" | "warn" | "error";

interface HookLogBody {
  namespace?: unknown;
  message?: unknown;
  level?: unknown;
  data?: unknown;
}

const router = Router();

// Cap the inbound payload's text length. The dispatcher is trusted
// (bearer-authed, same machine) but a runaway handler emitting an
// unbounded `data` blob would crowd the server logs. 2 KB per field
// is comfortable for "mirror src → dst" style messages and tight
// enough to keep one event readable in the tail.
const MAX_FIELD_CHARS = 2048;

router.post(API_ROUTES.hooks.log, (req: Request<object, unknown, HookLogBody>, res: Response) => {
  const { namespace, message, level, data } = req.body ?? {};
  if (typeof namespace !== "string" || namespace.length === 0) {
    badRequest(res, "namespace required");
    return;
  }
  if (typeof message !== "string" || message.length === 0) {
    badRequest(res, "message required");
    return;
  }
  const resolvedLevel = resolveLevel(level);
  const truncatedNamespace = namespace.slice(0, MAX_FIELD_CHARS);
  const truncatedMessage = message.slice(0, MAX_FIELD_CHARS);
  const extras = isRecord(data) ? data : undefined;
  // Tag the log entry's namespace so it's easy to grep against
  // server-side noise — every hook-side log line starts with
  // `hook:<handler>` rather than the bare handler name a server
  // module would use.
  const taggedNamespace = `hook:${truncatedNamespace}`;
  log[resolvedLevel](taggedNamespace, truncatedMessage, extras);
  res.status(204).end();
});

function resolveLevel(raw: unknown): Level {
  if (raw === "warn" || raw === "error") return raw;
  return "info";
}

export default router;
