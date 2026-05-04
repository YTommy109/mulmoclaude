// Shape every built-in plugin's `meta.ts` exports as `META`.
// Host aggregators (src/config/*, server/workspace/paths.ts) iterate
// over `BUILT_IN_PLUGIN_METAS` and auto-merge the per-dimension
// records. Plugin-specific literals never appear in host code — the
// plugin owns what the plugin owns.
//
// Browser-safe: no Vue / no Node-only imports. Both server and
// frontend can import this file (and via it, every plugin's META).

/** Type-checking helper for a plugin's `meta.ts` literal. The
 *  `const` type parameter narrows nested literals (`toolName:
 *  "manageX"`, `apiRoutes.list: "/api/x"`, …) so host aggregators
 *  see the same string-literal types they would with
 *  `as const satisfies PluginMeta` — minus the dual annotation
 *  noise. Plugin authors write:
 *
 *  ```ts
 *  export const META = definePluginMeta({
 *    toolName: "manageX",
 *    apiRoutes: { dispatch: "/api/x" },
 *  });
 *  ```
 *
 *  …and get exactly the same downstream typing as the older
 *  `{...} as const satisfies PluginMeta` form. */
export function definePluginMeta<const T extends PluginMeta>(meta: T): T {
  return meta;
}

/** A plugin's central-registry-facing metadata. */
export interface PluginMeta {
  /** MCP tool name string the LLM and JSONL files use. */
  readonly toolName: string;
  /** Outer key under which `apiRoutes` mounts in the central
   *  `API_ROUTES` map. Defaults to `toolName` if omitted but most
   *  plugins prefer a shorter slug (e.g. `"accounting"` rather than
   *  `"manageAccounting"`). */
  readonly apiRoutesKey?: string;
  /** HTTP endpoint paths owned by this plugin. Mounted at
   *  `API_ROUTES[apiRoutesKey]` in the central aggregator.
   *  Each value is the literal full path including `/api`. */
  readonly apiRoutes?: Readonly<Record<string, string>>;
  /** Workspace-relative directories owned by this plugin (flat
   *  keys). Merged into the central `WORKSPACE_DIRS` so existing
   *  call sites (`WORKSPACE_DIRS.accounting`) keep working. */
  readonly workspaceDirs?: Readonly<Record<string, string>>;
  /** Static pubsub channel names owned by this plugin (flat keys).
   *  Merged into the central `PUBSUB_CHANNELS`. Channel factories
   *  (e.g. `bookChannel(bookId)`) are not part of this map — they
   *  live as separate named exports in the plugin's `meta.ts`
   *  because their signatures are plugin-specific. */
  readonly staticChannels?: Readonly<Record<string, string>>;
}
