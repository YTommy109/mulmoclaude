// Atomic-to-topic migration (#1070 PR-A).
//
// Reads the existing #1029-style atomic entries from
// `conversations/memory/`, runs a clusterer, and writes the
// proposed topic layout to a STAGING dir
// `conversations/memory.next/`. Does NOT swap. The user runs
// `topic-swap.ts` after reviewing.
//
// Library only — `runTopicMigrationOnce` (in PR-B) decides when
// to call this from server startup.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../../utils/files/atomic.js";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { loadAllMemoryEntries } from "./io.js";
import { MEMORY_TYPES, type MemoryEntry, type MemoryType } from "./types.js";
import type { ClusterMap, ClusterTopic, MemoryClusterer } from "./topic-cluster.js";

export interface TopicMigrationResult {
  /** Whether anything was emitted to the staging dir. */
  noop: boolean;
  /** Atomic entries that fed the cluster call. */
  inputCount: number;
  /** Topic files written to the staging dir, per type. */
  topicCounts: Record<MemoryType, number>;
  /** Bullets the clusterer omitted (sum across types). */
  bulletsLost: number;
  /** Where the staging dir lives. */
  stagingPath: string;
}

export const STAGING_DIR_NAME = "memory.next";

export function topicStagingPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "conversations", STAGING_DIR_NAME);
}

export async function clusterAtomicIntoStaging(workspaceRoot: string, clusterer: MemoryClusterer): Promise<TopicMigrationResult> {
  const entries = await loadAllMemoryEntries(workspaceRoot);
  const stagingPath = topicStagingPath(workspaceRoot);
  if (entries.length === 0) {
    return emptyResult(stagingPath);
  }
  log.info("memory", "topic-migrate: clustering", { entryCount: entries.length });
  const map = await clusterer(entries);
  if (!map) {
    log.warn("memory", "topic-migrate: clusterer returned null");
    return { ...emptyResult(stagingPath), inputCount: entries.length };
  }

  await resetStaging(stagingPath);
  const result: TopicMigrationResult = {
    noop: false,
    inputCount: entries.length,
    topicCounts: { preference: 0, interest: 0, fact: 0, reference: 0 },
    bulletsLost: countBulletsLost(entries, map),
    stagingPath,
  };
  for (const type of MEMORY_TYPES) {
    for (const topic of map[type]) {
      try {
        await writeTopicFileToStaging(stagingPath, type, topic);
        result.topicCounts[type] += 1;
      } catch (err) {
        log.warn("memory", "topic-migrate: write failed", { type, topic: topic.topic, error: errorMessage(err) });
      }
    }
  }
  await writeStagingIndex(stagingPath, map);
  log.info("memory", "topic-migrate: staging ready", {
    stagingPath,
    topicCounts: result.topicCounts,
    bulletsLost: result.bulletsLost,
  });
  return result;
}

function emptyResult(stagingPath: string): TopicMigrationResult {
  return {
    noop: true,
    inputCount: 0,
    topicCounts: { preference: 0, interest: 0, fact: 0, reference: 0 },
    bulletsLost: 0,
    stagingPath,
  };
}

async function resetStaging(stagingPath: string): Promise<void> {
  // Stale staging from a prior run is wiped — the user's review
  // signal is the diff, so we always emit a fresh tree.
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });
}

async function writeTopicFileToStaging(stagingPath: string, type: MemoryType, topic: ClusterTopic): Promise<void> {
  const dir = path.join(stagingPath, type);
  await mkdir(dir, { recursive: true });
  const absPath = path.join(dir, `${topic.topic}.md`);
  const body = renderTopicBody(topic);
  const content = `---\ntype: ${type}\ntopic: ${topic.topic}\n---\n\n${body}`;
  await writeFileAtomic(absPath, content, { uniqueTmp: true });
}

function renderTopicBody(topic: ClusterTopic): string {
  const heading = humaniseTopic(topic.topic);
  const lines: string[] = [`# ${heading}`, ""];
  if (topic.unsectionedBullets && topic.unsectionedBullets.length > 0) {
    for (const bullet of topic.unsectionedBullets) {
      lines.push(`- ${bullet}`);
    }
    lines.push("");
  }
  if (topic.sections) {
    for (const section of topic.sections) {
      lines.push(`## ${section.heading}`, "");
      for (const bullet of section.bullets) {
        lines.push(`- ${bullet}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function humaniseTopic(slug: string): string {
  // ASCII-friendly humaniser: split on `-`, capitalise each word.
  // Non-ASCII slugs (which fall back to a hash) render as the slug
  // itself; the user can rename later in the file explorer.
  return slug
    .split("-")
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

async function writeStagingIndex(stagingPath: string, map: ClusterMap): Promise<void> {
  const lines: string[] = ["# Memory Index", ""];
  for (const type of MEMORY_TYPES) {
    const topics = map[type];
    if (topics.length === 0) continue;
    lines.push(`## ${type}`, "");
    const sortedTopics = [...topics].sort((left, right) => left.topic.localeCompare(right.topic));
    for (const topic of sortedTopics) {
      lines.push(formatStagingIndexLine(type, topic));
    }
    lines.push("");
  }
  if (Object.values(map).every((list) => list.length === 0)) {
    lines.push("_(no entries yet)_", "");
  }
  await writeFileAtomic(path.join(stagingPath, "MEMORY.md"), lines.join("\n"), { uniqueTmp: true });
}

function formatStagingIndexLine(type: MemoryType, topic: ClusterTopic): string {
  const link = `${type}/${topic.topic}.md`;
  const headings = (topic.sections ?? []).map((section) => section.heading);
  if (headings.length === 0) return `- ${link}`;
  return `- ${link} — ${headings.join(", ")}`;
}

function countBulletsLost(entries: readonly MemoryEntry[], map: ClusterMap): number {
  let placed = 0;
  for (const type of MEMORY_TYPES) {
    for (const topic of map[type]) {
      if (topic.unsectionedBullets) placed += topic.unsectionedBullets.length;
      if (topic.sections) {
        for (const section of topic.sections) {
          placed += section.bullets.length;
        }
      }
    }
  }
  return Math.max(0, entries.length - placed);
}
