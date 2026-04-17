// JSON file helpers — synchronous (legacy) and async (preferred).
//
// Moved from server/utils/file.ts (issue #366 Phase 1). The old
// file re-exports these for backwards compat.

import fs from "fs";
import path from "path";
import { writeFileAtomic } from "./atomic.js";

// ── Sync (legacy callers — todos, scheduler, columns) ───────────

export function loadJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const parsed: T = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return parsed;
  } catch {
    return defaultValue;
  }
}

export function saveJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ── Async ───────────────────────────────────────────────────────

/**
 * JSON-pretty-print `data` and write atomically.
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  opts: Parameters<typeof writeFileAtomic>[2] = {},
): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2), opts);
}

/**
 * Read a JSON file and parse it. Returns null if the file is missing,
 * unreadable, or malformed.
 */
export async function readJsonOrNull<T>(
  filePath: string,
): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const parsed: T = JSON.parse(content);
    return parsed;
  } catch {
    return null;
  }
}
