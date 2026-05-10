// Generic wrapper that turns "unhandled error inside an async route
// handler" into "logged 500 response". Without it, an uncaught throw
// either crashes the request silently or surfaces as a generic 500
// with no server-side trace (#779 / DRY audit batch B).
//
// Migration story: `server/api/routes/plugins.ts` shipped a private
// `wrapPluginExecute` with this exact shape, hard-coded to the
// "plugins" log namespace. This module generalises the same idea so
// every route file uses one wrapper.
//
// Scope:
//
//   - Catches anything the inner handler throws. The wrapper logs
//     the raw error message on the server side (full detail kept for
//     debugging) and returns a 500 carrying ONLY the caller-supplied
//     `fallbackMessage` — never the raw `err.message`. Leaking
//     internal error text to clients would surface stack-shape
//     details, file paths, and library internals to anyone hitting
//     the endpoint.
//   - The inner handler stays in charge of 4xx mapping (validation,
//     not-found, etc.) — those paths respond + `return` inside the
//     handler before the wrapper's catch ever runs.
//   - Skipped when the response has already been sent (`headersSent`)
//     so a partial response that throws mid-stream doesn't try to
//     write a second status.
//
// Naming: `namespace` is the log tag (e.g. "accounting", "wiki") —
// matches the existing `log.info("namespace", …)` convention across
// the route layer. `fallbackMessage` mirrors the strings the
// hand-rolled try/catch blocks used before the migration ("failed to
// load news items", "Failed to list tasks", …) so the client-facing
// behaviour is unchanged.

import type { Request, Response } from "express";
import { log } from "../system/logger/index.js";
import { errorMessage } from "./errors.js";
import { serverError } from "./httpError.js";

// Generics intentionally use `Request` / `Response` shapes without
// the upstream `Request<ParamsDictionary>` constraint — callers like
// `Request<object, unknown, MyBody>` use `object` for params, which
// is incompatible with Express's default `ParamsDictionary` upper
// bound. Mirrors the existing `wrapPluginExecute` signature.
export function asyncHandler<TReq extends Request<unknown, unknown, unknown, unknown> = Request, TRes extends Response = Response>(
  namespace: string,
  fallbackMessage: string,
  handler: (req: TReq, res: TRes) => Promise<void>,
): (req: TReq, res: TRes) => Promise<void> {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      log.error(namespace, "handler threw", { route: req.path, error: errorMessage(err) });
      if (!res.headersSent) {
        serverError(res, fallbackMessage);
      }
    }
  };
}
