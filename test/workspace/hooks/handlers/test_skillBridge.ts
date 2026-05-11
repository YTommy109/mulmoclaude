// Unit tests for the skill-bridge handler. The handler mirrors
// edits + deletes from `data/skills/<slug>.md` into
// `.claude/skills/<slug>/SKILL.md`. We verify the path math and
// the regex gating directly — covering the actual mirror copy
// would require swapping CLAUDE_PROJECT_DIR + writing fixtures
// per-handler, which is more end-to-end than warranted here.
//
// The fancier integration path (Claude CLI spawn → hook fires →
// mirror appears) is exercised manually during the skill-bridge
// PR's verification step (see PR description).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  claudeSkillFilePath,
  dataSkillFilePath,
  handleSkillBridge,
  slugFromDataPath,
  slugFromRmCommand,
} from "../../../../server/workspace/hooks/handlers/skillBridge.js";

function setWorkspace(root: string): void {
  // The handler reads CLAUDE_PROJECT_DIR at call time. Mutating
  // env before each test gives us a clean per-test workspace.
  process.env.CLAUDE_PROJECT_DIR = root;
}

describe("slugFromDataPath", () => {
  it("matches data/skills/<slug>.md and returns the slug", () => {
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/skills/nazonazo.md"), "nazonazo");
    assert.equal(slugFromDataPath("/ws/data/skills/my-skill.md"), "my-skill");
  });

  it("rejects non-staging paths", () => {
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/wiki/foo.md"), null);
    assert.equal(slugFromDataPath("/ws/.claude/skills/foo/SKILL.md"), null);
    assert.equal(slugFromDataPath("/elsewhere/data/skills/foo.md"), null);
  });

  it("rejects nested subdirs under data/skills/", () => {
    // Only direct children are bridged. A typo like
    // `data/skills/foo/bar.md` would otherwise mis-map to slug `bar`.
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/skills/group/foo.md"), null);
  });

  it("rejects invalid slugs", () => {
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/skills/Foo.md"), null, "uppercase rejected");
    assert.equal(slugFromDataPath("/ws/data/skills/foo_bar.md"), null, "underscore rejected");
    assert.equal(slugFromDataPath("/ws/data/skills/-foo.md"), null, "leading hyphen rejected");
    assert.equal(slugFromDataPath("/ws/data/skills/foo--bar.md"), null, "double hyphen rejected");
  });
});

describe("slugFromRmCommand", () => {
  it("matches exact `rm data/skills/<slug>.md`", () => {
    assert.equal(slugFromRmCommand("rm data/skills/nazonazo.md"), "nazonazo");
    assert.equal(slugFromRmCommand("rm -f data/skills/foo.md"), "foo");
    assert.equal(slugFromRmCommand("rm 'data/skills/my-skill.md'"), "my-skill");
  });

  it("rejects wildcards and bulk deletes", () => {
    // Mass deletes via wildcards must NOT be mirrored — one typo
    // could otherwise wipe every skill in .claude/skills/.
    assert.equal(slugFromRmCommand("rm data/skills/*.md"), null);
    assert.equal(slugFromRmCommand("rm -rf data/skills/"), null);
    assert.equal(slugFromRmCommand("rm data/skills/foo.md other.md"), null);
  });

  it("rejects non-rm commands", () => {
    assert.equal(slugFromRmCommand("ls data/skills/"), null);
    assert.equal(slugFromRmCommand("mv data/skills/foo.md data/skills/bar.md"), null);
  });
});

describe("handleSkillBridge — mirror copy", () => {
  it("copies data/skills/<slug>.md to .claude/skills/<slug>/SKILL.md on Write", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-write-"));
    setWorkspace(root);
    await mkdir(path.join(root, "data", "skills"), { recursive: true });
    const content = "---\nname: nazonazo\n---\n\n# Test skill\n";
    await writeFile(dataSkillFilePath("nazonazo"), content, "utf-8");

    await handleSkillBridge({
      tool_name: "Write",
      tool_input: { file_path: dataSkillFilePath("nazonazo") },
    });

    const mirrored = await readFile(claudeSkillFilePath("nazonazo"), "utf-8");
    assert.equal(mirrored, content);

    await rm(root, { recursive: true, force: true });
  });

  it("removes .claude/skills/<slug>/ on a matching Bash rm", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-delete-"));
    setWorkspace(root);
    await mkdir(path.dirname(claudeSkillFilePath("doomed")), { recursive: true });
    await writeFile(claudeSkillFilePath("doomed"), "---\nname: doomed\n---", "utf-8");

    await handleSkillBridge({
      tool_name: "Bash",
      tool_input: { command: "rm data/skills/doomed.md" },
    });

    // Whole `.claude/skills/doomed/` is gone — not just the SKILL.md
    // file. Skills can have sibling assets and we don't want
    // orphans dangling.
    assert.equal(existsSync(path.dirname(claudeSkillFilePath("doomed"))), false);

    await rm(root, { recursive: true, force: true });
  });

  it("ignores writes outside data/skills/", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-noop-"));
    setWorkspace(root);
    await mkdir(path.join(root, "data", "wiki"), { recursive: true });
    await writeFile(path.join(root, "data", "wiki", "page.md"), "wiki content", "utf-8");

    await handleSkillBridge({
      tool_name: "Write",
      tool_input: { file_path: path.join(root, "data", "wiki", "page.md") },
    });

    // Nothing was mirrored into .claude/skills/.
    assert.equal(existsSync(path.join(root, ".claude", "skills")), false);

    await rm(root, { recursive: true, force: true });
  });
});
