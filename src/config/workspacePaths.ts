// Workspace-relative file paths — single source of truth.
//
// Shared by both the Vue frontend and the Express server.
// This file MUST NOT import node:path, node:os, or any Node-only
// module so it stays browser-compatible.
//
// The server's `server/workspace/paths.ts` imports these and
// joins them with the workspace root to produce absolute paths.

/** Well-known individual files. Values are workspace-relative paths. */
export const WORKSPACE_FILES = {
  memory: "conversations/memory.md",
  memoryIndex: "conversations/memory/MEMORY.md",
  sessionToken: ".session-token",
  /** Port the parent server bound to. Written at `app.listen` so
   *  out-of-process helpers (currently the LLM wiki-write hook —
   *  #763) can address the server without guessing whether `PORT`
   *  walked forward off a busy default. Mode 0600 to stay private. */
  serverPort: ".server-port",
  wikiIndex: "data/wiki/index.md",
  wikiLog: "data/wiki/log.md",
  wikiSchema: "data/wiki/SCHEMA.md",
  wikiSummary: "data/wiki/summary.md",
  summariesIndex: "conversations/summaries/_index.md",
  // todos lives under the plugin's `files.data` scope after the
  // #1145 migration. The encoded segment matches `encodeURIComponent`
  // of the plugin name `@mulmoclaude/todo-plugin` (see
  // `server/plugins/runtime.ts:sanitisePackageNameForFs`). These
  // entries stay so the file-explorer preview at
  // `src/utils/filesPreview/todoPreview.ts` still renders the kanban
  // when the user clicks the JSON file.
  todosItems: "data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json",
  todosColumns: "data/plugins/%40mulmoclaude%2Ftodo-plugin/columns.json",
  schedulerItems: "data/scheduler/items.json",
  schedulerUserTasks: "config/scheduler/tasks.json",
  schedulerOverrides: "config/scheduler/overrides.json",
  newsReadState: "config/news-read-state.json",
  /** Install ledger for runtime-loaded plugins (#1043 C-2). One row
   *  per installed plugin; the tgz files sit alongside in `plugins/`,
   *  extracted to `plugins/.cache/<name>/<version>/` on first boot. */
  pluginsLedger: "plugins/plugins.json",
} as const;
