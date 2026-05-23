// Read / write item files for schema-driven apps. Records live at
// `<dataDir>/<itemId>.json`, one JSON object per file. Writes are
// atomic; deletes are idempotent enough to expose a clear 404 when
// the file is missing.

import { mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { log } from "../../system/logger/index.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { isContainedInWorkspace, itemFilePath, safeSlugName } from "./paths.js";
import type { AppItem } from "./types.js";

/** Read every record under `dataDir`. Returns [] if the dir doesn't
 *  exist yet (legitimate first-use state). Malformed JSON files are
 *  logged and skipped so one bad record can't take down the listing.
 *  Re-validates the realpath containment to defend against a symlink
 *  appearing between discovery and use. */
export async function listItems(dataDir: string): Promise<AppItem[]> {
  if (!isContainedInWorkspace(dataDir)) {
    log.warn("apps", "listItems refused: dataDir escapes workspace via symlink", { dataDir });
    return [];
  }
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    throw err;
  }
  const results: AppItem[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    if (name.startsWith(".")) continue;
    const filePath = path.join(dataDir, name);
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        results.push(parsed as AppItem);
      }
    } catch (err) {
      log.warn("apps", "failed to read item, skipping", { path: filePath, error: String(err) });
    }
  }
  return results;
}

/** Read one record by id. Returns null when the file is missing or
 *  when the resolved path escapes the workspace via a symlink. */
export async function readItem(dataDir: string, itemId: string): Promise<AppItem | null> {
  const safeId = safeSlugName(itemId);
  if (safeId === null) return null;
  if (!isContainedInWorkspace(dataDir)) return null;
  const filePath = itemFilePath(dataDir, safeId);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AppItem;
    }
    return null;
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return null;
    throw err;
  }
}

export interface WriteItemOptions {
  /** When true (POST/create), refuse to overwrite an existing file
   *  and return `kind: "conflict"`. Update flow (PUT) leaves it false. */
  refuseOverwrite?: boolean;
}

export type WriteItemResult =
  | { kind: "ok"; itemId: string; item: AppItem }
  | { kind: "invalid-id"; itemId: string }
  | { kind: "conflict"; itemId: string }
  | { kind: "path-escape"; itemId: string };

/** Write a record. Ensures the directory exists, validates the id,
 *  re-checks symlink containment after mkdir, and writes atomically.
 *
 *  Create path (`refuseOverwrite: true`) uses an O_EXCL `wx` open
 *  rather than `stat` + `writeFileAtomic` to close a check-then-write
 *  race: two concurrent POSTs would otherwise both pass the existence
 *  check and one would silently overwrite the other. The trade-off
 *  is that the create path is not crash-atomic (a partial file could
 *  remain if the process dies mid-write); acceptable here because
 *  records are small JSON blobs and the next read either parses or
 *  is skipped via the "malformed JSON" branch in `listItems`.
 *
 *  Update path (`refuseOverwrite: false`) uses `writeFileAtomic` so
 *  PUT remains crash-atomic. No race there — the URL pins the id. */
export async function writeItem(dataDir: string, itemId: string, item: AppItem, opts: WriteItemOptions = {}): Promise<WriteItemResult> {
  const safeId = safeSlugName(itemId);
  if (safeId === null) return { kind: "invalid-id", itemId };
  await mkdir(dataDir, { recursive: true });
  if (!isContainedInWorkspace(dataDir)) {
    log.warn("apps", "writeItem refused: dataDir escapes workspace via symlink", { dataDir, itemId: safeId });
    return { kind: "path-escape", itemId: safeId };
  }
  const filePath = itemFilePath(dataDir, safeId);
  const payload = `${JSON.stringify(item, null, 2)}\n`;

  if (opts.refuseOverwrite) {
    let handle;
    try {
      handle = await open(filePath, "wx");
    } catch (err) {
      const error = err as { code?: string };
      if (error.code === "EEXIST") return { kind: "conflict", itemId: safeId };
      throw err;
    }
    try {
      await handle.writeFile(payload);
    } finally {
      await handle.close();
    }
    return { kind: "ok", itemId: safeId, item };
  }

  await writeFileAtomic(filePath, payload);
  return { kind: "ok", itemId: safeId, item };
}

export type DeleteItemResult =
  | { kind: "ok"; itemId: string }
  | { kind: "invalid-id"; itemId: string }
  | { kind: "not-found"; itemId: string }
  | { kind: "path-escape"; itemId: string };

export async function deleteItem(dataDir: string, itemId: string): Promise<DeleteItemResult> {
  const safeId = safeSlugName(itemId);
  if (safeId === null) return { kind: "invalid-id", itemId };
  if (!isContainedInWorkspace(dataDir)) {
    log.warn("apps", "deleteItem refused: dataDir escapes workspace via symlink", { dataDir, itemId: safeId });
    return { kind: "path-escape", itemId: safeId };
  }
  const filePath = itemFilePath(dataDir, safeId);
  try {
    await unlink(filePath);
    return { kind: "ok", itemId: safeId };
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return { kind: "not-found", itemId: safeId };
    throw err;
  }
}

/** Generate a short random hex id. Used by POST when the form doesn't
 *  carry a primary-key value (UI shortcut — Claude normally derives a
 *  semantic id from the record's name). */
export function generateItemId(): string {
  return randomBytes(4).toString("hex");
}
