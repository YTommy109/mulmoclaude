// Shared wiki-page slug logic — pure functions reused by:
//
//   - server/workspace/wiki-pages/io.ts (the write chokepoint)
//   - server/workspace/wiki-history/hook/snapshot.ts (the
//     PostToolUse hook script that detects LLM Write/Edit on a
//     wiki page and triggers a snapshot)
//
// Both call sites need the same answer: "given this absolute
// path and the pages directory, is it a wiki page, and if so
// what slug?". Before the extraction the hook re-implemented
// the rules as a JS-as-string template literal that drifted
// from the server-side logic — see #951's discussion of how to
// stop copying #lint logic between hook and server.
//
// Only `node:path` is allowed here so esbuild can bundle this
// file into the hook script (no Node-specific server-side
// imports leak into the bundle).

import path from "node:path";

/** Reject slugs that would escape `data/wiki/pages/` once
 *  joined back into a path, or that are otherwise invalid as
 *  page filenames. The chokepoint must defend itself even when
 *  callers derive the slug from a trusted source — a typo or
 *  future caller mistake should fail loud, not silently write
 *  outside the wiki tree.
 *
 *  The rule is intentionally narrow — separators / `..` / NUL /
 *  empty — so it only rejects unambiguous violations. Aesthetic
 *  concerns (e.g. dot-prefixed filenames) are out of scope: a
 *  pre-existing `data/wiki/pages/.foo.md` should remain writable
 *  through the chokepoint (codex review iter-2 #883). */
export function isSafeSlug(slug: string): boolean {
  if (slug.length === 0) return false;
  if (slug === "." || slug === "..") return false;
  if (slug.includes("/") || slug.includes("\\")) return false;
  if (slug.includes("\0")) return false;
  return true;
}

/** Given an absolute path and the absolute `pagesDir`, return the
 *  slug if `absPath` is a direct `.md` child of `pagesDir`, else
 *  null. Pure path-string math — no fs IO, no symlink resolution.
 *
 *  Caller responsibility: pass already-realpath'd values for both
 *  arguments. Mixing a realpath'd `absPath` with a symlinked
 *  `pagesDir` (or vice versa) silently mismatches because
 *  `path.relative` is plain string arithmetic. The trap caused
 *  #883 review-iter-1 — a symlinked workspace silently routed
 *  wiki writes through the generic writer. */
export function wikiSlugFromAbsPath(absPath: string, pagesDir: string): string | null {
  const rel = path.relative(pagesDir, absPath);
  if (rel.length === 0) return null;
  if (path.isAbsolute(rel)) return null;
  // Direct child only — no nested layout today. Any separator
  // means the path either escapes (`../secret.md`) or descends
  // (`subdir/foo.md`). A literal page name like `..foo.md` is a
  // single segment without a separator and is allowed (codex
  // iter-3 #883 — the prior `startsWith("..")` rule wrongly
  // rejected it).
  if (rel.includes(path.sep)) return null;
  if (!rel.endsWith(".md")) return null;
  const slug = rel.slice(0, -".md".length);
  if (!isSafeSlug(slug)) return null;
  return slug;
}
