// Unit tests for atomic-to-topic staging migration (#1070 PR-A).
//
// We exercise the orchestrator with a deterministic stub clusterer
// so the test never touches Claude / network.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeMemoryEntry } from "../../../server/workspace/memory/io.js";
import { clusterAtomicIntoStaging, topicStagingPath } from "../../../server/workspace/memory/topic-migrate.js";
import type { MemoryClusterer } from "../../../server/workspace/memory/topic-cluster.js";

const stubClusterer: MemoryClusterer = async () => ({
  preference: [{ topic: "dev", unsectionedBullets: ["uses yarn (npm not allowed)"] }],
  interest: [
    {
      topic: "music",
      sections: [
        { heading: "Rock / Metal", bullets: ["likes Pantera", "Metallica"] },
        { heading: "Punk / Melodic", bullets: ["NOFX, Hi-STANDARD"] },
      ],
    },
  ],
  fact: [{ topic: "travel", unsectionedBullets: ["wants to visit Egypt"] }],
  reference: [],
});

describe("memory/topic-migrate — happy path", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-"));
    // Seed a few atomic entries to migrate from.
    await writeMemoryEntry(workspaceRoot, {
      name: "uses yarn",
      description: "npm not allowed",
      type: "preference",
      body: "uses yarn (npm not allowed)",
      slug: "preference_yarn",
    });
    await writeMemoryEntry(workspaceRoot, {
      name: "Pantera",
      description: "metal",
      type: "interest",
      body: "likes Pantera",
      slug: "interest_pantera",
    });
    await writeMemoryEntry(workspaceRoot, {
      name: "Metallica",
      description: "metal",
      type: "interest",
      body: "Metallica",
      slug: "interest_metallica",
    });
    await writeMemoryEntry(workspaceRoot, {
      name: "NOFX",
      description: "punk",
      type: "interest",
      body: "NOFX, Hi-STANDARD",
      slug: "interest_nofx",
    });
    await writeMemoryEntry(workspaceRoot, {
      name: "Egypt trip",
      description: "wants",
      type: "fact",
      body: "wants to visit Egypt",
      slug: "fact_egypt",
    });
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("writes the cluster output to a staging dir without touching the atomic source", async () => {
    const result = await clusterAtomicIntoStaging(workspaceRoot, stubClusterer);
    assert.equal(result.noop, false);
    assert.equal(result.inputCount, 5);
    assert.equal(result.topicCounts.preference, 1);
    assert.equal(result.topicCounts.interest, 1);
    assert.equal(result.topicCounts.fact, 1);
    assert.equal(result.topicCounts.reference, 0);
    assert.equal(result.bulletsLost, 0);
    assert.equal(result.stagingPath, topicStagingPath(workspaceRoot));

    // The atomic source remains in place — the swap helper is what
    // the user runs after reviewing.
    const atomicStat = await stat(path.join(workspaceRoot, "conversations", "memory", "interest_pantera.md"));
    assert.ok(atomicStat.isFile());

    // Staging holds the new layout.
    const musicPath = path.join(result.stagingPath, "interest", "music.md");
    const musicContent = await readFile(musicPath, "utf-8");
    assert.match(musicContent, /^---\ntype: interest\ntopic: music\n---/);
    assert.match(musicContent, /## Rock \/ Metal/);
    assert.match(musicContent, /## Punk \/ Melodic/);
    assert.match(musicContent, /likes Pantera/);

    // Index reflects the staging.
    const indexContent = await readFile(path.join(result.stagingPath, "MEMORY.md"), "utf-8");
    assert.match(indexContent, /## preference/);
    assert.match(indexContent, /interest\/music\.md — Rock \/ Metal, Punk \/ Melodic/);
    assert.match(indexContent, /fact\/travel\.md/);
  });
});

describe("memory/topic-migrate — edge cases", () => {
  it("returns noop when there are no atomic entries", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-empty-"));
    try {
      const result = await clusterAtomicIntoStaging(fresh, stubClusterer);
      assert.equal(result.noop, true);
      assert.equal(result.inputCount, 0);
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("counts bullets lost when the cluster output is missing entries", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-loss-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      await writeMemoryEntry(fresh, {
        name: "emacs",
        description: "editor",
        type: "preference",
        body: "emacs",
        slug: "preference_emacs",
      });
      const partial: MemoryClusterer = async () => ({
        preference: [{ topic: "dev", unsectionedBullets: ["yarn"] }],
        interest: [],
        fact: [],
        reference: [],
      });
      const result = await clusterAtomicIntoStaging(fresh, partial);
      assert.equal(result.inputCount, 2);
      assert.equal(result.bulletsLost, 1);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("returns a partial result when the clusterer returns null", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-null-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      const nullClusterer: MemoryClusterer = async () => null;
      const result = await clusterAtomicIntoStaging(fresh, nullClusterer);
      assert.equal(result.noop, true);
      assert.equal(result.inputCount, 1);
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
