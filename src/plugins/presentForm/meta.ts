import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentForm",
  apiNamespace: "form",
  apiRoutes: {
    /** POST /api/form — render a form for the user to fill out. */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
});
