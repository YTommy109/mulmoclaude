// Workspace provisioning for the unified PostToolUse dispatcher.
//
// At server startup:
//
//   1. Copy the bundled dispatcher script into
//      <workspace>/.claude/hooks/mulmoclaude-dispatcher.mjs.
//   2. Ensure <workspace>/.claude/settings.json has exactly ONE
//      PostToolUse entry owned by MulmoClaude — the dispatcher.
//      Legacy per-handler entries (wikiHistory, configRefresh) are
//      detected by their owner markers and removed in the same pass
//      so existing workspaces upgrade cleanly.
//
// Why one entry: the dispatcher fans out to every handler in
// `handlers/`. Adding a new behaviour only requires dropping a new
// file there and registering it in `dispatcher.ts` — settings.json
// stays stable. Pre-unification each handler shipped its own
// settings.json entry, so introducing one was three files of code
// for what should be a one-liner.
//
// Idempotent: running provisioning twice produces the same on-disk
// state. User-supplied keys and hooks owned by other software
// (different `*: true` markers) are preserved untouched.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTextOrNull } from "../../utils/files/safe.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";

// The esbuild bundle is the source of truth for the dispatcher
// script written into <workspace>/.claude/hooks/. Source TS is
// `dispatcher.ts`; `yarn build:hooks` (chained from `yarn build`)
// regenerates `dispatcher.mjs`, and CI fails when the committed
// bundle drifts from the source. The read happens inside
// `provisionDispatcherHook` (not at module load) so a missing /
// unreadable bundle degrades to a logged warning without breaking
// server startup.
const DISPATCHER_BUNDLE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "dispatcher.mjs");

function readDispatcherBundle(): string | null {
  try {
    return readFileSync(DISPATCHER_BUNDLE_PATH, "utf-8");
  } catch (err) {
    log.warn("hooks", "dispatcher bundle unreadable, skipping provisioning", {
      bundlePath: DISPATCHER_BUNDLE_PATH,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const SETTINGS_REL = path.join(".claude", "settings.json");
const HOOK_SCRIPT_REL = path.join(".claude", "hooks", "mulmoclaude-dispatcher.mjs");
// Forward-slash form for the shell command — settings.json is read
// by Claude CLI, and the command is interpreted by a POSIX shell.
// `CLAUDE_PROJECT_DIR` expands correctly in both host and Docker
// container contexts; a host-absolute path would silently fail when
// bind-mounted into Docker.
const HOOK_SCRIPT_REL_POSIX = ".claude/hooks/mulmoclaude-dispatcher.mjs";
const HOOK_COMMAND = `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT_REL_POSIX}"`;

// Current owner marker — the property name on the hook descriptor
// that identifies this entry as ours. Exported for tests.
export const OWNER_MARKER = "mulmoclaudeDispatcher";

// Legacy markers from pre-unification provisioners. Entries carrying
// any of these are dropped on migration so the dispatcher replaces
// them without manual cleanup. KEEP IN SYNC with old provisioners
// being deleted as part of this refactor.
const LEGACY_MARKERS: readonly string[] = ["mulmoclaudeWikiHistory", "mulmoclaudeConfigRefresh"];

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

/** Ensure the dispatcher script + its settings.json entry are up to
 *  date. Safe to call on every startup. Logs once on first install
 *  or whenever the on-disk state changes. */
export async function provisionDispatcherHook(opts: ProvisionOptions = {}): Promise<void> {
  const bundle = readDispatcherBundle();
  if (bundle === null) return;

  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  const scriptPath = path.join(root, HOOK_SCRIPT_REL);
  const settingsPath = path.join(root, SETTINGS_REL);

  await writeDispatcherScript(scriptPath, bundle);
  const changed = await mergeDispatcherIntoSettings(settingsPath);
  if (changed) {
    log.info("hooks", "provisioned PostToolUse dispatcher", { settingsPath, scriptPath });
  }
}

async function writeDispatcherScript(absPath: string, bundle: string): Promise<void> {
  // Always overwrite — the esbuild bundle on disk is the source of
  // truth, and rewriting on every startup means a mulmoclaude
  // update propagates without per-workspace migration. mode 0o700
  // is fine; the hook is executed via `node "..."` so the executable
  // bit isn't strictly needed, but matching the historical
  // wiki-snapshot.mjs perms avoids permission surprises if a user
  // ever runs the script directly.
  await writeFileAtomic(absPath, bundle, { mode: 0o700 });
}

async function mergeDispatcherIntoSettings(settingsPath: string): Promise<boolean> {
  const existingRaw = await readTextOrNull(settingsPath);
  const existing: SettingsShape = existingRaw ? safeParse(existingRaw) : {};

  const next = upsertDispatcherEntry(existing);
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
    // Corrupted settings get rebuilt with our entry only.
  }
  return {};
}

// Pure helper exported for unit testing. Apply the desired
// dispatcher entry, strip every legacy-marker entry, and return the
// new settings object. Existing user-owned entries (under matchers
// like `Bash` or with no owner marker) are preserved.
export function upsertDispatcherEntry(settings: SettingsShape): SettingsShape {
  const hooks = settings.hooks ?? {};
  const rawPostToolUse = hooks.PostToolUse;
  const postToolUse = Array.isArray(rawPostToolUse) ? rawPostToolUse : [];

  // Drop any legacy MulmoClaude-owned entries — they are subsumed
  // by the dispatcher and would otherwise double-fire.
  const filtered = postToolUse.filter((entry) => !entryHasLegacyMarker(entry) && !entryHasOwnedMarker(entry));

  const desiredEntry: HookMatcher = {
    // Bash matcher is required so the skill-bridge delete branch
    // gets a chance to run. Write|Edit covers wiki-snapshot,
    // config-refresh, and skill-bridge write paths.
    matcher: "Write|Edit|Bash",
    hooks: [
      {
        type: "command",
        command: HOOK_COMMAND,
        [OWNER_MARKER]: true,
      },
    ],
  };

  return {
    ...settings,
    hooks: {
      ...hooks,
      PostToolUse: [...filtered, desiredEntry],
    },
  };
}

function entryHasOwnedMarker(entry: HookMatcher): boolean {
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook) => hook[OWNER_MARKER] === true);
}

function entryHasLegacyMarker(entry: HookMatcher): boolean {
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook) => LEGACY_MARKERS.some((marker) => hook[marker] === true));
}
