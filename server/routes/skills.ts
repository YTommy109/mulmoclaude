// Read-only REST surface for Claude Code skills (phase 0 of #139).
//
//   GET /api/skills         → { skills: SkillSummary[] }
//   GET /api/skills/:name   → { skill: Skill } | 404
//
// Discovery reads from ~/.claude/skills/ (user) and
// <workspace>/.claude/skills/ (project), project wins on name
// collision. No POST/PUT/DELETE in phase 0 — edits happen on the
// filesystem.

import { Router, Request, Response } from "express";
import { discoverSkills } from "../skills/index.js";
import type { Skill, SkillSummary } from "../skills/index.js";
import { workspacePath } from "../workspace.js";

const router = Router();

interface SkillsListResponse {
  skills: SkillSummary[];
}

interface SkillDetailResponse {
  skill: Skill;
}

interface ErrorResponse {
  error: string;
}

router.get(
  "/skills",
  async (_req: Request, res: Response<SkillsListResponse>) => {
    const skills = await discoverSkills({ workspaceRoot: workspacePath });
    res.json({
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.source,
      })),
    });
  },
);

router.get(
  "/skills/:name",
  async (
    req: Request<{ name: string }>,
    res: Response<SkillDetailResponse | ErrorResponse>,
  ) => {
    const skills = await discoverSkills({ workspaceRoot: workspacePath });
    const skill = skills.find((s) => s.name === req.params.name);
    if (!skill) {
      res.status(404).json({ error: `skill not found: ${req.params.name}` });
      return;
    }
    res.json({ skill });
  },
);

export default router;
