// One-shot topic-based migration entry point used by server startup
// (#1070 PR-B). Mirrors `runMemoryMigrationOnce` from #1029 PR-B
// but targets the topic-format restructure instead of the legacy
// memory.md flow.
//
// Idempotent: returns immediately when there is nothing to do —
// the workspace is already topic-format, staging is already present
// (so the user is mid-review), or there are no atomic entries to
// migrate. Failures from the clusterer are logged and swallowed so
// the server can continue serving traffic.
//
// Concurrency: cluster runs in the background while the agent
// continues serving requests. Atomic-format reads / writes stay in
// effect until the user runs the swap helper.

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { runClaudeCli, ClaudeCliNotFoundError, type Summarize } from "../journal/archivist-cli.js";
import { loadAllMemoryEntries } from "./io.js";
import { makeLlmMemoryClusterer } from "./topic-cluster.js";
import { clusterAtomicIntoStaging, topicStagingPath } from "./topic-migrate.js";
import { hasTopicFormat } from "./topic-detect.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

export interface RunTopicMigrationDeps {
  /** Override the summarize callback (useful for tests). Defaults to
   *  the production `runClaudeCli` which spawns the Claude CLI. */
  summarize?: Summarize;
}

export async function runTopicMigrationOnce(workspaceRoot: string, deps: RunTopicMigrationDeps = {}): Promise<void> {
  if (hasTopicFormat(workspaceRoot)) {
    log.debug("memory", "topic-run: workspace already uses topic format, skipping");
    return;
  }
  const stagingPath = topicStagingPath(workspaceRoot);
  if (existsSync(stagingPath)) {
    log.info("memory", "topic-run: staging already present (review pending), skipping", { stagingPath });
    return;
  }
  // Don't trip over an in-progress legacy `memory.md` migration from
  // #1029 PR-B. Once that finishes the legacy file is renamed to
  // `.backup` and the atomic entries below the memory dir become
  // visible to `loadAllMemoryEntries`.
  const legacyPath = path.join(workspaceRoot, "conversations", "memory.md");
  if (existsSync(legacyPath)) {
    const stat = statSync(legacyPath);
    if (stat.size >= 64) {
      log.debug("memory", "topic-run: legacy memory.md still in flight, deferring", { legacyPath });
      return;
    }
  }
  const entries = await loadAllMemoryEntries(workspaceRoot);
  if (entries.length === 0) {
    log.debug("memory", "topic-run: no atomic entries to migrate, skipping");
    return;
  }
  const summarize = deps.summarize ?? runClaudeCli;
  const clusterer = makeLlmMemoryClusterer({ summarize });
  log.info("memory", "topic-run: starting", { entryCount: entries.length });
  try {
    const result = await clusterAtomicIntoStaging(workspaceRoot, clusterer);
    log.info("memory", "topic-run: staging ready — review with `diff -r conversations/memory conversations/memory.next` then run `yarn memory:swap`", {
      stagingPath: result.stagingPath,
      topicCounts: result.topicCounts,
      bulletsLost: result.bulletsLost,
    });
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) {
      log.warn("memory", "topic-run: claude CLI not on PATH; topic restructure deferred");
      return;
    }
    log.error("memory", "topic-run: threw", { error: errorMessage(err) });
  }
}
