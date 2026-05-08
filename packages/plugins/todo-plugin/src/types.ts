// Public types for the todo plugin. Copied from
// `src/plugins/todo/index.ts` (now removed) and
// `server/api/routes/todos.ts` (now removed) on the merge.

export type TodoPriority = "low" | "medium" | "high" | "urgent";

export interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
  completed: boolean;
  createdAt: number;
  // ── Added for the file-explorer kanban view ──
  // status: id of a column from columns.json. Optional on the wire so
  // legacy items load cleanly; migrateItems() backfills it on read.
  status?: string;
  priority?: TodoPriority;
  dueDate?: string; // ISO YYYY-MM-DD
  order?: number; // sort key within the same status column
}

export interface StatusColumn {
  id: string;
  label: string;
  // True for the column whose items are considered "completed".
  // Exactly one column should have isDone: true at any given time;
  // remove_column / patch_column rules enforce this.
  isDone?: boolean;
}

export interface TodoData {
  items: TodoItem[];
  columns?: StatusColumn[];
}
