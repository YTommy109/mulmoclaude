import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageCalendar",
  apiNamespace: "scheduler",
  apiRoutes: {
    /** GET /api/scheduler — read calendar items. */
    list: { method: "GET", path: "" },
    /** POST /api/scheduler — calendar / automations action dispatch.
     *  The server splits calendar item actions from task-related
     *  actions via the `action` discriminator (see `TASK_ACTIONS`). */
    dispatch: { method: "POST", path: "" },
    /** GET /api/scheduler/tasks — list every registered task
     *  (system + user). */
    tasksList: { method: "GET", path: "/tasks" },
    /** POST /api/scheduler/tasks — create a user task. */
    tasksCreate: { method: "POST", path: "/tasks" },
    /** PUT /api/scheduler/tasks/:id — update a user task. */
    taskUpdate: { method: "PUT", path: "/tasks/:id" },
    /** DELETE /api/scheduler/tasks/:id — delete a user task. */
    taskDelete: { method: "DELETE", path: "/tasks/:id" },
    /** POST /api/scheduler/tasks/:id/run — fire a task immediately. */
    taskRun: { method: "POST", path: "/tasks/:id/run" },
    /** GET /api/scheduler/logs — newest-first scheduler execution log. */
    logs: { method: "GET", path: "/logs" },
  },
  mcpDispatch: "dispatch",
});
