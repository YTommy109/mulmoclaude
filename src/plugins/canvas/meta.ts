import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "openCanvas",
  apiNamespace: "canvas",
  apiRoutes: {
    /** POST /api/canvas — open a drawing canvas the user can sketch
     *  on. Result carries the workspace-relative image path. */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
});
