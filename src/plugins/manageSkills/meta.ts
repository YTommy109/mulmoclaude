import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageSkills",
  apiNamespace: "skills",
  apiRoutes: {
    /** GET /api/skills — list every available skill (user + project). */
    list: { method: "GET", path: "" },
    /** GET /api/skills/:name — read one skill's body + frontmatter. */
    detail: { method: "GET", path: "/:name" },
    /** POST /api/skills — create a new project-scope skill. The MCP
     *  bridge posts here. */
    create: { method: "POST", path: "" },
    /** PUT /api/skills/:name — overwrite an existing project-scope
     *  skill. */
    update: { method: "PUT", path: "/:name" },
    /** DELETE /api/skills/:name — delete a project-scope skill. */
    remove: { method: "DELETE", path: "/:name" },
  },
  mcpDispatch: "create",
});
