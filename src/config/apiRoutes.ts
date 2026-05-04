// Single source of truth for every HTTP endpoint the server exposes
// under `/api/*`. Issue #289 (part 1) — consolidate the 77+ route
// registrations and ~57 frontend `fetch("/api/...")` call sites so
// that typos fail typecheck instead of producing runtime 404s.
//
// **Shape**: nested `as const` object grouped by owning route file /
// resource family. Every value is the literal, full path including
// the `/api` prefix. Routers in `server/routes/*.ts` register them
// verbatim — the `app.use("/api", ...)` mount prefix was removed so
// the constants are the unambiguous source.
//
// **Express params**: patterns like `:id` / `:filename` are kept as
// Express-compatible strings. Client-side URL builders (e.g. a
// `todoItem(id)` helper) are deliberately NOT added here until the
// frontend migration lands — see plans/done/refactor-api-routes-constants.md.
//
// **Adding a new endpoint**: add it here first, then reference the
// constant from the router file. Keep the nesting shallow and the
// key names matched to the last URL segment where possible.

import { CHAT_SERVICE_ROUTES } from "@mulmobridge/protocol";
import { BUILT_IN_PLUGIN_METAS, defineHostAggregate, type BuiltInPluginMetas, type HostPluginCollision, type IntraPluginCollision } from "../plugins/metas";

// Plugin-owned endpoint constants. Each plugin owns its dispatch
// URL string in its own definition.ts; this file re-keys them under
// the existing `API_ROUTES` shape so external consumers (route
// registration, MCP bridge) keep their current import paths. A
// plugin's local edit + `definition.ts` re-export is the only place
// that URL appears — no drift between plugin and config.

// Plugin-owned API routes auto-merged from each plugin's META. Each
// plugin's `apiRoutesKey` becomes the outer key under `API_ROUTES`
// (defaulting to `toolName` when omitted); its `apiRoutes` record
// becomes the value. Plugins without `apiRoutes` are skipped.
type PluginApiRoutesMap<T extends BuiltInPluginMetas> = {
  readonly [M in T[number] as M extends { readonly apiRoutes: Readonly<Record<string, string>> }
    ? M extends { readonly apiRoutesKey: infer K extends string }
      ? K
      : M["toolName"]
    : never]: M extends { readonly apiRoutes: infer R } ? R : never;
};

