// Config-refresh handler — fires after Write/Edit on files that
// drive workspace state the parent server hot-reloads:
//
//   <ws>/.claude/skills/<slug>/SKILL.md
//   <ws>/config/scheduler/tasks.json
//   <ws>/data/skills/<slug>.md         (the skill-bridge staging path)
//
// POSTs /api/config/refresh so the change activates without a server
// restart. Migrated from `server/workspace/config-refresh/hook.mjs`.

import { buildAuthPost, safePost } from "../shared/sidecar.js";
import type { HookPayload } from "../shared/stdin.js";
import { extractFilePath, extractToolName } from "../shared/stdin.js";

// Each pattern is matched against the absolute path the CLI
// delivered. Windows path separators are tolerated for cross-
// platform robustness even though the host is currently darwin /
// linux only.
const PATTERNS = [
  /[\\/]\.claude[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/,
  /[\\/]config[\\/]scheduler[\\/]tasks\.json$/,
  // Skill-bridge staging path. Refreshing on Write/Edit to the
  // staging SKILL.md lets `mc-manage-skills` see new / updated
  // skills without restarting the server; the skillBridge handler
  // takes care of the actual copy to `.claude/skills/<slug>/`.
  /[\\/]data[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/,
];

export async function handleConfigRefresh(payload: HookPayload): Promise<void> {
  const tool = extractToolName(payload);
  if (tool !== "Write" && tool !== "Edit") return;

  const filePath = extractFilePath(payload);
  if (!filePath) return;
  if (!PATTERNS.some((pattern) => pattern.test(filePath))) return;

  const req = buildAuthPost("/api/config/refresh");
  await safePost(req);
}
