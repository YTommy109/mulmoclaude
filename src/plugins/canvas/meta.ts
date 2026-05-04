import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "openCanvas",
  // Promoted to top-level `API_ROUTES.canvas` (was nested under
  // `plugins.canvas` before the META migration).
  apiRoutesKey: "canvas",
  apiRoutes: {
    dispatch: "/api/canvas",
  },
});
