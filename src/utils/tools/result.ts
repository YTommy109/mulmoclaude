// Pure helpers for `ToolResultComplete` shapes used across the
// frontend. Kept dependency-free of Vue / DOM so they are trivially
// unit-testable from `node:test`.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { v4 as uuidv4 } from "uuid";
import { isRecord } from "../types";
import type { SkillScope } from "../../types/session";

/** Tool name used by the synthetic envelope `makeSkillResult`
 *  produces for `type: "skill"` jsonl entries. The skill plugin's
 *  registration matches on this in `getPlugin()` so the canvas
 *  routes skill bodies through `src/plugins/skill/View.vue` instead
 *  of the default `text-response` view (#1218). */
export const SKILL_TOOL_NAME = "skill";

// Type guard: a text-response entry whose `data.role` is `"user"`.
// Used by App.vue to find the first user message in a live session
// when building the merged history list.
export function isUserTextResponse(res: ToolResultComplete): boolean {
  if (res.toolName !== "text-response") return false;
  const { data } = res;
  if (!isRecord(data)) return false;
  return data.role === "user";
}

// Build a synthetic text-response result for either a user or
// assistant turn. Used by sendMessage and the chat history UI.
// `attachments` is optional and only meaningful on user turns —
// they're the workspace paths the user attached for this message
// and surface as chips next to the bubble.
export function makeTextResult(text: string, role: "user" | "assistant", attachments?: readonly string[]): ToolResultComplete {
  const data: Record<string, unknown> = { text, role, transportKind: "text-rest" };
  if (attachments && attachments.length > 0) {
    data.attachments = [...attachments];
  }
  return {
    uuid: uuidv4(),
    toolName: "text-response",
    message: text,
    title: role === "user" ? "You" : "Assistant",
    data,
  };
}

export interface SkillResultData {
  skillName: string;
  skillScope: SkillScope;
  skillPath: string | null;
  skillDescription: string | null;
  /** Full SKILL.md body as Claude CLI synthesised it. Available in
   *  the data field for the View's expand toggle. */
  body: string;
}

/** Build a synthetic skill-result envelope from a parsed jsonl
 *  `SkillEntry`. The skill plugin's View collapses by default to
 *  `<skillName> · <skillDescription>` and reveals `body` on toggle.
 *  Distinct from `makeTextResult` so the canvas can render it
 *  without the wall-of-text default applied to assistant prose. */
export function makeSkillResult(entry: {
  skillName: string;
  skillScope: SkillScope;
  skillPath: string | null;
  skillDescription: string | null;
  message: string;
}): ToolResultComplete {
  const data: SkillResultData = {
    skillName: entry.skillName,
    skillScope: entry.skillScope,
    skillPath: entry.skillPath,
    skillDescription: entry.skillDescription,
    body: entry.message,
  };
  return {
    uuid: uuidv4(),
    toolName: SKILL_TOOL_NAME,
    message: entry.skillDescription ?? entry.skillName,
    title: `Skill: ${entry.skillName}`,
    data: data as unknown as Record<string, unknown>,
  };
}
