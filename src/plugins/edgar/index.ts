import type { PluginRegistration, PluginEntry } from "../../tools/types";
import toolDefinition from "./definition";
import { META } from "./meta";

// Edgar is server-only — no Vue View / Preview. The tool result
// flows back to the LLM as a plain MCP `tool_use_result` block,
// the same way pure MCP tools (notify / searchX / readXPost)
// behave. The frontend never has to render anything.
//
// MulmoClaude never invokes `execute()` at runtime (see ToolPlugin
// contract in src/tools/types.ts) — Claude → MCP → REST goes
// straight to /api/edgar. PluginEntry is the minimal shape the
// frontend registry needs.

const entry: PluginEntry = { toolDefinition };

export const REGISTRATION: PluginRegistration = {
  toolName: META.toolName,
  entry,
};
