// Workspace provisioning for the agent's permission allow-list.
//
// The host GUI has no surface to answer Claude Code's interactive
// permission prompt — events flow as stream-json, not stdin. Without
// pre-approval the agent silently hangs the first time it tries to
// Write/Edit inside `<workspace>/.claude/` (the `.claude/` dir is
// treated more carefully than ordinary cwd subdirs because writing
// there mutates the agent's own skills / hooks / settings).
//
// Fix: provision `<workspace>/.claude/settings.json` at startup with
// `permissions.allow` rules scoped to cwd. The rules use Claude
// Code's `./**` matcher (relative to cwd = workspace), so writes
// inside the workspace are auto-allowed while writes outside still
// prompt — keeping the trust boundary explicit. Docker mode reaches
// the same outcome via its container; this provisioner aligns the
// native fallback so MulmoClaude works the same way regardless of
// sandbox availability.
//
// Idempotent: running provisioning twice produces the same on-disk
// state. User-supplied allow entries are preserved.

import path from "node:path";
import { readTextOrNull } from "../../utils/files/safe.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";

const SETTINGS_REL = path.join(".claude", "settings.json");

// The exact strings we ensure are present in `permissions.allow`.
// `./**` anchors to cwd (the workspace root, since the agent is
// spawned with `cwd: workspacePath`). Adding more rules later is
// just appending strings here; the provisioner dedupes on write.
export const REQUIRED_ALLOW_RULES: readonly string[] = ["Write(./**)", "Edit(./**)"];

interface PermissionsShape {
  allow?: unknown[];
  [key: string]: unknown;
}

interface SettingsShape {
  permissions?: PermissionsShape;
  [key: string]: unknown;
}

export interface ProvisionOptions {
  workspaceRoot?: string;
}

/** Ensure `<workspace>/.claude/settings.json` carries the
 *  workspace-scoped permission allow rules the agent needs. Safe to
 *  call on every startup — adds missing rules, never overwrites
 *  user-supplied entries. Logs a one-line info on the first install
 *  and stays silent on subsequent no-ops. */
export async function provisionAgentPermissions(opts: ProvisionOptions = {}): Promise<void> {
  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  const settingsPath = path.join(root, SETTINGS_REL);

  const changed = await mergePermissionsIntoSettings(settingsPath);
  if (changed) {
    log.info("agent-permissions", "provisioned permission allow-list", {
      settingsPath,
      rules: REQUIRED_ALLOW_RULES,
    });
  }
}

async function mergePermissionsIntoSettings(settingsPath: string): Promise<boolean> {
  const existingRaw = await readTextOrNull(settingsPath);
  const existing: SettingsShape = existingRaw ? safeParse(existingRaw) : {};

  const next = upsertAllowRules(existing);
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
    // Corrupted settings get rebuilt with our entries only.
  }
  return {};
}

// Append every required rule that isn't already in `allow`. Existing
// user-added entries (and entries owned by other provisioners) stay
// in place. Order is preserved to keep diffs readable.
export function upsertAllowRules(settings: SettingsShape): SettingsShape {
  const permissions = settings.permissions ?? {};
  const rawAllow = permissions.allow;
  // Normalise to [] when an unexpected shape sits under `allow`
  // (object, string, etc.). Defensive — `findIndex` would throw
  // otherwise and a single corrupted file would break startup for
  // the whole session.
  const allow: string[] = Array.isArray(rawAllow) ? rawAllow.filter((entry): entry is string => typeof entry === "string") : [];

  const seen = new Set(allow);
  const nextAllow = [...allow];
  for (const rule of REQUIRED_ALLOW_RULES) {
    if (!seen.has(rule)) {
      nextAllow.push(rule);
      seen.add(rule);
    }
  }

  if (nextAllow.length === allow.length) {
    // Every required rule was already present — no change.
    return settings;
  }

  return {
    ...settings,
    permissions: {
      ...permissions,
      allow: nextAllow,
    },
  };
}
