import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentSpreadsheet",
  apiNamespace: "spreadsheet",
  apiRoutes: {
    /** POST /api/spreadsheet — create a new spreadsheet. */
    create: { method: "POST", path: "" },
    /** PUT /api/spreadsheet/update — overwrite an existing
     *  spreadsheet. Body carries the workspace-relative path. */
    update: { method: "PUT", path: "/update" },
  },
  mcpDispatch: "create",
});
