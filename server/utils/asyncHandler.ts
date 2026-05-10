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
//     once at `log.error` with the request path + error message and
//     returns a 500 with `serverError(res, …)`.
//   - The inner handler stays in charge of 4xx mapping (validation,
//     not-found, etc.) — those paths respond + `return` inside the
//     handler before the wrapper's catch ever runs.
//   - Skipped when the response has already been sent (`headersSent`)
//     so a partial response that throws mid-stream doesn't try to
//     write a second status.
//
// Naming: `namespace` is the log tag (e.g. "accounting", "wiki") —
// matches the existing `log.info("namespace", …)` convention across
// the route layer.

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
  handler: (req: TReq, res: TRes) => Promise<void>,
): (req: TReq, res: TRes) => Promise<void> {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const message = errorMessage(err);
      log.error(namespace, "handler threw", { route: req.path, error: message });
      if (!res.headersSent) {
        serverError(res, message);
      }
    }
  };
}
