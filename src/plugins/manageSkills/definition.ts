import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "manageSkills";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "List Claude Code skills available to this workspace (from ~/.claude/skills/ and <workspace>/.claude/skills/). Read-only discovery; the user picks one from the canvas and runs it via a follow-up message.",
  prompt:
    `Use the ${TOOL_NAME} tool when the user asks to see, browse, or pick from their Claude Code skills. ` +
    `Phase-0 behaviour: this tool only lists skills — it does not run them. After the list is shown, the user clicks "Run" in the canvas UI, which sends a new message whose body is the skill's SKILL.md content.`,
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

export default toolDefinition;
