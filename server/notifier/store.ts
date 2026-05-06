// Low-level file I/O for the notifier. Kept separate from `engine.ts`
// so unit tests can override the file path without monkey-patching
// `WORKSPACE_PATHS`.

import { promises as fsPromises } from "fs";
import { writeFileAtomic } from "../utils/files/atomic.js";
import type { NotifierFile, NotifierHistoryFile } from "./types.js";

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

/** Read the active-entries file. Returns an empty store when the file
 *  doesn't exist yet (first ever call on a fresh workspace). Any other
 *  read or parse failure throws — the caller has to decide whether to
 *  surface or recover, since silently treating "malformed file" as
 *  "no entries" would lose data. */
export async function loadActive(filePath: string): Promise<NotifierFile> {
  let text: string;
  try {
    text = await fsPromises.readFile(filePath, "utf-8");
  } catch (err) {
    if (isNotFoundError(err)) return { entries: {} };
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("entries" in parsed) || typeof (parsed as { entries: unknown }).entries !== "object") {
    throw new Error(`notifier: malformed active.json at ${filePath}`);
  }
  return parsed as NotifierFile;
}

/** Write the active-entries file via `writeFileAtomic` so a half-
 *  written file is never visible to readers. The caller serialises
 *  writes (engine.ts queues mutations) — this function makes no
 *  concurrency guarantees of its own. */
export async function saveActive(filePath: string, state: NotifierFile): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(state, null, 2));
}

/** Read the history file. Empty array on first run. Same parse-error
 *  policy as `loadActive`. */
export async function loadHistory(filePath: string): Promise<NotifierHistoryFile> {
  let text: string;
  try {
    text = await fsPromises.readFile(filePath, "utf-8");
  } catch (err) {
    if (isNotFoundError(err)) return { entries: [] };
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("entries" in parsed) || !Array.isArray((parsed as { entries: unknown }).entries)) {
    throw new Error(`notifier: malformed history.json at ${filePath}`);
  }
  return parsed as NotifierHistoryFile;
}

export async function saveHistory(filePath: string, state: NotifierHistoryFile): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(state, null, 2));
}
