import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageSource",
  apiNamespace: "sources",
  apiRoutes: {
    /** GET /api/sources — list every registered source. */
    list: { method: "GET", path: "" },
    /** POST /api/sources — register a new source. */
    create: { method: "POST", path: "" },
    /** DELETE /api/sources/:slug — remove a registered source. */
    remove: { method: "DELETE", path: "/:slug" },
    /** POST /api/sources/rebuild — re-run every fetcher, refresh
     *  archives. */
    rebuild: { method: "POST", path: "/rebuild" },
    /** POST /api/sources/manage — single-action dispatch route used
     *  by the MCP bridge. */
    manage: { method: "POST", path: "/manage" },
  },
  mcpDispatch: "manage",
});
