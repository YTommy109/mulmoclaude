import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageTodoList",
  apiNamespace: "todos",
  apiRoutes: {
    /** GET /api/todos — read items + columns for hydrating views. */
    list: { method: "GET", path: "" },
    /** POST /api/todos — legacy MCP action route (manageTodoList tool). */
    dispatch: { method: "POST", path: "" },
    /** POST /api/todos/items — create a new item. */
    itemsCreate: { method: "POST", path: "/items" },
    /** PATCH /api/todos/items/:id — partial update of one item. */
    itemPatch: { method: "PATCH", path: "/items/:id" },
    /** DELETE /api/todos/items/:id — remove one item. */
    itemDelete: { method: "DELETE", path: "/items/:id" },
    /** POST /api/todos/items/:id/move — drag-and-drop reorder/restatus. */
    itemMove: { method: "POST", path: "/items/:id/move" },
    /** GET /api/todos/columns — read just the columns. */
    columnsList: { method: "GET", path: "/columns" },
    /** POST /api/todos/columns — add a new column. */
    columnsAdd: { method: "POST", path: "/columns" },
    /** PATCH /api/todos/columns/:id — rename / toggle isDone. */
    columnPatch: { method: "PATCH", path: "/columns/:id" },
    /** DELETE /api/todos/columns/:id — remove a column (items are
     *  moved to the first remaining column). */
    columnDelete: { method: "DELETE", path: "/columns/:id" },
    /** PUT /api/todos/columns/order — persist a new column order. */
    columnsOrder: { method: "PUT", path: "/columns/order" },
  },
  mcpDispatch: "dispatch",
});
