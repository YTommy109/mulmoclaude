import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentHtml",
  apiNamespace: "html",
  apiRoutes: {
    /** POST /api/html — save and present an HTML page. */
    create: { method: "POST", path: "" },
    /** PUT /api/html/update — overwrite an existing HTML page.
     *  Body carries the workspace-relative path. */
    update: { method: "PUT", path: "/update" },
  },
  mcpDispatch: "create",
});
