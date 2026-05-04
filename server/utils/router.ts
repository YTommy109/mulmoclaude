// Tiny adapter for registering Express routes from a `ResolvedRoute`
// `{ method, url }` tuple — the shape host aggregators emit for every
// plugin-owned route. Lets route files spell the registration as
// `bindRoute(router, API_ROUTES.todos.itemsCreate, handler)` instead
// of branching on the verb at the call site.
//
// Handler typing matches Express's own loose `RouteParameters`
// inference: a handler typed as `(req: Request<{ id: string }>, res:
// Response) => void` is forwarded as-is — the underlying
// `router[method](url, handler)` call accepts any handler shape, so
// we cast through `unknown` once here rather than at every site.

import type { IRouter, RequestHandler } from "express";
import type { ResolvedRoute } from "../../src/plugins/meta-types.js";

/** Register `handler` on `router` using the verb + URL declared by
 *  `route`. The generic on `handler` lets callers pass an Express
 *  handler typed against their own `params` / `body` / `query`
 *  generics; the cast hides the variance from Express's
 *  `RequestHandler<ParamsDictionary, …>` default. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bindRoute<H extends (...args: any[]) => unknown>(router: IRouter, route: ResolvedRoute, ...handlers: H[]): void {
  const cast = handlers as unknown as RequestHandler[];
  switch (route.method) {
    case "GET":
      router.get(route.url, ...cast);
      break;
    case "POST":
      router.post(route.url, ...cast);
      break;
    case "PUT":
      router.put(route.url, ...cast);
      break;
    case "PATCH":
      router.patch(route.url, ...cast);
      break;
    case "DELETE":
      router.delete(route.url, ...cast);
      break;
  }
}
