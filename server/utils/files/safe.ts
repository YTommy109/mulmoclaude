// Safe filesystem wrappers that swallow ENOENT / EACCES so callers
// can do `if (result === null)` instead of try/catch boilerplate.
//
// `resolveWithinRoot` is the realpath-based path-traversal check
// that underpins every endpoint serving files out of the workspace.
//
// Moved from server/utils/fs.ts (issue #366 Phase 1). The old
// file re-exports these for backwards compat.

import fs from "fs";
import path from "path";

export function statSafe(absPath: string): fs.Stats | null {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
}

export async function statSafeAsync(absPath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(absPath);
  } catch {
    return null;
  }
}

export function readDirSafe(absPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readDirSafeAsync(absPath: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function readTextOrNull(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Resolve a relative path against a root, ensuring the result stays
 * inside the root after symlink resolution. Returns null on traversal
 * or if either path doesn't exist on disk.
 *
 * `rootReal` MUST already be a realpath.
 */
export function resolveWithinRoot(
  rootReal: string,
  relPath: string,
): string | null {
  const normalized = path.normalize(relPath || "");
  const resolved = path.resolve(rootReal, normalized);
  let resolvedReal: string;
  try {
    resolvedReal = fs.realpathSync(resolved);
  } catch {
    return null;
  }
  if (
    resolvedReal !== rootReal &&
    !resolvedReal.startsWith(rootReal + path.sep)
  ) {
    return null;
  }
  return resolvedReal;
}
