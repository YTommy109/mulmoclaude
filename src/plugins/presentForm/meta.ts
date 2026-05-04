import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentForm",
  // Promoted to top-level `API_ROUTES.presentForm` (was nested
  // under `plugins.form` before the META migration).
  apiRoutesKey: "presentForm",
  apiRoutes: {
    dispatch: "/api/form",
  },
});
