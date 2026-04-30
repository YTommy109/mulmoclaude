// Memory storage IO (#1029 PR-A).
//
// Read all entries, write a single entry, regenerate the index file.
// Reader is forgiving: a corrupt frontmatter on one entry logs and
// is skipped, the rest still load. Writer is atomic.
//
// `MEMORY.md` is rebuilt from the live frontmatters whenever
// `regenerateIndex` is called — so every write that changes name /
// description / type should be followed by a regenerate. The legacy
// `memory.md` is intentionally NOT touched here; migration handles it.

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { parseFrontmatter, serializeWithFrontmatter } from "../../utils/markdown/frontmatter.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { readDirSafeAsync, readTextSafe, statSafeAsync } from "../../utils/files/safe.js";
import { log } from "../../system/logger/index.js";
import { isMemoryType, type MemoryEntry, type MemoryType } from "./types.js";

// On-disk directory and index file for typed memory entries.
// Callers pass the workspace root; this returns the absolute paths.
export function memoryDirOf(workspaceRoot: string): string {
  return path.join(workspaceRoot, "conversations", "memory");
}

export function memoryIndexOf(workspaceRoot: string): string {
  return path.join(memoryDirOf(workspaceRoot), "MEMORY.md");
}

// Load every entry from `<workspaceRoot>/conversations/memory/`. The
// index file (`MEMORY.md`) and any sub-directory (e.g. future
// `archived/` from #1033) are skipped. Files that fail frontmatter
// parsing or carry an unknown `type` are logged and excluded.
export async function loadAllMemoryEntries(workspaceRoot: string): Promise<MemoryEntry[]> {
  const dir = memoryDirOf(workspaceRoot);
  const filenames = await listEntryFiles(dir);
  const loaded: MemoryEntry[] = [];
  for (const filename of filenames) {
    const parsed = await readMemoryFile(path.join(dir, filename));
    if (parsed) loaded.push(parsed);
  }
  return loaded;
}

// Persist a single entry. Filename is `<slug>.md`. Returns the
// workspace-relative path that was written so callers can log /
// reference the destination. Slugs are validated against
// `isSafeMemorySlug` — `..` segments, separators, dotfiles, and
// reserved filenames are rejected so a caller-supplied slug cannot
// escape the memory directory or collide with `MEMORY.md`. PR-B
// will surface this same check at the agent-write boundary.
export async function writeMemoryEntry(workspaceRoot: string, entry: MemoryEntry): Promise<string> {
  if (!isSafeMemorySlug(entry.slug)) {
    throw new Error(`refusing to write memory entry with unsafe slug: ${JSON.stringify(entry.slug)}`);
  }
  const dir = memoryDirOf(workspaceRoot);
  await mkdir(dir, { recursive: true });
  const filename = `${entry.slug}.md`;
  const absPath = path.join(dir, filename);
  const content = serializeWithFrontmatter({ name: entry.name, description: entry.description, type: entry.type }, entry.body);
  await writeFileAtomic(absPath, content, { uniqueTmp: true });
  return path.posix.join("conversations", "memory", filename);
}

// Slug shape gate. Allows arbitrary unicode (so non-ASCII names slug
// fine via `slugifyMemoryName`'s hash fallback) but rejects anything
// that would let a caller escape the memory directory or shadow
// reserved filenames.
export function isSafeMemorySlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length === 0) return false;
  if (slug.length > 200) return false;
  if (slug.includes("/") || slug.includes("\\")) return false;
  if (slug.includes("\0")) return false;
  // `.`, `..`, leading `.` (dotfiles), or a literal `MEMORY` would
  // each conflict with how the reader scans the directory.
  if (slug.startsWith(".")) return false;
  if (slug === "MEMORY") return false;
  return true;
}

// Rebuild `MEMORY.md` from current entry frontmatters. Sorted by type
// (preference / interest / fact / reference order) then by name so
// the index reads consistently. Empty memory directory writes a
// placeholder index (still useful as the marker that the new layout
// is in effect).
export async function regenerateIndex(workspaceRoot: string): Promise<void> {
  const dir = memoryDirOf(workspaceRoot);
  await mkdir(dir, { recursive: true });
  const all = await loadAllMemoryEntries(workspaceRoot);
  const sorted = [...all].sort(compareEntries);
  const lines: string[] = ["# Memory", ""];
  for (const entry of sorted) {
    lines.push(`- [${entry.name}](${entry.slug}.md) — ${entry.description}`);
  }
  if (sorted.length === 0) lines.push("_(no entries yet)_");
  lines.push("");
  await writeFileAtomic(memoryIndexOf(workspaceRoot), lines.join("\n"), { uniqueTmp: true });
}

const TYPE_ORDER: readonly MemoryType[] = ["preference", "interest", "fact", "reference"];

function typeOrderKey(type: MemoryType): number {
  const idx = TYPE_ORDER.indexOf(type);
  return idx < 0 ? TYPE_ORDER.length : idx;
}

function compareEntries(left: MemoryEntry, right: MemoryEntry): number {
  const typeDelta = typeOrderKey(left.type) - typeOrderKey(right.type);
  if (typeDelta !== 0) return typeDelta;
  return left.name.localeCompare(right.name);
}

async function listEntryFiles(dir: string): Promise<string[]> {
  // Missing memory dir → treat as empty. `readDirSafeAsync` already
  // returns `[]` on ENOENT, so no explicit branch needed.
  const dirents = await readDirSafeAsync(dir);
  const out: string[] = [];
  for (const dirent of dirents) {
    const { name } = dirent;
    if (name === "MEMORY.md") continue;
    if (!name.endsWith(".md")) continue;
    if (name.startsWith(".")) continue;
    if (!dirent.isFile()) {
      // Symlinks / non-regular entries: stat to resolve, skip on
      // failure or non-file. A corrupt entry should not poison the
      // read path.
      const stat = await statSafeAsync(path.join(dir, name));
      if (!stat?.isFile()) continue;
    }
    out.push(name);
  }
  return out.sort();
}

async function readMemoryFile(absPath: string): Promise<MemoryEntry | null> {
  const raw = await readTextSafe(absPath);
  if (raw === null) {
    log.warn("memory", "failed to read entry", { path: absPath });
    return null;
  }
  const parsed = parseFrontmatter(raw);
  if (!parsed.hasHeader) {
    log.warn("memory", "entry missing frontmatter", { path: absPath });
    return null;
  }
  const name = stringField(parsed.meta.name);
  const description = stringField(parsed.meta.description);
  const { type } = parsed.meta;
  if (!name || !description || !isMemoryType(type)) {
    log.warn("memory", "entry frontmatter incomplete", { path: absPath });
    return null;
  }
  const slug = path.basename(absPath, ".md");
  return { name, description, type, body: parsed.body, slug };
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
