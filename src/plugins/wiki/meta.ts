import { definePluginMeta } from "../meta-types";

// View-only registry entry (Stage 3b, #963). The MCP tool was removed
// from the LLM but the plugin entry stays so server-emitted
// `page-edit` toolResults render in chat. No `apiRoutes` here — the
// /api/wiki host routes (history, snapshots) stay HOST-owned because
// they're consumed by both the wiki UI and the wiki-write hook.
export const META = definePluginMeta({
  toolName: "manageWiki",
});
