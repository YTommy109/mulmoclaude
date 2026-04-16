// Pure SKILL.md parser. Given the raw file content, return the
// `description` (from YAML frontmatter) + body. Kept dependency-free
// so tests don't need a filesystem.
//
// Minimal YAML: we only care about one `description` key, so rather
// than pulling in a YAML parser we do line-by-line extraction. This
// mirrors the approach used by server/sources/registry.ts for source
// frontmatter — no js-yaml, no ambiguity with multi-line scalars.

export interface ParsedSkill {
  description: string;
  body: string;
}

// Match a YAML scalar value on a single line:
//   description: Enable CI for a repository
//   description: "Quoted with colons: inside"
// Leading/trailing whitespace trimmed. Quoted values have their
// outer quotes stripped but inner JSON-style escapes are NOT
// reversed — SKILL.md descriptions in the wild are plain text.
function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse a SKILL.md file. Returns null when:
 *  - the file has no frontmatter (no leading `---` fence)
 *  - the frontmatter is unterminated
 *  - there is no `description:` key
 *
 * An empty body is allowed (the skill may be just metadata for now).
 */
export function parseSkillFrontmatter(raw: string): ParsedSkill | null {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") return null;

  // Find the closing `---` fence. Skip index 0 (the opener).
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return null;

  let description: string | null = null;
  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i];
    // Only the `description:` key matters in phase 0. Split on the
    // FIRST colon so values containing ":" are preserved.
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (key !== "description") continue;
    description = parseScalar(line.slice(colonIdx + 1));
    break;
  }

  if (description === null) return null;

  // Body starts after the closing fence. Trim leading blank lines so
  // the UI doesn't render an awkward gap above the first heading.
  const body = lines
    .slice(closeIdx + 1)
    .join("\n")
    .replace(/^(?:\s*\n)+/, "")
    .trimEnd();

  return { description, body };
}
