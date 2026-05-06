// Central-registry-facing metadata for the chart plugin. Imported by
// host aggregators (`src/plugins/metas.ts`) which iterate every
// plugin's META and merge per-dimension records — host code holds
// zero plugin-specific literals.
//
// Browser-safe: no Vue / no Node-only imports.

import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentChart",
  apiNamespace: "chart",
  apiRoutes: {
    /** POST /api/chart — render and save a chart document. */
    create: { method: "POST", path: "" },
  },
  mcpDispatch: "create",
});