const HOST_API_ROUTES = {
  health: "/api/health",
  sandbox: "/api/sandbox",

  agent: {
    run: "/api/agent",
    cancel: "/api/agent/cancel",
    internal: {
      toolResult: "/api/internal/tool-result",
    },
  },

  // `chart` group migrated to META — see `src/plugins/chart/meta.ts`.
  // Auto-merged into `API_ROUTES.chart` via `apiRoutesKey: "chart"`.

  chatIndex: {
    rebuild: "/api/chat-index/rebuild",
  },

  // Single source of truth: @mulmobridge/protocol. See plans/done/messaging_transports.md.
  chatService: CHAT_SERVICE_ROUTES,

  config: {
    base: "/api/config",
    settings: "/api/config/settings",
    mcp: "/api/config/mcp",
    workspaceDirs: "/api/config/workspace-dirs",
    referenceDirs: "/api/config/reference-dirs",
    schedulerOverrides: "/api/config/scheduler-overrides",
  },

  files: {
    tree: "/api/files/tree",
    dir: "/api/files/dir",
    content: "/api/files/content",
    raw: "/api/files/raw",
    refRoots: "/api/files/ref-roots",
  },

  // `html` group migrated to META — see `src/plugins/presentHtml/meta.ts`.
  // Auto-merged via `apiRoutesKey: "html"`.

  image: {
    generate: "/api/generate-image",
    edit: "/api/edit-image",
    upload: "/api/images",
    // Body carries the workspace-relative path so the route doesn't
    // have to reconstruct one from a basename — required after #764
    // sharded image storage by YYYY/MM.
    update: "/api/images/update",
  },

  // Generic attachment store (paste/drop/file-picker uploads). Saves
  // the file under data/attachments/YYYY/MM/<id>.<ext> and returns
  // the workspace-relative path. PPTX uploads also save a companion
  // .pdf; the PDF path is what the route returns so the LLM never
  // needs to know about the original PPTX. Image uploads use this
  // same route now — image.upload remains for canvas drawings.
  attachments: {
    upload: "/api/attachments",
  },

  mcpTools: {
    list: "/api/mcp-tools",
    invoke: "/api/mcp-tools/:tool",
  },

  notifications: {
    // PoC endpoint for scheduled push fan-out (Web pub-sub + bridge).
    // Scaffolding for #144 / #142 — see plans/done/feat-notification-push-scaffold.md.
    test: "/api/notifications/test",
  },

  journal: {
    // Most recent existing daily summary (today, falling back to
    // prior days). Backs the top-bar "today's journal" shortcut
    // (#876). Returns null when no daily summary has been generated
    // yet on this workspace.
    latestDaily: "/api/journal/latest-daily",
  },

  // `mulmoScript` group migrated to META — see `src/plugins/presentMulmoScript/meta.ts`.
  // Auto-merged via `apiRoutesKey: "mulmoScript"`.

  pdf: {
    markdown: "/api/pdf/markdown",
  },

  // Plugin-owned endpoints that don't follow a single naming pattern.
  // Names match the plugin tool name or the short verb the plugin uses.
  plugins: {
    // `presentDocument` / `updateMarkdown` migrated to META — see
    // `src/plugins/markdown/meta.ts`. Auto-merged via
    // `apiRoutesKey: "presentDocument"`.
    // `presentSpreadsheet` / `updateSpreadsheet` migrated to META —
    // see `src/plugins/spreadsheet/meta.ts`. Auto-merged via
    // `apiRoutesKey: "presentSpreadsheet"`.
    mindmap: "/api/mindmap",
    quiz: "/api/quiz",
    // `form` and `canvas` migrated to META — exposed at top-level
    // `API_ROUTES.presentForm.dispatch` / `API_ROUTES.canvas.dispatch`.
    present3d: "/api/present3d",
    // Runtime-loaded plugins (#1043 C-2). One generic dispatch
    // endpoint shared by every workspace-installed plugin; the URL
    // pkg parameter is the URL-encoded npm package name (e.g.
    // `%40gui-chat-plugin%2Fweather`). Matched against the runtime
    // registry server-side; the registry's plugin.execute() handles
    // the call.
    runtimeList: "/api/plugins/runtime/list",
    runtimeDispatch: "/api/plugins/runtime/:pkg/dispatch",
    /** Boot-time META aggregator collisions (host vs plugin, plugin
     *  vs plugin). Returns an empty array when clean. Frontend
     *  fetches once at mount so a tab that opens after server boot
     *  still surfaces the warning toast + bell entry. See
     *  `server/plugins/diagnostics.ts`. */
    diagnostics: "/api/plugins/diagnostics",
    /** Static-mount of the extracted plugin tree. The URL pkg is the
     *  un-encoded npm name plus version dir. Used by the frontend
     *  loader's dynamic `import()` to fetch `dist/vue.js`.
     *
     *  Express 5 path-to-regexp uses `/{*name}` for catch-all
     *  wildcards (the bare `*` from Express 4 throws at registration).
     *  Handler reads the wildcard via `req.params.splat`. */
    runtimeAsset: "/api/plugins/runtime/:pkg/:version/{*splat}",
  },

  roles: {
    list: "/api/roles",
    manage: "/api/roles/manage",
  },

  scheduler: {
    base: "/api/scheduler",
    tasks: "/api/scheduler/tasks",
    task: "/api/scheduler/tasks/:id",
    taskRun: "/api/scheduler/tasks/:id/run",
    logs: "/api/scheduler/logs",
  },

  sessions: {
    list: "/api/sessions",
    // GET /api/sessions/:id (read) + DELETE /api/sessions/:id (hard delete)
    detail: "/api/sessions/:id",
    markRead: "/api/sessions/:id/mark-read",
    bookmark: "/api/sessions/:id/bookmark",
  },

  // `skills` group migrated to META — see `src/plugins/manageSkills/meta.ts`.
  // `sources` group migrated to META — see `src/plugins/manageSource/meta.ts`.

  news: {
    items: "/api/news/items",
    itemBody: "/api/news/items/:id/body",
    readState: "/api/news/read-state",
  },

  // `todos` group migrated to META — see `src/plugins/todo/meta.ts`.
  // Auto-merged via `apiRoutesKey: "todos"`.

  wiki: {
    base: "/api/wiki",
    /** History routes (#763 PR 2). `:slug` and `:stamp` are filled in
     *  by the caller — the constants stay route-pattern shaped so the
     *  Express router and the Vue API layer share one source of truth. */
    pageHistory: "/api/wiki/pages/:slug/history",
    pageHistorySnapshot: "/api/wiki/pages/:slug/history/:stamp",
    pageHistoryRestore: "/api/wiki/pages/:slug/history/:stamp/restore",
    /** Internal endpoint hit by the LLM-write hook script
     *  (`<workspace>/.claude/hooks/wiki-snapshot.mjs`). Re-reads
     *  the just-written file from disk and routes it into the
     *  snapshot pipeline. Never called by the Vue client. */
    internalSnapshot: "/api/wiki/internal/snapshot",
  },
} as const;

// First-write-wins host+plugin aggregate (see `defineHostAggregate`):
// host outer-keys win on collision (plugins claiming `agent`/`roles`/
// `wiki` are dropped), the second-claiming plugin's `apiRoutesKey`
// is dropped, both diagnostic lists are exposed for boot warnings.
// `defineHostAggregate` is generic over the value type — use the
// declared host record's value union here so `apiRoutes` records (a
// nested object, not a string) type-check inside the generic V.
const API_ROUTES_AGGREGATE = defineHostAggregate<(typeof HOST_API_ROUTES)[keyof typeof HOST_API_ROUTES] | Readonly<Record<string, string>>>(
  BUILT_IN_PLUGIN_METAS,
  {
    label: "API_ROUTES",
    hostRecord: HOST_API_ROUTES,
    extract: (meta) => (meta.apiRoutes !== undefined ? { [meta.apiRoutesKey ?? meta.toolName]: meta.apiRoutes } : undefined),
    dimension: "apiRoutesKey",
  },
);
export const API_ROUTES_HOST_COLLISIONS: readonly HostPluginCollision[] = API_ROUTES_AGGREGATE.hostCollisions;
export const API_ROUTES_INTRA_COLLISIONS: readonly IntraPluginCollision[] = API_ROUTES_AGGREGATE.intraCollisions;

export const API_ROUTES = API_ROUTES_AGGREGATE.merged as unknown as typeof HOST_API_ROUTES & PluginApiRoutesMap<BuiltInPluginMetas>;
