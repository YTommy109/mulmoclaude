// Single source of truth for workspace directory / file names and
// their absolute paths. The record below uses workspace-relative
// paths (possibly multi-segment, e.g. `config/roles`) as values; code
// looks up via `WORKSPACE_PATHS.<key>` to get the absolute form.
//
// Layout grouping (issue #284):
//
//   config/          settings + roles + helps
//   conversations/   chat + memory.md + summaries
//   data/            user-managed (wiki, todos, calendar, contacts,
//                    scheduler, sources, transports)
//   artifacts/       LLM-generated (charts, html, images, documents,
//                    spreadsheets, stories, news)
//
// Existing workspaces need the one-shot `scripts/migrate-workspace-284.ts`
// script run before first startup with this code. `server/workspace.ts`
// detects the pre-migration layout at boot and aborts with a pointer
// to the script.
//
// When adding a new top-level directory: add the name to the
// `WORKSPACE_DIRS` record below. The absolute path is derived
// automatically via `WORKSPACE_PATHS`.

import { homedir } from "os";
import path from "path";

// Well-known individual files — imported from the shared
// src/config/workspacePaths.ts (single source of truth for both
// server and frontend). Re-exported so server callers keep the
// same `import { WORKSPACE_FILES } from "./paths.js"` they use.
import { WORKSPACE_FILES } from "../../src/config/workspacePaths.js";

// Plugin-owned workspace dirs are auto-aggregated from every
// plugin's META in `src/plugins/metas.ts`. Adding a new plugin =
// register its META there; this file keeps the central
// `WORKSPACE_DIRS.<key>` shape via spread so existing consumers
// don't migrate. Plugin-specific literals never appear here.
import {
  BUILT_IN_PLUGIN_METAS,
  buildPluginAggregate,
  filterPluginKeys,
  type BuiltInPluginMetas,
  type HostPluginCollision,
  type IntraPluginCollision,
} from "../../src/plugins/metas.js";

// Merge every plugin's `workspaceDirs` into one record. The mapped
// type below preserves each plugin's literal path strings (e.g.
// `"data/accounting"`) so consumers like `WORKSPACE_DIRS.accounting`
// keep their narrow types — without it, TypeScript widens to
// `string` and downstream `WORKSPACE_PATHS.accounting` lookups break.
type PluginWorkspaceDirsMap<T extends BuiltInPluginMetas> = T[number] extends infer M
  ? M extends { readonly workspaceDirs: infer D }
    ? { readonly [K in keyof D]: D[K] }
    : Record<string, never>
  : Record<string, never>;

// First-write-wins aggregation. See `buildPluginAggregate`'s
// docblock — the merge itself enforces "first plugin claiming a
// dir key wins; later collisions are reported and dropped" (was
// last-write-wins via `Object.assign`).
const {
  aggregate: pluginWorkspaceDirsAggregate,
  owner: PLUGIN_WORKSPACE_DIRS_OWNER,
  collisions: WORKSPACE_DIRS_INTRA_COLLISIONS_RAW,
} = buildPluginAggregate(BUILT_IN_PLUGIN_METAS, (meta) => meta.workspaceDirs, "workspaceDirs");
export const WORKSPACE_DIRS_INTRA_COLLISIONS: readonly IntraPluginCollision[] = WORKSPACE_DIRS_INTRA_COLLISIONS_RAW;

const PLUGIN_WORKSPACE_DIRS = pluginWorkspaceDirsAggregate as PluginWorkspaceDirsMap<BuiltInPluginMetas>;

// Workspace root. Hard-coded to `~/mulmoclaude` — there is no
// WORKSPACE_PATH env override today; changing the location
// requires a code edit or a symlink. Re-exported by
// `server/workspace.ts` for backwards compatibility of existing
// callers that `import { workspacePath } from "./workspace.js"`.
export const workspacePath = path.join(homedir(), "mulmoclaude");

