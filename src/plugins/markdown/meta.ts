import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentDocument",
  apiRoutesKey: "presentDocument",
  apiRoutes: {
    presentDocument: "/api/present-document",
    /** Body carries the workspace-relative path so the route doesn't
     *  have to reconstruct one from a basename — required after #764
     *  sharded artifact storage by YYYY/MM. Same shape as
     *  image.update. */
    updateMarkdown: "/api/markdowns/update",
  },
});
