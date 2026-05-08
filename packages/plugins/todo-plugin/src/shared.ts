// Cross-context entry — types + pure helpers that host components
// (the `/todos` file-explorer route in `src/components/TodoExplorer.vue`,
// the kanban subcomponents under `src/components/todo/*`, the file
// preview at `src/utils/filesPreview/todoPreview.ts`, etc.) need to
// import without dragging in the server's `definePlugin` factory or
// the runtime-loaded Vue components.
//
// The contract is: anything safe to bundle into the host app's main
// build (no Node-only deps, no Vue components) is re-exported from
// here. The server entry (`./index.ts`) and the View entry
// (`./vue.ts`) are runtime-loaded by the host's plugin loader and
// should NOT be statically imported by host source.

export type { TodoItem, TodoPriority, StatusColumn, TodoData } from "./types";
export {
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  PRIORITY_CLASSES,
  PRIORITY_BORDER,
  isPriority,
  dueDateClasses,
  todayISO,
  formatDueLabel,
} from "./priority";
export { LABEL_PALETTE, colorForLabel, filterByLabels, listLabelsWithCount, mergeLabels, normalizeLabel, subtractLabels, labelsEqual } from "./labels";
export { TODO_VIEW, TODO_VIEW_MODES, type TodoViewMode } from "./viewModes";

// Re-export the input types host kanban dialogs use to type their
// emit payloads. These mirror what `useTodos` consumes via
// `runtime.dispatch` — kept exported here so dialogs that don't use
// the composable directly still get the same field-level type.
export type { CreateInput as CreateItemInput, PatchInput as PatchItemInput, MoveInput as MoveItemInput } from "./handlers/items";

export interface AddColumnInput {
  label: string;
  isDone?: boolean;
}

export interface PatchColumnInput {
  label?: string;
  isDone?: boolean;
}