// Workspace-relative paths. Keys are the stable code-side identifiers
// (e.g. `markdowns` — unchanged for call-site compatibility); values
// are the on-disk paths, grouped per issue #284.
const HOST_WORKSPACE_DIRS = {
  // conversations/
  chat: "conversations/chat",
  // Typed memory entries (#1029). One markdown file per fact, indexed
  // by `MEMORY.md` (= WORKSPACE_FILES.memoryIndex). Replaces the
  // single-file `memory.md`; the legacy file is kept as
  // `memory.md.backup` after migration.
  memoryDir: "conversations/memory",
  // Staging dir for the atomic→topic migration (#1070 PR-A). Cluster
  // output lands here; the user reviews via `diff`, then `topic-swap`
  // promotes it to `memoryDir`. The dir name is also matched verbatim
  // by `topicStagingPath` and the swap-window detection in
  // `topic-detect.ts`, so changes here ripple through both places.
  memoryStaging: "conversations/memory.next",
  summaries: "conversations/summaries",
  // Tool-trace output for WebSearch (one .md per search, referenced
  // from chat JSONL `contentRef`). Lives alongside chat/ so search
  // trace and chat session share the same grouping.
  searches: "conversations/searches",
  // data/
  wiki: "data/wiki",
  todos: "data/todos",
  calendar: "data/calendar",
  contacts: "data/contacts",
  scheduler: "data/scheduler",
  sources: "data/sources",
  // Pasted/dropped chat attachments — saved at upload time so the
  // LLM can be handed a stable workspace path instead of inline
  // base64. Conversion artefacts (e.g. PPTX → PDF) live alongside
  // the original under the same YYYY/MM partition.
  attachments: "data/attachments",
  transports: "data/transports",
  // artifacts/
  charts: "artifacts/charts",
  // `markdowns` key preserved for call-site compatibility; on-disk
  // name is `documents` for clarity.
  markdowns: "artifacts/documents",
  // `htmls` = `presentHtml` plugin output (many files, persistent).
  // On-disk normalized to lowercase `html`.
  htmls: "artifacts/html",
  // Distinct from `htmls`: scratch buffer for the `/api/html`
  // generate-and-preview route. One file (`current.html`), always
  // overwritten. Kept separate so reloading a saved HTML artifact
  // doesn't clobber the current preview.
  html: "artifacts/html-scratch",
  images: "artifacts/images",
  spreadsheets: "artifacts/spreadsheets",
  stories: "artifacts/stories",
  news: "artifacts/news",
  // config/
  configs: "config",
  roles: "config/roles",
  helps: "config/helps",
  // Nested subdirs inside a top-level grouping. Kept here (rather
  // than module-local constants) when multiple modules need to
  // reference the same nested path — e.g. wiki/pages/ is used by
  // the wiki route, the wiki-backlinks driver, and the system
  // prompt hint.
  wikiPages: "data/wiki/pages",
  wikiSources: "data/wiki/sources",
  // Per-page edit-history snapshots (#763 PR 2). Hidden by leading
  // dot so a curious user listing `data/wiki/` doesn't trip over a
  // peer directory of historical content. Each `<slug>/` underneath
  // holds N snapshot .md files newest-first.
  wikiHistory: "data/wiki/.history",
  // Development — git-cloned repositories (#256).
  github: "github",
  // Runtime-loaded plugins (#1043 C-2). The `plugins/` directory holds
  // user-installed npm-published plugin tarballs; `.cache/<name>/<ver>/`
  // is the extracted-on-boot mirror. Both live under the workspace root
  // so the install / extract artefacts persist across npx invocations.
  plugins: "plugins",
  pluginCache: "plugins/.cache",
  // Per-runtime-plugin storage roots (#1110). The platform creates
  // `<root>/<sanitized-pkg-name>/` lazily on first write. data is the
  // backup target; config holds per-machine UI state / defaults.
  pluginsData: "data/plugins",
  pluginsConfig: "config/plugins",
} as const;

// Drop any plugin workspace-dir key that collides with a host dir
// (e.g. a plugin claiming `wiki` / `markdowns`) — the host wins so
// server I/O still hits the right on-disk location. Dropped entries
// are reported via `WORKSPACE_DIRS_HOST_COLLISIONS` for the boot
// diagnostics module.
// Cast back to the literal-preserving map: `filterPluginKeys` only
// drops keys, so the surviving subset is still a valid
// `PluginWorkspaceDirsMap` shape.
const { cleaned: cleanedWorkspaceDirs, dropped: WORKSPACE_DIRS_DROPPED } = filterPluginKeys(
  "WORKSPACE_DIRS",
  new Set(Object.keys(HOST_WORKSPACE_DIRS)),
  PLUGIN_WORKSPACE_DIRS,
  PLUGIN_WORKSPACE_DIRS_OWNER,
);
const SAFE_PLUGIN_WORKSPACE_DIRS = cleanedWorkspaceDirs as PluginWorkspaceDirsMap<BuiltInPluginMetas>;
export const WORKSPACE_DIRS_HOST_COLLISIONS: readonly HostPluginCollision[] = WORKSPACE_DIRS_DROPPED;

export const WORKSPACE_DIRS = {
  ...HOST_WORKSPACE_DIRS,
  // Built-in plugin dirs (auto-merged from every plugin's META —
  // see `src/plugins/metas.ts`). Adding a plugin = register its
  // META there; the keys spread below.
  ...SAFE_PLUGIN_WORKSPACE_DIRS,
} as const;
export { WORKSPACE_FILES };

// Absolute paths, built once at module load from `workspacePath`.
// The `workspacePath` const is itself fixed (reads `homedir()`
// at process start — no env override, see `server/workspace.ts`),
// so freezing these paths is safe.
//
// Auto-derived from `WORKSPACE_DIRS` and `WORKSPACE_FILES`. Adding
// a new dir or file to the upstream maps now flows into
// `WORKSPACE_PATHS` automatically — no second hand-curated edit
// required (CodeRabbit #1125 review: previously plugins adding
// `workspaceDirs` keys still needed a manual `WORKSPACE_PATHS`
// patch-up to be reachable in absolute form).
const WORKSPACE_DIR_PATHS = Object.fromEntries(Object.entries(WORKSPACE_DIRS).map(([key, relativePath]) => [key, path.join(workspacePath, relativePath)])) as {
  readonly [K in keyof typeof WORKSPACE_DIRS]: string;
};

const WORKSPACE_FILE_PATHS = Object.fromEntries(
  Object.entries(WORKSPACE_FILES).map(([key, relativePath]) => [key, path.join(workspacePath, relativePath)]),
) as {
  readonly [K in keyof typeof WORKSPACE_FILES]: string;
};

export const WORKSPACE_PATHS = {
  ...WORKSPACE_DIR_PATHS,
  ...WORKSPACE_FILE_PATHS,
} as const;

export type WorkspaceDirKey = keyof typeof WORKSPACE_DIRS;
export type WorkspacePathKey = keyof typeof WORKSPACE_PATHS;

// Directories `initWorkspace()` creates eagerly on server start.
// Kept as a subset of `WORKSPACE_DIRS` so new entries are additive
// without touching `server/workspace.ts`. Everything *not* on this
// list is created lazily (first write) by its owning module.
export const EAGER_WORKSPACE_DIRS: readonly WorkspaceDirKey[] = [
  "chat",
  "todos",
  "calendar",
  "contacts",
  "scheduler",
  "roles",
  "stories",
  "images",
  "markdowns",
  "spreadsheets",
  "charts",
  "configs",
  "github",
];
