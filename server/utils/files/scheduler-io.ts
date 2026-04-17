// Domain I/O: scheduler items
//   data/scheduler/items.json
//
// Sync API. Optional `root` for test DI.

import { WORKSPACE_FILES } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { resolvePath, isEnoent } from "./workspace-io.js";
import { writeFileAtomicSync } from "./atomic.js";
import { log } from "../../system/logger/index.js";
import fs from "fs";

const root = (r?: string) => r ?? workspacePath;

export function loadSchedulerItems<T>(fallback: T, r?: string): T {
  const p = resolvePath(root(r), WORKSPACE_FILES.schedulerItems);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch (err) {
    if (isEnoent(err)) return fallback;
    log.error("scheduler-io", "failed to read items, using fallback", {
      path: p,
      error: String(err),
    });
    return fallback;
  }
}

export function saveSchedulerItems(items: unknown, r?: string): void {
  writeFileAtomicSync(
    resolvePath(root(r), WORKSPACE_FILES.schedulerItems),
    JSON.stringify(items, null, 2),
  );
}
