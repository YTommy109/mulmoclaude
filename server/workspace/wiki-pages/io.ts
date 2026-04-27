// Single choke point for `data/wiki/pages/<slug>.md` writes.
//
// Every wiki page write — manageWiki MCP tool, the user editing
// through the file content endpoint, the wiki-backlinks driver
// appending session links — funnels through `writeWikiPage`.
// Centralising here gives:
//
//   - one atomic-write guarantee (was: wiki-backlinks bypassed it)
//   - one place to record edit history (#763 PR 2 — currently a
//     no-op stub; this PR only consolidates the writes)
//   - editor identity captured at the call site (LLM / user /
//     system) where it is actually known. A generic `writeFileAtomic`
//     hook can't tell who originated the edit.
//
// PR 1 scope (this commit): consolidation only, behaviour unchanged.
// PR 2 will fill in `appendSnapshot` with real history pipeline.
//
// `appendSnapshot` is a no-op stub on purpose — keeping the call
// site wired up means PR 2 is purely an internal change.

import path from "node:path";
import { readTextSafe } from "../../utils/files/safe.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { WORKSPACE_DIRS } from "../paths.js";

export type WikiPageEditor = "llm" | "user" | "system";

export interface WikiWriteMeta {
  editor: WikiPageEditor;
  /** Chat session that triggered the edit. Optional — not all
   *  callers know one (e.g. user save through the file editor). */
  sessionId?: string;
  /** Free-form short reason. LLM-supplied or user-supplied. */
  reason?: string;
}

export interface WikiPageWriteOptions {
  /** Override the workspace root for tests. Defaults to the
   *  process's resolved workspace (`workspace.ts`). */
  workspaceRoot?: string;
}

/** Reject slugs that would escape `data/wiki/pages/` once joined.
 *  The chokepoint must defend itself against careless callers — a
 *  raw `path.join(root, dir, '${slug}.md')` happily resolves
 *  `../../etc/passwd` outside the wiki tree. Today's three callers
 *  derive slugs from `path.basename(...)` so they're already safe;
 *  this guard keeps that property even if a future caller forgets. */
function isSafeSlug(slug: string): boolean {
  if (slug.length === 0) return false;
  // Empty / dot-only / starts-with-dot would either resolve to the
  // pages dir itself, hide the file (`.foo.md`), or risk collisions
  // with VCS / OS metadata. Reject as a class.
  if (slug.startsWith(".")) return false;
  // Any path separator (forward slash, backslash on Windows, or the
  // literal `..` segment) means the slug spans directories — not
  // allowed at the page-write layer.
  if (slug.includes("/") || slug.includes("\\")) return false;
  if (slug.includes("\0")) return false;
  return true;
}

/** Absolute path for a slug. Throws on slugs that would escape
 *  `data/wiki/pages/`. Does not check existence. */
export function wikiPagePath(slug: string, opts: WikiPageWriteOptions = {}): string {
  if (!isSafeSlug(slug)) {
    throw new Error(`wiki-pages: refusing unsafe slug ${JSON.stringify(slug)}`);
  }
  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  return path.join(root, WORKSPACE_DIRS.wikiPages, `${slug}.md`);
}

/** Read a wiki page; null if missing. Used internally to capture
 *  the pre-write content for snapshotting (PR 2). Exposed because
 *  some callers want the same null-safe reader. */
export async function readWikiPage(slug: string, opts: WikiPageWriteOptions = {}): Promise<string | null> {
  return readTextSafe(wikiPagePath(slug, opts));
}

/** Write a wiki page atomically and forward (old, new) to the
 *  snapshot pipeline. The snapshot call is currently a no-op stub
 *  (#763 PR 2). `uniqueTmp: true` matches what the generic
 *  `/api/files/content` PUT used pre-consolidation — without it
 *  two simultaneous writes to the same page collide on the shared
 *  `.tmp` staging file (the file-content PUT and the wiki-backlinks
 *  driver are independent and may target the same page in the same
 *  millisecond). */
export async function writeWikiPage(slug: string, content: string, meta: WikiWriteMeta, opts: WikiPageWriteOptions = {}): Promise<void> {
  const absPath = wikiPagePath(slug, opts);
  const oldContent = await readTextSafe(absPath);
  await writeFileAtomic(absPath, content, { uniqueTmp: true });
  if (oldContent !== content) {
    await appendSnapshot(slug, oldContent, content, meta);
  }
}

/** Routing helper for the generic `/api/files/content` PUT.
 *  Returns `{ wiki: true, slug }` when `absPath` resolves directly
 *  under `data/wiki/pages/` AND ends in `.md`. Anything outside
 *  that exact shape (index.md, sources/, non-md, nested subdirs,
 *  paths that escape pagesDir via `..`) is `{ wiki: false }` and
 *  should fall back to the generic atomic write.
 *
 *  This function is **pure path-string math** — it does no symlink
 *  resolution. Callers MUST pass an already-realpath'd `absPath`
 *  AND an already-realpath'd `workspaceRoot` (or rely on the
 *  default, which mirrors `defaultWorkspacePath`). Mixing one
 *  realpath'd side with a symlinked other side is the trap that
 *  caused #883 review-iter-1 — a symlinked workspace would have
 *  silently routed wiki writes through the generic writer. */
export function classifyAsWikiPage(absPath: string, opts: WikiPageWriteOptions = {}): { wiki: true; slug: string } | { wiki: false } {
  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  const pagesDir = path.join(root, WORKSPACE_DIRS.wikiPages);
  // `path.relative` returns "" for equal paths and a "../"-prefixed
  // string for outside-root paths. Anything starting with ".." (or
  // absolute on Windows after a drive change) is rejected.
  const rel = path.relative(pagesDir, absPath);
  if (rel.length === 0) return { wiki: false };
  if (rel.startsWith("..") || path.isAbsolute(rel)) return { wiki: false };
  // The file must live directly in `pages/`, not in a subdirectory
  // (no nested wiki layout today). Reject anything with a separator.
  if (rel.includes(path.sep)) return { wiki: false };
  if (!rel.endsWith(".md")) return { wiki: false };
  return { wiki: true, slug: rel.slice(0, -".md".length) };
}

// ── Internal: snapshot stub ────────────────────────────────────
//
// Filled in by #763 PR 2. Kept here as a no-op so the call site is
// already wired up and PR 2 is a pure internal change.
//
// Signature note: takes both old and new content so the snapshot
// store can emit a diff or store the prior version directly. Meta
// carries editor identity / session / reason so the snapshot can
// be attributed.

async function appendSnapshot(__slug: string, __oldContent: string | null, __newContent: string, __meta: WikiWriteMeta): Promise<void> {
  // Intentionally empty — PR 2 (#763) replaces this with the
  // actual snapshot pipeline. The wiring is in place so PR 2 is
  // purely an internal change.
}
