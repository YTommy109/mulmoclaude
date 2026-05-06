# Plugin API: namespace + (method, path) tuples

Issue: [#1141](https://github.com/receptron/mulmoclaude/issues/1141)

## Status: implemented

All 12 plugin METAs and every consumer migrated. Validation passes:
typecheck, lint, build, unit tests, todo + skills + sources + spreadsheet
+ mulmoScript e2e suites.

### Files changed

- **Type / aggregator**: `src/plugins/meta-types.ts` (already had RouteSpec, switched `replaceAll` → `split/join` for ES2020 lib), `src/plugins/api.ts` (relaxed `EndpointGroup` to allow either RouteSpec records or string records), `src/plugins/scope.ts`, `src/components/PluginScopedRoot.vue`, `src/utils/plugin/runtime.ts` (widen endpoints to `Record<string, unknown>`).
- **Server helper**: `server/utils/router.ts` — new `bindRoute(router, route, ...handlers)`.
- **Plugin METAs (12)**: markdown, spreadsheet, chart, presentHtml, presentForm, canvas, todo, accounting, scheduler/calendarMeta, presentMulmoScript, manageSkills, manageSource. (scheduler/automationsMeta stays toolName-only — calendar owns the routes.)
- **Definition.ts (×11)**: every plugin's `*Endpoints` type swapped from `typeof META.apiRoutes` to `{ readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute }`. Includes `scheduler/automationsDefinition.ts` which now derives from `calendarMeta`.
- **Plugin index.ts**: every `apiPost(endpoints.X, body)` → `apiCall(endpoints.X.url, { method: endpoints.X.method, body })`. accounting uses META directly (`/api/${META.apiNamespace}${path}`).
- **Plugin View.vue / composables**: `endpoints.X` → `endpoints.X.url` (for plain calls), `buildRouteUrl(endpoints.X, params)` (for `:id` routes — todo, manageSkills, scheduler/TasksTab, components/SourcesManager).
- **Server routes**: `server/api/routes/{todos,scheduler,schedulerTasks,plugins,chart,presentHtml,accounting,sources,skills,mulmo-script}.ts` — every `router.<verb>(API_ROUTES.X.Y, …)` → `bindRoute(router, API_ROUTES.X.Y, …)`. Dead `server/api/routes/html.ts` deleted (was unmounted, referenced legacy `html.generate`/`html.edit` keys that no longer exist).
- **DI**: `src/main.ts`, `test/helpers/installHostContext.ts` — registry keys updated (presentDocument→markdown, presentSpreadsheet→spreadsheet, presentForm→form).
- **MCP wiring**: `src/plugins/server.ts` — every binding uses new `mcpEndpoint(meta)` helper that resolves the URL from `apiNamespace` + `mcpDispatch`.
- **e2e**: `e2e/tests/present-mulmo-script.spec.ts` URL paths updated for `/api/mulmo-script/*` → `/api/mulmoScript/*`.
- **Tests**: `test/plugins/test_meta_aggregation.ts` — synthetic fixtures use new shape, dimension renamed `apiRoutesKey` → `apiNamespace`.

### URL changes (clean break, no aliases)

- `/api/present-document` → `/api/markdown`
- `/api/markdowns/update` → `/api/markdown/update`
- `/api/present-spreadsheet` → `/api/spreadsheet`
- `/api/spreadsheets/update` → `/api/spreadsheet/update`
- `/api/present-chart` → `/api/chart`
- `/api/present-html` → `/api/html`
- `/api/htmls/update` → `/api/html/update`
- `/api/mulmo-script/*` → `/api/mulmoScript/*` (path segment camelCase'd)

### Out of scope (unchanged)

- wiki (host-owned), editImages/generateImage METAs (toolName-only), runtime-loaded plugins.

## Goal

Replace plugin META's free-form full-URL `apiRoutes` with `apiNamespace` (URL prefix segment) + per-route `{ method, path }` tuples. Host composes URLs.

## Final shape

```ts
// meta.ts
export const META = definePluginMeta({
  toolName: "presentDocument",
  apiNamespace: "markdown",
  apiRoutes: {
    create: { method: "POST", path: "" },
    update: { method: "PUT",  path: "/:id" },
  },
});
```

Host produces:
```ts
API_ROUTES.markdown.create  // { method: "POST", url: "/api/markdown" }
API_ROUTES.markdown.update  // { method: "PUT",  url: "/api/markdown/:id" }
```

## Type-level changes

`src/plugins/meta-types.ts`:
- New `RouteSpec = { method: HttpMethod; path: string }`
- `PluginMeta.apiNamespace?: string` (replaces `apiRoutesKey`)
- `PluginMeta.apiRoutes?: Readonly<Record<string, RouteSpec>>`
- Add `mcpDispatch?: string` (route key the MCP bridge POSTs to — auto-derives the binding's URL)

`src/plugins/metas.ts`:
- `defineHostAggregate` already runtime-generic; the call site for API_ROUTES needs to compose `/api/<ns><path>` per route and emit `{ method, url }`.

## Plugin META rewrites (12)

| Plugin | namespace | routes |
|---|---|---|
| markdown | `markdown` | `create: POST ""`, `update: PUT "/:id"` |
| spreadsheet | `spreadsheet` | `create: POST ""`, `update: PUT "/:id"` |
| chart | `chart` | `create: POST ""` |
| presentHtml | `html` | `create: POST ""`, `update: PUT "/:id"` |
| presentForm | `form` | `dispatch: POST ""` |
| canvas | `canvas` | `dispatch: POST ""` |
| todo | `todos` | many — see live audit |
| accounting | `accounting` | `dispatch: POST ""` |
| scheduler (calendar+automations) | `scheduler` | many — see live audit |
| presentMulmoScript | `mulmoScript` | `save: POST "/save"` |
| manageSkills | `skills` | `create: POST ""` |
| manageSource | `sources` | `manage: POST "/manage"` |

(audit todo + scheduler routes during implementation; the legacy URLs match the routes 1:1.)

## Host changes

- `src/config/apiRoutes.ts` — wrap `defineHostAggregate` extract function to compose URLs and emit `{ method, url }` records
- `src/main.ts` — registry maps scope → resolved URL group (or pass full `{ method, url }` so plugin can choose)
- `src/plugins/server.ts` — `BUILT_IN_SERVER_BINDINGS[i]` gains `mcpDispatch: "<routeKey>"`, drops `endpoint`. Host derives endpoint URL from META + key.
- `server/agent/plugin-names.ts` — `TOOL_ENDPOINTS` map derives URL from the binding's `mcpDispatch` route lookup.

## Server route registrations

Each `server/api/routes/<name>.ts`:
```ts
router[API_ROUTES.X.create.method.toLowerCase()](API_ROUTES.X.create.url, ...)
```
or destructure via a small helper:
```ts
function bind(router, route, handler) {
  router[route.method.toLowerCase()](route.url, handler);
}
bind(router, API_ROUTES.markdown.create, handler);
```

## Client call sites

Today: `apiPost(endpoints.create, body)` — POST is hardcoded.
After: `apiCall(endpoints.create.method, endpoints.create.url, body)` — method comes from the route.

Easier shape: introduce `apiCall(method, url, body)` (or rename existing helpers to accept `Route` objects directly).

## DI plumbing

`pluginEndpoints<E>(scope)` today returns `Record<string, string>`. After: returns `Record<string, RouteSpec & { url: string }>`.

Plugin types update: `TodoEndpoints = typeof META.apiRoutes` (now `Record<string, RouteSpec>`) — but at runtime, the host registry hands resolved-URL versions.

## Migration order (single PR)

1. Type updates in `meta-types.ts`
2. Aggregator update in `metas.ts` / `apiRoutes.ts`
3. All 12 plugin META rewrites in parallel
4. Server route file updates
5. Client call site updates (each plugin's index.ts / View.vue)
6. Test fixture updates (e2e mock paths)
7. Validate: typecheck, lint, build, unit tests, e2e shard 1+2

## Out of scope

- Wiki (host-owned, no plugin namespace)
- Runtime-loaded plugins (already namespace-by-pkgname pattern)
- Backward-compat URL aliases (no external consumers)
