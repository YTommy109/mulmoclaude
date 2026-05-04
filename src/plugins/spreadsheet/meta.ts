import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentSpreadsheet",
  apiRoutesKey: "presentSpreadsheet",
  apiRoutes: {
    presentSpreadsheet: "/api/present-spreadsheet",
    updateSpreadsheet: "/api/spreadsheets/update",
  },
});
