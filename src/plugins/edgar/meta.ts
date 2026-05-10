// Central-registry-facing metadata for the SEC EDGAR plugin.
// Imported by host aggregators (`src/config/*`) which iterate over
// every plugin's META and merge automatically.
//
// Browser-safe: no Vue / no Node-only imports.

import { definePluginMeta } from "../meta-types";

/** Single object the host aggregators iterate over. Edgar is a
 *  pure-API plugin (no Vue View / Preview), but the central META
 *  shape is the same as any other built-in: tool name, API
 *  namespace + dispatch route, and the MCP-bridge route key. */
export const META = definePluginMeta({
  toolName: "edgar",
  apiNamespace: "edgar",
  apiRoutes: {
    /** POST /api/edgar — single dispatch route with `kind` discriminator. */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
});
