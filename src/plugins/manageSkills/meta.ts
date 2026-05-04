import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageSkills",
  apiRoutesKey: "skills",
  apiRoutes: {
    list: "/api/skills",
    detail: "/api/skills/:name",
    create: "/api/skills",
    update: "/api/skills/:name",
    remove: "/api/skills/:name",
  },
});
