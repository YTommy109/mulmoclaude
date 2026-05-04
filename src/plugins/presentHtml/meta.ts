import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentHtml",
  apiRoutesKey: "html",
  apiRoutes: {
    generate: "/api/generate-html",
    edit: "/api/edit-html",
    present: "/api/present-html",
    update: "/api/htmls/update",
  },
});
