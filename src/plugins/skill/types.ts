// Wire shape of a `toolName: "skill"` ToolResultComplete envelope —
// produced by `makeSkillResult` in `src/utils/tools/result.ts` from
// either a `type: "skill"` jsonl entry on session reload, or a
// `SseSkill` event broadcast at flush time during a live run.

import type { SkillScope } from "../../types/session";

export interface SkillData {
  skillName: string;
  skillScope: SkillScope;
  skillPath: string | null;
  skillDescription: string | null;
  /** Full SKILL.md body as Claude CLI synthesised it. Frontmatter is
   *  already stripped (Claude CLI does that before injection); the
   *  body starts with `Base directory for this skill: <path>` and
   *  ends with `ARGUMENTS: <user message>`. The View renders this
   *  with markdown when the user expands the collapsed card. */
  body: string;
}

export type SkillArgs = SkillData;
