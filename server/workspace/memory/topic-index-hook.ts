// Auto-regenerate `conversations/memory/MEMORY.md` whenever a topic
// file is written via an app route (#1032).
//
// Wired into `publishFileChange` — the single chokepoint every
// route hits after a successful write. When the changed path looks
// like a topic file, this kicks off `regenerateTopicIndex` async
// so the index stays in sync with the bullets the user just edited
// in the file explorer.
//
// Limitation: the agent's raw `Write` tool bypasses app routes, so
// agent-driven edits do NOT trigger this hook. The prompt context
// re-reads disk every turn (`loadAllTopicFilesSync`), so the agent
// itself stays fresh; only the on-disk `MEMORY.md` lags between
// agent writes. Acceptable today — revisit if a periodic refresh
// proves needed.

import { workspacePath } from "../workspace.js";
import { regenerateTopicIndex } from "./topic-io.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { MEMORY_TYPES } from "./types.js";

const TOPIC_PATH_PREFIXES: readonly string[] = MEMORY_TYPES.map((type) => `conversations/memory/${type}/`);

// Returns true iff the relative path points at a file inside one of
// the four topic-format type subdirs. Files at the memory root
// itself (e.g. `conversations/memory/MEMORY.md`, the index this
// helper writes) are excluded so we don't recurse.
//
// Path is expected POSIX-normalised (the caller in `file-change.ts`
// already does this). Defensive: anything we can't classify as
// topic-format is rejected.
export function isTopicFilePath(relativePath: string): boolean {
  if (!relativePath.endsWith(".md")) return false;
  if (relativePath.includes("/.atomic-backup/")) return false;
  if (relativePath.includes("/.archived/")) return false;
  for (const prefix of TOPIC_PATH_PREFIXES) {
    if (relativePath.startsWith(prefix)) {
      // Reject files that live in deeper subdirectories of the type
      // dir (e.g. `interest/foo/bar.md`) — the layout is flat.
      const tail = relativePath.slice(prefix.length);
      if (!tail.includes("/")) return true;
    }
  }
  return false;
}

// Fire-and-forget index regeneration for a workspace-relative path.
// Callers should `void`-call this from inside `publishFileChange`
// — the work happens off the request thread and any failure logs
// rather than throwing.
export async function maybeRegenerateTopicIndex(relativePath: string): Promise<void> {
  if (!isTopicFilePath(relativePath)) return;
  try {
    await regenerateTopicIndex(workspacePath);
    log.debug("memory", "topic-index-hook: regenerated", { trigger: relativePath });
  } catch (err) {
    log.warn("memory", "topic-index-hook: regenerate failed", {
      trigger: relativePath,
      error: errorMessage(err),
    });
  }
}
