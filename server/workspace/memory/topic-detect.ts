// Format detection for the memory storage layer (#1070 PR-B).
//
// Two layouts can live at `<workspaceRoot>/conversations/memory/`:
//
//   atomic (#1029): flat `<type>_<slug>.md` files at the memory
//     dir root, one fact per file.
//   topic (#1070):  `<type>/<topic>.md` under per-type subdirs,
//     one topic per file.
//
// Detection signal: the topic format is active iff at least one of
// the canonical type subdirs (`preference/`, `interest/`, `fact/`,
// `reference/`) exists as a directory under
// `conversations/memory/`. The check is cheap (one stat per type)
// and reflects on-disk truth, so a manual swap immediately changes
// behavior on the next request — no module-level cache.

import { statSync } from "node:fs";
import path from "node:path";

import { MEMORY_TYPES } from "./types.js";

export function hasTopicFormat(workspaceRoot: string): boolean {
  const memoryRoot = path.join(workspaceRoot, "conversations", "memory");
  for (const type of MEMORY_TYPES) {
    const candidate = path.join(memoryRoot, type);
    try {
      const stat = statSync(candidate);
      if (stat.isDirectory()) return true;
    } catch {
      // ENOENT / EACCES → keep looking. A missing or unreadable
      // type subdir doesn't disqualify the workspace; only the
      // presence of one promotes the format to topic.
    }
  }
  return false;
}
