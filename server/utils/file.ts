import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

// ── Sync helpers (existing public API) ───────────────────────────────
//
// Retained for callers that already use them. New code should prefer
// the async atomic variants below.

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

// ── Atomic write helpers ─────────────────────────────────────────────
//
// Atomic write = write to a sibling temp file, then rename. rename(2)
// is atomic on POSIX; Node's Windows implementation falls back to
// copy+unlink which is still safer than truncating the target in
// place. Readers always see either the old file or the new file —
// never a half-written one.
//
// Before these helpers existed, the same pattern was inlined in at
// least 6 places (journal/state.ts, sources/registry.ts,
// sources/sourceState.ts, sources/pipeline/write.ts, skills/writer.ts,
// chat-index/indexer.ts). Each had its own tmp path convention and
// error-handling subtlety; consolidating here makes the pattern
// testable once and uniform everywhere.

export interface WriteAtomicOptions {
  /** File mode for the final file (e.g. `0o600` for secrets). */
  mode?: number;
  /**
   * If true, append a randomUUID to the tmp filename to avoid
   * collisions at the OS level when multiple writers target the same
   * final path concurrently (e.g. chat-index has this concern).
   * Default false — a single `${path}.tmp` is fine for most callers.
   */
  uniqueTmp?: boolean;
}

/**
 * Write `content` to `filePath` atomically. The parent directory is
 * created if missing. The tmp file is cleaned up on failure so a
 * crashed partial write can't wedge the next try.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  opts: WriteAtomicOptions = {},
): Promise<void> {
  const tmp = opts.uniqueTmp
    ? `${filePath}.${randomUUID()}.tmp`
    : `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.writeFile(tmp, content, {
      encoding: "utf-8",
      mode: opts.mode,
    });
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup. If rename succeeded but something later
    // failed (unlikely in this code path), the unlink is a no-op.
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Convenience: JSON-pretty-print `data` and write atomically. See
 * `writeFileAtomic` for the durability contract.
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  opts: WriteAtomicOptions = {},
): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2), opts);
}

/**
 * Read a JSON file and parse it. Returns null if the file is missing,
 * unreadable, or malformed. No throws — callers decide how to react
 * to "no state yet" vs "last write was interrupted".
 *
 * `res.json()` and this helper both rely on `any` being assignable to
 * the generic T without a cast.
 */
export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const parsed: T = JSON.parse(content);
    return parsed;
  } catch {
    return null;
  }
}
