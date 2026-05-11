// Unit tests for agent permission allow-list provisioning.
//
// The provisioner must:
//   - Create settings.json with the required allow rules on a fresh
//     workspace.
//   - Be idempotent (running twice = byte-identical output).
//   - Preserve user-supplied keys / allow entries — settings.json is
//     a shared resource owned by every provisioner under
//     server/workspace/.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { provisionAgentPermissions, REQUIRED_ALLOW_RULES, upsertAllowRules } from "../../../server/workspace/agent-permissions/provision.js";

interface SettingsShape {
  permissions?: { allow?: unknown[] };
  [key: string]: unknown;
}

async function readSettings(workspace: string): Promise<SettingsShape> {
  const raw = await readFile(path.join(workspace, ".claude", "settings.json"), "utf-8");
  return JSON.parse(raw) as SettingsShape;
}

describe("provisionAgentPermissions — first install", () => {
  it("creates settings.json carrying every required allow rule", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-perm-fresh-"));
    // Provisioner expects `.claude/` to exist (writeFileAtomic does
    // not create parent dirs). Real startup goes through ensureDir
    // higher up the stack; mirror that here.
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await provisionAgentPermissions({ workspaceRoot: root });

    const settings = await readSettings(root);
    const allow = settings.permissions?.allow as string[] | undefined;
    assert.ok(Array.isArray(allow), "permissions.allow must be present");
    for (const rule of REQUIRED_ALLOW_RULES) {
      assert.ok(allow.includes(rule), `allow must include ${rule}`);
    }

    await rm(root, { recursive: true, force: true });
  });
});

describe("provisionAgentPermissions — idempotent", () => {
  it("running twice produces byte-identical settings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-perm-idem-"));
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await provisionAgentPermissions({ workspaceRoot: root });
    const first = await readFile(path.join(root, ".claude", "settings.json"), "utf-8");
    await provisionAgentPermissions({ workspaceRoot: root });
    const second = await readFile(path.join(root, ".claude", "settings.json"), "utf-8");
    assert.equal(first, second);
    await rm(root, { recursive: true, force: true });
  });
});

describe("provisionAgentPermissions — preserves user state", () => {
  it("merges into an existing settings.json without clobbering user keys", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-perm-merge-"));
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const existing = {
      // Other provisioners write here; their entry must survive.
      hooks: { PostToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "echo hi" }] }] },
      permissions: {
        // User added their own rule — must be preserved verbatim.
        allow: ["Bash(npm *)"],
        defaultMode: "default",
      },
      // Top-level user key — must be preserved.
      customKey: "user-value",
    };
    await writeFile(path.join(root, ".claude", "settings.json"), `${JSON.stringify(existing, null, 2)}\n`, "utf-8");

    await provisionAgentPermissions({ workspaceRoot: root });

    const settings = await readSettings(root);
    const allow = settings.permissions?.allow as string[];
    assert.ok(allow.includes("Bash(npm *)"), "user-added rule must be preserved");
    for (const rule of REQUIRED_ALLOW_RULES) {
      assert.ok(allow.includes(rule), `required rule ${rule} must be present`);
    }
    // Other keys untouched.
    assert.equal(settings.customKey, "user-value");
    assert.deepEqual((settings.permissions as { defaultMode?: string })?.defaultMode, "default");
    assert.ok(Array.isArray((settings as { hooks?: { PostToolUse?: unknown[] } }).hooks?.PostToolUse));

    await rm(root, { recursive: true, force: true });
  });
});

describe("upsertAllowRules — pure helper", () => {
  it("returns the same object reference when every required rule is already present", () => {
    const settings = {
      permissions: { allow: [...REQUIRED_ALLOW_RULES, "Bash(npm *)"] },
    };
    // No change → caller treats this as a no-op and skips the write.
    // We assert byte-identical JSON because object identity isn't
    // contractual, just the no-op effect.
    const next = upsertAllowRules(settings);
    assert.equal(JSON.stringify(next), JSON.stringify(settings));
  });

  it("handles a malformed allow field by rebuilding from required rules", () => {
    // A previous corruption (e.g. `allow: "Write(./**)"` string instead
    // of array) must not throw — it gets normalised to [] and the
    // required rules are then appended.
    const settings: { permissions: { allow: unknown } } = {
      permissions: { allow: "not-an-array" as unknown },
    };
    const next = upsertAllowRules(settings as Parameters<typeof upsertAllowRules>[0]);
    const allow = (next.permissions as { allow?: unknown[] }).allow as string[];
    assert.ok(Array.isArray(allow));
    for (const rule of REQUIRED_ALLOW_RULES) {
      assert.ok(allow.includes(rule));
    }
  });
});
