// Unit-tests the `pendingSkill` state machine in isolation —
// `updatePendingSkillOnToolCall` + `updatePendingSkillOnToolCallResult`
// — to lock in the leak-fix invariants Codex flagged across two
// review iterations on PR #1220.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  _updatePendingSkillOnToolCallForTest as onToolCall,
  _updatePendingSkillOnToolCallResultForTest as onToolCallResult,
} from "../../server/api/routes/agent.js";

interface MinimalCtx {
  pendingSkill: { skillName: string; toolUseId: string } | null;
}

describe("pendingSkill state machine (#1218)", () => {
  it("Skill tool_call sets pendingSkill with skillName + toolUseId", () => {
    const ctx: MinimalCtx = { pendingSkill: null };
    onToolCall(ctx, { toolName: "Skill", toolUseId: "tu_A", args: { skill: "shiritori" } });
    assert.deepEqual(ctx.pendingSkill, { skillName: "shiritori", toolUseId: "tu_A" });
  });

  it("Skill tool_call without a skill slug arg leaves pendingSkill null", () => {
    const ctx: MinimalCtx = { pendingSkill: null };
    onToolCall(ctx, { toolName: "Skill", toolUseId: "tu_A", args: {} });
    assert.equal(ctx.pendingSkill, null);
  });

  it("Codex iter-1 — non-Skill tool_call clears stale pendingSkill (Bash interleaving the body)", () => {
    const ctx: MinimalCtx = { pendingSkill: { skillName: "shiritori", toolUseId: "tu_A" } };
    onToolCall(ctx, { toolName: "Bash", toolUseId: "tu_B", args: { command: "ls" } });
    assert.equal(ctx.pendingSkill, null);
  });

  it("Codex iter-2 — Skill's own tool_call_result keeps pendingSkill set (matching id)", () => {
    const ctx: MinimalCtx = { pendingSkill: { skillName: "shiritori", toolUseId: "tu_A" } };
    onToolCallResult(ctx, "tu_A");
    assert.deepEqual(ctx.pendingSkill, { skillName: "shiritori", toolUseId: "tu_A" });
  });

  it("Codex iter-2 — tool_call_result with mismatched id clears pendingSkill (interleaved tool result)", () => {
    const ctx: MinimalCtx = { pendingSkill: { skillName: "shiritori", toolUseId: "tu_A" } };
    onToolCallResult(ctx, "tu_OTHER");
    assert.equal(ctx.pendingSkill, null);
  });

  it("tool_call_result is a no-op when nothing was pending", () => {
    const ctx: MinimalCtx = { pendingSkill: null };
    onToolCallResult(ctx, "tu_X");
    assert.equal(ctx.pendingSkill, null);
  });

  it("Re-issuing a Skill tool_call (e.g. user calls another skill) replaces the pending state", () => {
    const ctx: MinimalCtx = { pendingSkill: { skillName: "shiritori", toolUseId: "tu_A" } };
    onToolCall(ctx, { toolName: "Skill", toolUseId: "tu_B", args: { skill: "mc-library" } });
    assert.deepEqual(ctx.pendingSkill, { skillName: "mc-library", toolUseId: "tu_B" });
  });

  it("Sequence: Skill → matching result → Bash → unrelated text would not have pendingSkill set anymore", () => {
    const ctx: MinimalCtx = { pendingSkill: null };
    onToolCall(ctx, { toolName: "Skill", toolUseId: "tu_A", args: { skill: "shiritori" } });
    assert.ok(ctx.pendingSkill, "Skill set the flag");
    onToolCallResult(ctx, "tu_A");
    assert.ok(ctx.pendingSkill, "matching result keeps the flag — body still expected");
    onToolCall(ctx, { toolName: "Bash", toolUseId: "tu_B", args: {} });
    assert.equal(ctx.pendingSkill, null, "Bash interrupted — flag cleared");
  });
});
