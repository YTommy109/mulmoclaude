// Workspace provisioning for the `mc-settings` skill's auto-refresh
// hook (#1283). On every server start: copy the hook script into
// `<workspaceRoot>/.claude/hooks/config-refresh.mjs` and ensure
// `<workspaceRoot>/.claude/settings.json` has a `PostToolUse` entry
// that runs it. Idempotent — repeated calls produce the same on-disk
// state; user-owned hooks under the same matcher are preserved
// (identified by a `mulmoclaudeConfigRefresh: true` owner marker on
// the descriptor).
//
// Modelled on `server/workspace/wiki-history/provision.ts` — the
// settings.json merge logic is functionally identical with a
// different owner marker + script path. The two provisioners
// install independent entries under the same `PostToolUse` matcher.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTextOrNull } from "../../utils/files/safe.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";

// The hook source lives next to this file. We read it at provisioning
// time (not at module load) so a missing / unreadable script degrades
// to a logged warning without breaking server startup — provisioning
// is best-effort.
const HOOK_SOURCE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "hook.mjs");

function readHookSource(): string | null {
  try {
    return readFileSync(HOOK_SOURCE_PATH, "utf-8");
  } catch (err) {
    log.warn("config-refresh", "hook source unreadable, skipping provisioning", {
      sourcePath: HOOK_SOURCE_PATH,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const SETTINGS_REL = path.join(".claude", "settings.json");
const HOOK_SCRIPT_REL = path.join(".claude", "hooks", "config-refresh.mjs");
// Forward-slash form for the shell command — settings.json is read
// by Claude CLI, and the command is interpreted by a POSIX shell
// (macOS / Linux / inside the Docker container). `CLAUDE_PROJECT_DIR`
// expands correctly in both contexts; a host-absolute path would
// silently fail when bind-mounted into Docker.
const HOOK_SCRIPT_REL_POSIX = ".claude/hooks/config-refresh.mjs";
const HOOK_COMMAND = `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT_REL_POSIX}"`;
const OWNER_MARKER = "mulmoclaudeConfigRefresh";

interface HookCommandEntry {
  type: "command";
  command: string;
  [key: string]: unknown;
}

interface HookMatcher {
  matcher?: string;
  hooks?: HookCommandEntry[];
  [key: string]: unknown;
}

interface SettingsShape {
  hooks?: {
    PostToolUse?: HookMatcher[];
    [key: string]: HookMatcher[] | undefined;
  };
  [key: string]: unknown;
}

export interface ProvisionOptions {
  workspaceRoot?: string;
}

/** Ensure the hook script + `.claude/settings.json` are up to date.
 *  Safe to call on every startup. Logs a one-line info on first
 *  install, debug-only on subsequent no-op runs. Skips quietly (with
 *  a warning) when the hook source can't be read. */
export async function provisionConfigRefreshHook(opts: ProvisionOptions = {}): Promise<void> {
  const source = readHookSource();
  if (source === null) return;

  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  const scriptPath = path.join(root, HOOK_SCRIPT_REL);
  const settingsPath = path.join(root, SETTINGS_REL);

  await writeHookScript(scriptPath, source);
  const changed = await mergeHookIntoSettings(settingsPath);
  if (changed) {
    log.info("config-refresh", "provisioned auto-refresh hook", { settingsPath, scriptPath });
  }
}

async function writeHookScript(absPath: string, source: string): Promise<void> {
  // Always overwrite — the in-repo `hook.mjs` is the source of truth
  // and rewriting on every startup propagates updates without a
  // per-workspace migration.
  await writeFileAtomic(absPath, source, { mode: 0o700 });
}

async function mergeHookIntoSettings(settingsPath: string): Promise<boolean> {
  const existingRaw = await readTextOrNull(settingsPath);
  const existing: SettingsShape = existingRaw ? safeParse(existingRaw) : {};

  const desiredHook: HookCommandEntry = {
    type: "command",
    command: HOOK_COMMAND,
    [OWNER_MARKER]: true,
  };

  const next = upsertOurHook(existing, desiredHook);
  const nextRaw = `${JSON.stringify(next, null, 2)}\n`;
  if (existingRaw === nextRaw) return false;

  await writeFileAtomic(settingsPath, nextRaw);
  return true;
}

function safeParse(raw: string): SettingsShape {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SettingsShape;
    }
  } catch {
    // Fall through — corrupted settings get rebuilt with our entry only.
  }
  return {};
}

/** Cast `hooks.PostToolUse` defensively to a `HookMatcher[]`. An
 *  unexpected shape (object, string, etc.) under that key — possible
 *  when the file was hand-edited or written by another tool — becomes
 *  `[]` so the caller can splice without throwing. Exported for tests
 *  (the cast is the easy-to-regress part). */
export function normalisePostToolUse(raw: unknown): HookMatcher[] {
  return Array.isArray(raw) ? (raw as HookMatcher[]) : [];
}

/** Replace the existing owned entry, or append the desired one if
 *  no owned entry is present. Pure — returns a new array. */
export function mergePostToolUse(postToolUse: readonly HookMatcher[], desiredEntry: HookMatcher): HookMatcher[] {
  const ownedIndex = postToolUse.findIndex((entry) => entryHasOwnedHook(entry));
  const next = [...postToolUse];
  if (ownedIndex === -1) next.push(desiredEntry);
  else next[ownedIndex] = desiredEntry;
  return next;
}

function upsertOurHook(settings: SettingsShape, desiredHook: HookCommandEntry): SettingsShape {
  const hooks = settings.hooks ?? {};
  const postToolUse = normalisePostToolUse(hooks.PostToolUse);
  const desiredEntry: HookMatcher = { matcher: "Write|Edit", hooks: [desiredHook] };
  const nextPostToolUse = mergePostToolUse(postToolUse, desiredEntry);
  return { ...settings, hooks: { ...hooks, PostToolUse: nextPostToolUse } };
}

/** Robust against hand-edited / non-conformant `PostToolUse` items:
 *  null, primitive, or object-without-`hooks-array` all return false
 *  rather than throwing on property access (CodeRabbit review on
 *  PR #1284). */
function entryHasOwnedHook(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const { hooks } = entry as HookMatcher;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((hook) => hook !== null && typeof hook === "object" && (hook as Record<string, unknown>)[OWNER_MARKER] === true);
}
