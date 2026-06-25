// presentCollection's tool definition + executor now live in the shared
// @mulmoclaude/core/collection package (single source of truth, also consumed
// by MulmoTerminal). Re-exported here so existing importers — the server
// dispatch route (server/api/routes/plugins.ts) and the plugin index — keep
// working unchanged.
export { executePresentCollection, TOOL_NAME, TOOL_DEFINITION } from "@mulmoclaude/core/collection";
