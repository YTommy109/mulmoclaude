import { Router, Request, Response } from "express";
import path from "path";
import { workspacePath } from "../workspace.js";
import { loadJsonFile, saveJsonFile } from "../utils/file.js";
import { dispatchTodos, type TodosActionInput } from "./todosHandlers.js";
import {
  respondWithDispatchResult,
  type DispatchSuccessResponse,
  type DispatchErrorResponse,
} from "./dispatchResponse.js";

const router = Router();

export interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];
  completed: boolean;
  createdAt: number;
}

const todosFile = () => path.join(workspacePath, "todos", "todos.json");

function loadTodos(): TodoItem[] {
  return loadJsonFile<TodoItem[]>(todosFile(), []);
}

function saveTodos(items: TodoItem[]): void {
  saveJsonFile(todosFile(), items);
}

router.get(
  "/todos",
  (_req: Request, res: Response<{ data: { items: TodoItem[] } }>) => {
    res.json({ data: { items: loadTodos() } });
  },
);

interface TodoBody extends TodosActionInput {
  action: string;
}

// Actions whose handlers may mutate state. "show" / "list_labels"
// are read-only views; persisting their result would be a no-op.
const READ_ONLY_ACTIONS = new Set(["show", "list_labels"]);

router.post(
  "/todos",
  (
    req: Request<object, unknown, TodoBody>,
    res: Response<DispatchSuccessResponse<TodoItem> | DispatchErrorResponse>,
  ) => {
    const { action, ...input } = req.body;
    const items = loadTodos();
    const result = dispatchTodos(action, items, input);
    respondWithDispatchResult(res, result, {
      shouldPersist: !READ_ONLY_ACTIONS.has(action),
      instructions: "Display the updated todo list to the user.",
      persist: saveTodos,
    });
  },
);

export default router;
