// Synthesize a ToolResultComplete<TodoData> from raw todos.json
// content so FilesView can render it with the TodoExplorer.
// Extracted from FilesView.vue (#507 step 8).

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { StatusColumn, TodoData, TodoItem } from "@mulmoclaude/todo-plugin/shared";
import { WORKSPACE_FILES } from "../../config/workspacePaths";
import { isRecord } from "../types";

// `WORKSPACE_FILES.todosItems` lives under
// `data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json` — the
// directory name is the URL-encoded npm package (#1145). When the
// path round-trips through Vue Router (deep-link via the URL bar),
// the encoded segment gets decoded once to `@mulmoclaude/todo-plugin`,
// so a strict equality check against the literal constant misses
// that case. Compare against both encoded and decoded forms so the
// comparison works for both router-decoded deep links and
// tree-click flows that preserve the encoded literal.
const TODOS_ITEMS_PATHS: ReadonlySet<string> = new Set([WORKSPACE_FILES.todosItems, decodeURIComponent(WORKSPACE_FILES.todosItems)]);

function isTodoItem(value: unknown): value is TodoItem {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || typeof value["text"] !== "string") return false;
  if (typeof value["completed"] !== "boolean") return false;
  if (typeof value["createdAt"] !== "number") return false;
  return true;
}

function isTodoItemArray(value: unknown): value is TodoItem[] {
  return Array.isArray(value) && value.every(isTodoItem);
}

export function toTodoExplorerResult(selectedPath: string | null, rawText: string | null): ToolResultComplete<TodoData> | null {
  if (selectedPath === null || !TODOS_ITEMS_PATHS.has(selectedPath)) return null;
  if (rawText === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  const items: TodoItem[] = isTodoItemArray(parsed) ? parsed : [];
  const columns: StatusColumn[] = [];
  return {
    uuid: "files-todo-preview",
    toolName: "manageTodoList",
    message: WORKSPACE_FILES.todosItems,
    title: "Todo",
    data: { items, columns },
  };
}
