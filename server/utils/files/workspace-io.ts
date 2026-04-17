// Workspace-aware file I/O — the single place implementation code
// should reach for when reading/writing files under ~/mulmoclaude/.
//
// Combines WORKSPACE_PATHS (path resolution) with the atomic/safe
// helpers (I/O primitives) so call sites never need raw `path.join`
// + raw `fs.*` for workspace files.
//
// All writes go through writeFileAtomic so concurrent readers always
// see a consistent file — never a half-written one.
//
// All reads swallow ENOENT and return null / fallback so callers can
// do `if (!content)` instead of try/catch.

import fs from "fs";
import path from "path";
import { workspacePath } from "../../workspace/paths.js";
import { writeFileAtomic, writeFileAtomicSync } from "./atomic.js";

// ── Path resolution ─────────────────────────────────────────────

/**
 * Resolve a workspace-relative path to an absolute path.
 * Use this instead of `path.join(workspacePath, rel)` in
 * implementation code — keeps the workspace root reference in
 * one place.
 */
export function resolveWorkspacePath(relPath: string): string {
  return path.join(workspacePath, relPath);
}

// ── Read ────────────────────────────────────────────────────────

/**
 * Read a text file under the workspace. Returns null if the file
 * doesn't exist or is unreadable. Never throws.
 */
export async function readWorkspaceText(
  relPath: string,
): Promise<string | null> {
  try {
    return await fs.promises.readFile(
      resolveWorkspacePath(relPath),
      "utf-8",
    );
  } catch {
    return null;
  }
}

/** Sync variant for startup / config paths that must complete
 *  before the next line executes. */
export function readWorkspaceTextSync(relPath: string): string | null {
  try {
    return fs.readFileSync(resolveWorkspacePath(relPath), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read and parse a JSON file under the workspace. Returns
 * `fallback` if the file is missing, unreadable, or malformed.
 */
export async function readWorkspaceJson<T>(
  relPath: string,
  fallback: T,
): Promise<T> {
  const text = await readWorkspaceText(relPath);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Sync variant of `readWorkspaceJson`. */
export function readWorkspaceJsonSync<T>(
  relPath: string,
  fallback: T,
): T {
  const text = readWorkspaceTextSync(relPath);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ── Write ───────────────────────────────────────────────────────

/**
 * Write a text file under the workspace atomically.
 * Parent directories are created if missing.
 */
export async function writeWorkspaceText(
  relPath: string,
  content: string,
  opts?: { mode?: number },
): Promise<void> {
  await writeFileAtomic(resolveWorkspacePath(relPath), content, opts);
}

/** Sync variant for startup / init paths. */
export function writeWorkspaceTextSync(
  relPath: string,
  content: string,
  opts?: { mode?: number },
): void {
  writeFileAtomicSync(resolveWorkspacePath(relPath), content, opts);
}

/**
 * Write a JSON value under the workspace atomically.
 * Pretty-printed with 2-space indent.
 */
export async function writeWorkspaceJson(
  relPath: string,
  data: unknown,
  opts?: { mode?: number },
): Promise<void> {
  await writeFileAtomic(
    resolveWorkspacePath(relPath),
    JSON.stringify(data, null, 2),
    opts,
  );
}

// ── Existence ───────────────────────────────────────────────────

/**
 * Check whether a workspace-relative path exists on disk.
 * Never throws.
 */
export function existsInWorkspace(relPath: string): boolean {
  try {
    fs.statSync(resolveWorkspacePath(relPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a workspace-relative directory exists. Creates it
 * (including parents) if missing. Idempotent.
 */
export function ensureWorkspaceDir(relPath: string): void {
  fs.mkdirSync(resolveWorkspacePath(relPath), { recursive: true });
}
