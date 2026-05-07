// Preset skills bundled with mulmoclaude (#1210). Sibling to
// `helps/`: this file owns the boot-time copy from
// `server/workspace/skills-preset/<slug>/SKILL.md` (shipped with the
// launcher tarball) into `<workspaceRoot>/.claude/skills/<slug>/SKILL.md`,
// where Claude Code's slash-command resolver picks them up.
//
// The launcher overwrites preset entries unconditionally on every
// boot — preset skills are "factory defaults", not user state. The
// `mc-` slug prefix is the namespace boundary: anything under
// `mc-*` belongs to the launcher and may be added / overwritten /
// removed across releases. Anything WITHOUT the `mc-` prefix is
// user-owned and never touched.
//
// `syncPresetSkills(...)` is exported as a pure-ish helper (takes
// paths + a logger sink, returns a summary) so tests can drive it
// against tmpdirs without touching a real workspace.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const PRESET_SLUG_PREFIX = "mc-";
const SKILL_FILENAME = "SKILL.md";

export interface SyncPresetSkillsOptions {
  /** Source directory: `<launcher>/server/workspace/skills-preset/`. */
  sourceDir: string;
  /** Destination directory: `<workspaceRoot>/.claude/skills/`. */
  destDir: string;
  /** Logger callbacks — kept injectable so tests don't need to
   *  spin up the structured logger. The boot-side wrapper threads
   *  these through to `log.info` / `log.warn`. */
  onInfo?: (message: string, data?: Record<string, unknown>) => void;
  onWarn?: (message: string, data?: Record<string, unknown>) => void;
}

export interface SyncPresetSkillsResult {
  /** Slugs successfully copied (or refreshed) from source to dest. */
  copied: string[];
  /** Slugs removed from dest because they no longer exist in source.
   *  Bounded to `mc-*` entries — user-authored slugs are never
   *  considered for removal. */
  removed: string[];
  /** Source entries that failed validation (wrong prefix, missing
   *  SKILL.md, etc.) and were skipped. Each entry is human-readable. */
  skipped: string[];
}

/** Validate that a slug starts with the launcher's preset namespace.
 *  Exported for tests; the boot-time guard relies on this. */
export function isPresetSlug(slug: string): boolean {
  return slug.startsWith(PRESET_SLUG_PREFIX) && slug.length > PRESET_SLUG_PREFIX.length;
}

type Verdict = { ok: true } | { ok: false; reason: string };

function classifySourceEntry(sourceDir: string, entry: string): Verdict {
  if (entry.startsWith(".")) return { ok: false, reason: "hidden" };
  const slugDir = path.join(sourceDir, entry);
  let info;
  try {
    info = statSync(slugDir);
  } catch {
    return { ok: false, reason: "stat failed" };
  }
  if (!info.isDirectory()) return { ok: false, reason: "not a directory" };
  if (!isPresetSlug(entry)) return { ok: false, reason: `slug must start with "${PRESET_SLUG_PREFIX}"` };
  if (!existsSync(path.join(slugDir, SKILL_FILENAME))) return { ok: false, reason: `missing ${SKILL_FILENAME}` };
  return { ok: true };
}

function copyOneSource(sourceDir: string, destDir: string, entry: string): void {
  const destSlugDir = path.join(destDir, entry);
  mkdirSync(destSlugDir, { recursive: true });
  copyFileSync(path.join(sourceDir, entry, SKILL_FILENAME), path.join(destSlugDir, SKILL_FILENAME));
}

function copySourcesIntoDest(sourceDir: string, destDir: string, opts: SyncPresetSkillsOptions, result: SyncPresetSkillsResult): Set<string> {
  const synced = new Set<string>();
  for (const entry of readdirSync(sourceDir)) {
    const verdict = classifySourceEntry(sourceDir, entry);
    if (!verdict.ok) {
      // "hidden" / "not a directory" / "stat failed" are silent
      // structural skips. Slug-rule violations and missing SKILL.md
      // are real misconfigurations that the dev needs to see.
      const isMisconfiguration = verdict.reason.startsWith("slug") || verdict.reason.startsWith("missing");
      if (isMisconfiguration) {
        result.skipped.push(`${entry}: ${verdict.reason}`);
        opts.onWarn?.("preset entry skipped", { slug: entry, reason: verdict.reason });
      }
      continue;
    }
    copyOneSource(sourceDir, destDir, entry);
    synced.add(entry);
    result.copied.push(entry);
  }
  return synced;
}

function removeRetiredPresets(destDir: string, synced: ReadonlySet<string>, opts: SyncPresetSkillsOptions, result: SyncPresetSkillsResult): void {
  for (const entry of readdirSync(destDir)) {
    if (!isPresetSlug(entry)) continue;
    if (synced.has(entry)) continue;
    const stalePath = path.join(destDir, entry);
    try {
      if (!statSync(stalePath).isDirectory()) continue;
    } catch {
      continue;
    }
    rmSync(stalePath, { recursive: true, force: true });
    result.removed.push(entry);
    opts.onInfo?.("removed retired preset skill", { slug: entry });
  }
}

/** Copy every preset slug from `sourceDir` into `destDir`, then
 *  remove any `mc-*` entries in `destDir` that no longer have a
 *  source. Slugs without the `mc-` prefix are skipped (with a warn)
 *  on the source side and left untouched on the dest side — that's
 *  how user-authored skills coexist with launcher-managed presets. */
export function syncPresetSkills(opts: SyncPresetSkillsOptions): SyncPresetSkillsResult {
  const result: SyncPresetSkillsResult = { copied: [], removed: [], skipped: [] };
  if (!existsSync(opts.sourceDir)) {
    // No preset directory in the launcher tarball — nothing to do.
    // This is the legitimate "no presets shipped yet" state.
    return result;
  }
  mkdirSync(opts.destDir, { recursive: true });
  const synced = copySourcesIntoDest(opts.sourceDir, opts.destDir, opts, result);
  removeRetiredPresets(opts.destDir, synced, opts, result);
  if (result.copied.length > 0 || result.removed.length > 0) {
    opts.onInfo?.("preset skills synced", {
      copied: result.copied.length,
      removed: result.removed.length,
      skipped: result.skipped.length,
    });
  }
  return result;
}
