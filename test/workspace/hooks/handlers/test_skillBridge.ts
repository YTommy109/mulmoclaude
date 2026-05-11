// Unit tests for the skill-bridge handler. The handler mirrors
// edits + deletes from `data/skills/<slug>/SKILL.md` into
// `.claude/skills/<slug>/SKILL.md`. We verify the path math and
// the regex gating directly, plus a smoke test of the mirror
// copy / delete against a real tmp workspace.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  claudeSkillFilePath,
  dataSkillDir,
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
  it("matches data/skills/<slug>/SKILL.md and returns the slug", () => {
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/skills/nazonazo/SKILL.md"), "nazonazo");
    assert.equal(slugFromDataPath("/ws/data/skills/my-skill/SKILL.md"), "my-skill");
  });

  it("rejects non-staging paths", () => {
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/wiki/foo.md"), null);
    assert.equal(slugFromDataPath("/ws/.claude/skills/foo/SKILL.md"), null);
    assert.equal(slugFromDataPath("/elsewhere/data/skills/foo/SKILL.md"), null);
  });

  it("rejects sibling files in the staging skill dir", () => {
    // Only SKILL.md crosses over — assets and notes stay
    // staging-side. The agent writing `data/skills/foo/README.md`
    // by mistake should be a no-op, not a mis-mirror.
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/skills/foo/README.md"), null);
    assert.equal(slugFromDataPath("/ws/data/skills/foo/assets/img.png"), null);
  });

  it("rejects flat <slug>.md (the old layout)", () => {
    // Earlier draft used `data/skills/<slug>.md`. The agent's
    // natural skill shape is nested-with-SKILL.md, so the flat
    // form is no longer recognised. Document the change here so
    // a partial revert can't silently re-introduce it.
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/skills/foo.md"), null);
  });

  it("rejects invalid slugs", () => {
    setWorkspace("/ws");
    assert.equal(slugFromDataPath("/ws/data/skills/Foo/SKILL.md"), null, "uppercase rejected");
    assert.equal(slugFromDataPath("/ws/data/skills/foo_bar/SKILL.md"), null, "underscore rejected");
    assert.equal(slugFromDataPath("/ws/data/skills/-foo/SKILL.md"), null, "leading hyphen rejected");
    assert.equal(slugFromDataPath("/ws/data/skills/foo--bar/SKILL.md"), null, "double hyphen rejected");
  });
});

describe("slugFromRmCommand", () => {
  it("matches `rm -rf data/skills/<slug>/` and variants", () => {
    assert.equal(slugFromRmCommand("rm -rf data/skills/nazonazo/"), "nazonazo");
    assert.equal(slugFromRmCommand("rm -rf data/skills/nazonazo"), "nazonazo");
    assert.equal(slugFromRmCommand("rm -r data/skills/foo/"), "foo");
    assert.equal(slugFromRmCommand("rm -rf 'data/skills/my-skill/'"), "my-skill");
  });

  it("rejects wildcards and parent-dir deletes", () => {
    // Mass deletes via wildcards or wiping the whole staging dir
    // must NOT be mirrored — one typo could otherwise wipe every
    // skill in .claude/skills/.
    assert.equal(slugFromRmCommand("rm -rf data/skills/*"), null);
    assert.equal(slugFromRmCommand("rm -rf data/skills/"), null);
    assert.equal(slugFromRmCommand("rm -rf data/skills"), null);
    assert.equal(slugFromRmCommand("rm -rf data/skills/foo data/skills/bar"), null);
  });

  it("rejects non-rm commands", () => {
    assert.equal(slugFromRmCommand("ls data/skills/"), null);
    assert.equal(slugFromRmCommand("mv data/skills/foo data/skills/bar"), null);
  });
});

describe("handleSkillBridge — mirror copy", () => {
  it("copies data/skills/<slug>/SKILL.md to .claude/skills/<slug>/SKILL.md on Write", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-write-"));
    setWorkspace(root);
    await mkdir(dataSkillDir("nazonazo"), { recursive: true });
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

  it("removes .claude/skills/<slug>/ on a matching Bash rm -rf", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-delete-"));
    setWorkspace(root);
    await mkdir(path.dirname(claudeSkillFilePath("doomed")), { recursive: true });
    await writeFile(claudeSkillFilePath("doomed"), "---\nname: doomed\n---", "utf-8");

    await handleSkillBridge({
      tool_name: "Bash",
      tool_input: { command: "rm -rf data/skills/doomed/" },
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
