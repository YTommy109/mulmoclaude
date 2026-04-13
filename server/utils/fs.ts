// Filesystem helpers shared across the server. Most are safe wrappers
// around fs/fsp calls that swallow ENOENT/EACCES so the caller can do
// `if (result === null)` instead of try/catch boilerplate.
//
// `resolveWithinRoot` is the realpath-based path-traversal check that
// underpins every endpoint serving files out of the workspace. Use it
// any time a relative path comes from an HTTP body or query string.

import fs from "fs";
import path from "path";

export function statSafe(absPath: string): fs.Stats | null {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
}

// Async counterpart of `statSafe` for callers that want to stay off
// the synchronous I/O path (e.g. tree-walk endpoints that would
// otherwise block the event loop for the whole workspace).
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

// Async counterpart of `readDirSafe`. Same "swallow ENOENT/EACCES,
// return empty" contract.
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

// Resolve a relative path against a root, ensuring the result stays
// inside the root after symlink resolution. Returns null on traversal
// or if either path doesn't exist on disk.
//
// Defeats symlink-based escapes — `path.resolve` + `startsWith` alone
// is insufficient because a symlink inside the root could point at
// `/etc/passwd` and still pass the prefix check.
//
// `rootReal` MUST already be a realpath. Callers that have a
// long-lived root (e.g. the workspace) typically realpath it once at
// module load and pass the cached value here.
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
