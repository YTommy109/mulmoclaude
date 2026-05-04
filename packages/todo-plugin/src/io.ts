// Persistence layer — reads/writes todos.json + columns.json under
// the plugin's runtime.files.data scope root.
//
// The data shape mirrors what `server/utils/files/todos-io.ts` (now
// removed) wrote: a JSON-serialised `TodoItem[]` and `StatusColumn[]`.
// Existing-user data is moved into this scope by
// `scripts/migrate-todos-to-plugin.ts`.

import type { FileOps } from "gui-chat-protocol";
import type { TodoItem, StatusColumn } from "./types";
import { DEFAULT_COLUMNS, normalizeColumns } from "./handlers/columns";
import { migrateItems } from "./handlers/items";

const TODOS_FILE = "todos.json";
const COLUMNS_FILE = "columns.json";

async function readJson<T>(files: FileOps, rel: string, fallback: T): Promise<T> {
  if (!(await files.exists(rel))) return fallback;
  try {
    return JSON.parse(await files.read(rel)) as T;
  } catch {
    return fallback;
  }
}

export async function loadColumns(files: FileOps): Promise<StatusColumn[]> {
  const raw = await readJson<unknown>(files, COLUMNS_FILE, DEFAULT_COLUMNS);
  return normalizeColumns(raw);
}

export async function saveColumns(files: FileOps, columns: StatusColumn[]): Promise<void> {
  await files.write(COLUMNS_FILE, JSON.stringify(columns, null, 2));
}

export async function loadTodos(files: FileOps): Promise<TodoItem[]> {
  const raw = await readJson<TodoItem[]>(files, TODOS_FILE, []);
  const columns = await loadColumns(files);
  return migrateItems(raw, columns);
}

export async function saveTodos(files: FileOps, items: TodoItem[]): Promise<void> {
  await files.write(TODOS_FILE, JSON.stringify(items, null, 2));
}
