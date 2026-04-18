// Scheduler library — public API surface.
// Zero dependencies on MulmoClaude internals. The integration
// adapter in server/events/task-manager/ wires this to the app.

export type {
  TaskSchedule,
  MissedRunPolicy,
  TaskOrigin,
  TaskRunContext,
  TaskExecutionState,
  TaskLogEntry,
} from "./types.js";
export { emptyState } from "./types.js";

export {
  nextWindowAfter,
  listMissedWindows,
  isDueAt,
  parseTimeToMs,
} from "./windows.js";

export type { CatchUpTask, CatchUpRun, CatchUpPlan } from "./catchup.js";
export { computeCatchUpPlan } from "./catchup.js";
