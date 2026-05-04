import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageTodoList",
  apiRoutesKey: "todos",
  apiRoutes: {
    list: "/api/todos",
    dispatch: "/api/todos",
    items: "/api/todos/items",
    item: "/api/todos/items/:id",
    itemMove: "/api/todos/items/:id/move",
    columns: "/api/todos/columns",
    column: "/api/todos/columns/:id",
    columnsOrder: "/api/todos/columns/order",
  },
});
