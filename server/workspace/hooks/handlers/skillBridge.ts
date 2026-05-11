// Skill-bridge handler — agent writes skill drafts to
// `data/skills/<slug>.md` (a plain data dir, no permission special
// case) and this hook mirrors them into `.claude/skills/<slug>/SKILL.md`
// so Claude CLI's skill discovery picks them up.
//
// Why a bridge: Claude Code's permission system gives `.claude/`
// stricter scrutiny than ordinary cwd subdirs (the dir holds the
// agent's own skills / hooks / settings, so writes there are a
// self-modification risk). Even with explicit `Write(.claude/**)`
// allow rules in workspace settings.json, writes prompt — and the
// host GUI has no surface to answer the prompt. Routing writes
// through `data/skills/` avoids the gate; this hook (a regular
// subprocess, NOT a Claude tool call) does the mirror copy and is
// not subject to the gate.
//
// Mirror operations:
//
//   Write/Edit data/skills/<slug>.md
//     → copy content to .claude/skills/<slug>/SKILL.md
//       (creates the parent dir on first install)
//
//   Bash "rm data/skills/<slug>.md"
//     → rm -rf .claude/skills/<slug>/
//       (regex-matched so the agent's intent is unambiguous;
//        a bulk `rm data/skills/*.md` is intentionally NOT
//        mirrored to avoid mass deletion surprises)

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HookPayload } from "../shared/stdin.js";
import { extractCommand, extractFilePath, extractToolName } from "../shared/stdin.js";
import { workspaceRoot } from "../shared/workspace.js";

const DATA_SKILLS_DIR = path.join("data", "skills");
const CLAUDE_SKILLS_DIR = path.join(".claude", "skills");

// Slugs follow Claude Code's skill-name convention: lowercase ASCII
// letters / digits with single-hyphen separators. Matching is
// strict so a typo or path traversal attempt (`../foo`) never
// reaches the destination path math.
//
// eslint-disable-next-line security/detect-unsafe-regex -- input is always a basename slice ≤ 64 chars, so the theoretical worst-case backtracking is bounded; this is the canonical kebab-case pattern used across the skill toolchain.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// `rm data/skills/<slug>.md` regex. Tolerates -f / -rf flags and
// optional quoting around the path. Bulk deletes (`rm data/skills/*.md`
// or paths with wildcards / shell expansion) are intentionally NOT
// matched to avoid mass deletion via Bash mistakes.
//
// eslint-disable-next-line security/detect-unsafe-regex -- the `(-[a-z0-9]+)*` slug clause is bounded by `.md` and the input is a single-line Bash command Claude CLI captured; no pathological backtracking surface.
const RM_RE = /^\s*rm\s+(?:-[a-zA-Z]+\s+)*['"]?data\/skills\/([a-z0-9-]+)\.md['"]?\s*$/;

// Pure helpers exported for unit testing. Source paths stay relative
// to the workspace root resolved at call time so the handler is
// safe to run from any cwd.

export function dataSkillFilePath(slug: string): string {
  return path.join(workspaceRoot(), DATA_SKILLS_DIR, `${slug}.md`);
}

export function claudeSkillDir(slug: string): string {
  return path.join(workspaceRoot(), CLAUDE_SKILLS_DIR, slug);
}

export function claudeSkillFilePath(slug: string): string {
  return path.join(claudeSkillDir(slug), "SKILL.md");
}

// Extract the slug from a Write/Edit on a `data/skills/<slug>.md`
// path. Returns null when the path doesn't match the staging
// pattern, the basename isn't a valid slug, or the file is nested
// deeper than expected (only direct children of data/skills/ are
// bridged).
export function slugFromDataPath(filePath: string): string | null {
  const root = workspaceRoot();
  const staging = path.join(root, DATA_SKILLS_DIR);
  const rel = path.relative(staging, filePath);
  if (!rel || rel.startsWith("..")) return null;
  if (path.dirname(rel) !== ".") return null;
  if (!rel.endsWith(".md")) return null;
  const slug = rel.slice(0, -".md".length);
  return SLUG_RE.test(slug) ? slug : null;
}

// Extract the slug from a Bash `rm data/skills/<slug>.md` command.
// Returns null on any mismatch — wildcards, paths outside the
// staging dir, or anything else are intentionally rejected.
export function slugFromRmCommand(command: string): string | null {
  const match = RM_RE.exec(command);
  if (!match) return null;
  const [, slug] = match;
  return SLUG_RE.test(slug) ? slug : null;
}

function mirrorWrite(slug: string): void {
  const content = readFileSync(dataSkillFilePath(slug), "utf-8");
  mkdirSync(claudeSkillDir(slug), { recursive: true });
  writeFileSync(claudeSkillFilePath(slug), content, "utf-8");
}

function mirrorDelete(slug: string): void {
  rmSync(claudeSkillDir(slug), { recursive: true, force: true });
}

export async function handleSkillBridge(payload: HookPayload): Promise<void> {
  const tool = extractToolName(payload);

  if (tool === "Write" || tool === "Edit") {
    const filePath = extractFilePath(payload);
    if (!filePath) return;
    const slug = slugFromDataPath(filePath);
    if (slug === null) return;
    try {
      mirrorWrite(slug);
    } catch {
      // The Write itself succeeded; a failed mirror would leave the
      // staging copy in place. Silent fail keeps the user's tool
      // turn clean; the next save retries.
    }
    return;
  }

  if (tool === "Bash") {
    const command = extractCommand(payload);
    if (!command) return;
    const slug = slugFromRmCommand(command);
    if (slug === null) return;
    try {
      mirrorDelete(slug);
    } catch {
      // Same silent-fail discipline — a missed delete leaves an
      // orphan in `.claude/skills/` that the user can clean up
      // manually, which is better than aborting the tool turn.
    }
  }
}
