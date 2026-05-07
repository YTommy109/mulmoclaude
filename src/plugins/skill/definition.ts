// Skill plugin — pseudo-tool used only by the client to render
// `type: "skill"` jsonl entries (#1218). The LLM never invokes this
// tool directly — it sees the real `Skill` tool defined by Claude
// CLI; this plugin's job is purely to claim a `toolName` slot in
// `getPlugin()` so the canvas routes skill envelopes through
// `View.vue` instead of the default text-response renderer.

import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "skill";

export const TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Internal: collapsed view of a SKILL.md body Claude CLI synthesised after a `Skill` tool invocation.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const SYSTEM_PROMPT = "";
