// Unit tests for `hasTopicFormat`. Pins the swap-window fix
// (#1076 review): the detector must return true while
// `swapStagingIntoMemory` has renamed `memory/` out of the way and
// is about to rename `memory.next/` into place. Without that, a
// request that hits the gap falls back to atomic-format writes
// inside the soon-to-be topic tree, and later topic-mode reads
// silently ignore the new file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { hasTopicFormat } from "../../../server/workspace/memory/topic-detect.js";

describe("memory/topic-detect — hasTopicFormat", () => {
  it("returns false on a fresh workspace with no memory tree at all", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-empty-"));
    try {
      assert.equal(hasTopicFormat(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns false when only the legacy `memory.md` is present (atomic format)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-atomic-"));
    try {
      await mkdir(path.join(root, "conversations", "memory"), { recursive: true });
      assert.equal(hasTopicFormat(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns true when a type subdir exists under `memory/` (post-swap)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-post-swap-"));
    try {
      await mkdir(path.join(root, "conversations", "memory", "interest"), { recursive: true });
      assert.equal(hasTopicFormat(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns true when only `memory.next/<type>` exists — covers the swap-in-progress window", async () => {
    // Reproduces the gap inside swapStagingIntoMemory:
    //   1. rename memory/ → memory.<ts>.backup  (memory/ now ABSENT)
    //   2. <— hasTopicFormat must still return true here
    //   3. rename memory.next/ → memory/
    // Note: `memory/` MUST NOT exist for this case to trigger; an
    // empty live `memory/` is the staging-in-progress case below.
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-swap-window-"));
    try {
      await mkdir(path.join(root, "conversations", "memory.next", "preference"), { recursive: true });
      assert.equal(hasTopicFormat(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns true when both `memory/<type>` and `memory.next/<type>` exist (mid-swap, before the dest rename)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-both-"));
    try {
      await mkdir(path.join(root, "conversations", "memory", "interest"), { recursive: true });
      await mkdir(path.join(root, "conversations", "memory.next", "interest"), { recursive: true });
      assert.equal(hasTopicFormat(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns FALSE when memory/ is still atomic and memory.next/<type>/ is being staged (#1087 review)", async () => {
    // Bug Codex flagged on #1086: during normal startup migration,
    // clusterAtomicIntoStaging fills memory.next/<type>/ for a long
    // window before swap completes. If hasTopicFormat returned true
    // off `memory.next` alone, prompt routing would flip to topic
    // mode and atomic + legacy memory would silently disappear from
    // the prompt. Live `memory/` still existing — even with no
    // type subdirs — must keep us in atomic mode.
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-staging-"));
    try {
      await mkdir(path.join(root, "conversations", "memory"), { recursive: true });
      await mkdir(path.join(root, "conversations", "memory.next", "interest"), { recursive: true });
      assert.equal(hasTopicFormat(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
