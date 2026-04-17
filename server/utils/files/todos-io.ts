// Domain I/O: todo items + status columns
//   data/todos/todos.json     — items
//   data/todos/columns.json   — status columns
//
// Sync API. Optional `root` for test DI.

import { WORKSPACE_FILES } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { resolvePath, isEnoent } from "./workspace-io.js";
import { writeFileAtomicSync } from "./atomic.js";
import { log } from "../../system/logger/index.js";
import fs from "fs";

const root = (r?: string) => r ?? workspacePath;

function readJsonOrFallback<T>(absPath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf-8")) as T;
  } catch (err) {
    if (isEnoent(err)) return fallback;
    log.error("todos-io", "failed to read JSON, using fallback", {
      path: absPath,
      error: String(err),
    });
    return fallback;
  }
}

export function loadTodos<T>(fallback: T, r?: string): T {
  return readJsonOrFallback(
    resolvePath(root(r), WORKSPACE_FILES.todosItems),
    fallback,
  );
}

export function saveTodos(items: unknown, r?: string): void {
  writeFileAtomicSync(
    resolvePath(root(r), WORKSPACE_FILES.todosItems),
    JSON.stringify(items, null, 2),
  );
}

export function loadColumns<T>(fallback: T, r?: string): T {
  return readJsonOrFallback(
    resolvePath(root(r), WORKSPACE_FILES.todosColumns),
    fallback,
  );
}

export function saveColumns(columns: unknown, r?: string): void {
  writeFileAtomicSync(
    resolvePath(root(r), WORKSPACE_FILES.todosColumns),
    JSON.stringify(columns, null, 2),
  );
}
