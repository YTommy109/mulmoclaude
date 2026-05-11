// Skill plugin core — pseudo-tool, never advertised to the LLM.
// `isEnabled: () => false` keeps it out of the agent's tool list;
// the plugin only exists so the canvas's `getPlugin("skill")`
// returns a registration that points the renderer at this View.

import type { ToolPluginCore, ToolContext, ToolResult } from "gui-chat-protocol";
import type { SkillData, SkillArgs } from "./types";
import { TOOL_DEFINITION, SYSTEM_PROMPT } from "./definition";

export { TOOL_NAME, TOOL_DEFINITION, SYSTEM_PROMPT } from "./definition";

export const executeSkill = async (_context: ToolContext, args: SkillArgs): Promise<ToolResult<SkillData, unknown>> => ({
  data: {
    skillName: args.skillName,
    skillScope: args.skillScope,
    skillPath: args.skillPath,
    skillDescription: args.skillDescription,
    body: args.body,
  },
  message: args.skillDescription ?? args.skillName,
});

export const pluginCore: ToolPluginCore<SkillData, unknown, SkillArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: executeSkill,
  generatingMessage: "Loading skill...",
  // Pseudo-tool — only the client builds these envelopes when
  // parsing `type: "skill"` jsonl entries / `SseSkill` events.
  isEnabled: () => false,
  systemPrompt: SYSTEM_PROMPT,
};
