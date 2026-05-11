// Unit tests for the `mc-settings` auto-refresh hook provisioning
// (#1283). Provisioning must be idempotent, coexist with the
// existing `mulmoclaudeWikiHistory`-owned entry, and never clobber
// user-set keys in `.claude/settings.json`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { provisionConfigRefreshHook } from "../../../server/workspace/config-refresh/provision.js";
import { provisionWikiHistoryHook } from "../../../server/workspace/wiki-history/provision.js";

interface SettingsShape {
  hooks?: { PostToolUse?: Record<string, unknown>[] };
  [key: string]: unknown;
}

async function readSettings(workspace: string): Promise<SettingsShape> {
  const raw = await readFile(path.join(workspace, ".claude", "settings.json"), "utf-8");
  return JSON.parse(raw) as SettingsShape;
}

describe("provisionConfigRefreshHook — first install", () => {
  it("creates settings.json + hook script with our PostToolUse entry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "config-refresh-fresh-"));
    await provisionConfigRefreshHook({ workspaceRoot: root });

    const settings = await readSettings(root);
    const entries = settings.hooks?.PostToolUse ?? [];
    assert.equal(entries.length, 1);
    const entry = entries[0] as { matcher?: string; hooks?: { command?: string; mulmoclaudeConfigRefresh?: boolean }[] };
    assert.equal(entry.matcher, "Write|Edit");
    assert.equal(entry.hooks?.length, 1);
    const hook = entry.hooks?.[0];
    assert.equal(hook?.mulmoclaudeConfigRefresh, true);
    assert.match(hook?.command ?? "", /node "\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/config-refresh\.mjs"/);

    const scriptPath = path.join(root, ".claude", "hooks", "config-refresh.mjs");
    const scriptBody = await readFile(scriptPath, "utf-8");
    assert.match(scriptBody, /^#!\/usr\/bin\/env node/);
    // Anchor on the refresh endpoint path so a future hook-source
    // reformat doesn't silently break this test.
    assert.match(scriptBody, /\/api\/config\/refresh/);

    await rm(root, { recursive: true, force: true });
  });
});

describe("provisionConfigRefreshHook — idempotent", () => {
  it("running twice produces byte-identical settings + script", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "config-refresh-idem-"));
    await provisionConfigRefreshHook({ workspaceRoot: root });
    const firstSettings = await readFile(path.join(root, ".claude", "settings.json"), "utf-8");
    const firstScript = await readFile(path.join(root, ".claude", "hooks", "config-refresh.mjs"), "utf-8");

    await provisionConfigRefreshHook({ workspaceRoot: root });
    const secondSettings = await readFile(path.join(root, ".claude", "settings.json"), "utf-8");
    const secondScript = await readFile(path.join(root, ".claude", "hooks", "config-refresh.mjs"), "utf-8");

    assert.equal(secondSettings, firstSettings, "settings.json unchanged on second provision");
    assert.equal(secondScript, firstScript, "hook script unchanged on second provision");

    await rm(root, { recursive: true, force: true });
  });
});

describe("provisionConfigRefreshHook — coexists with wiki-history hook", () => {
  it("appends a second entry alongside wiki-history without overwriting it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "config-refresh-coexist-"));
    // Install wiki-history first to mimic the real boot order.
    await provisionWikiHistoryHook({ workspaceRoot: root });
    await provisionConfigRefreshHook({ workspaceRoot: root });

    const settings = await readSettings(root);
    const entries = settings.hooks?.PostToolUse ?? [];
    // Two distinct entries — one owned by wiki-history, one by us.
    assert.equal(entries.length, 2);
    const owners = entries
      .flatMap((entry) => {
        const hooks = (entry as { hooks?: Record<string, unknown>[] }).hooks ?? [];
        return hooks.map((hook) => ({
          wiki: hook.mulmoclaudeWikiHistory === true,
          refresh: hook.mulmoclaudeConfigRefresh === true,
        }));
      })
      .reduce((acc, item) => ({ wiki: acc.wiki || item.wiki, refresh: acc.refresh || item.refresh }), { wiki: false, refresh: false });
    assert.ok(owners.wiki, "wiki-history entry must survive");
    assert.ok(owners.refresh, "config-refresh entry must be present");

    await rm(root, { recursive: true, force: true });
  });
});

describe("provisionConfigRefreshHook — preserves user-set hooks", () => {
  it("does not touch unrelated PostToolUse entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "config-refresh-merge-"));
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const userOwned = {
      hooks: {
        PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo 'user hook ran' >> /tmp/user-bash.log" }] }],
      },
      otherTopLevelKey: { foo: "bar" },
    };
    await writeFile(path.join(root, ".claude", "settings.json"), JSON.stringify(userOwned, null, 2));
    await provisionConfigRefreshHook({ workspaceRoot: root });

    const settings = await readSettings(root);
    const entries = settings.hooks?.PostToolUse ?? [];
    assert.equal(entries.length, 2, "user entry survives + our entry appended");
    const userEntry = entries.find((entry) => (entry as { matcher?: string }).matcher === "Bash");
    assert.ok(userEntry, "user's Bash matcher entry survives");
    assert.equal(settings.otherTopLevelKey !== undefined, true, "unrelated top-level keys preserved");

    await rm(root, { recursive: true, force: true });
  });
});

describe("provisionConfigRefreshHook — recovers from corrupt settings.json", () => {
  it("rebuilds with our entry only when the file isn't valid JSON", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "config-refresh-corrupt-"));
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(path.join(root, ".claude", "settings.json"), "{ not json");
    await provisionConfigRefreshHook({ workspaceRoot: root });

    const settings = await readSettings(root);
    const entries = settings.hooks?.PostToolUse ?? [];
    assert.equal(entries.length, 1);
    const hook = (entries[0] as { hooks?: { mulmoclaudeConfigRefresh?: boolean }[] }).hooks?.[0];
    assert.equal(hook?.mulmoclaudeConfigRefresh, true);

    await rm(root, { recursive: true, force: true });
  });
});
