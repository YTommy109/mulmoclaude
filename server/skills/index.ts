// Public API for the skills discovery module. Only `discoverSkills`
// and the pure parser escape the module — the collectSkillsFromDir
// helper is exported for tests but should not be relied on from
// outside code.

export { discoverSkills, collectSkillsFromDir } from "./discovery.js";
export { parseSkillFrontmatter } from "./parser.js";
export type { Skill, SkillSource, SkillSummary } from "./types.js";
