import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageSource",
  apiRoutesKey: "sources",
  apiRoutes: {
    list: "/api/sources",
    create: "/api/sources",
    remove: "/api/sources/:slug",
    rebuild: "/api/sources/rebuild",
    manage: "/api/sources/manage",
  },
});
