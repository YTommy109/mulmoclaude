// `description:` reader for a SKILL.md YAML frontmatter envelope.
//
// The host (MulmoClaude) parses SKILL.md frontmatter with js-yaml, but
// @mulmoclaude/core deliberately carries no YAML dependency and export only needs
// the single `description` scalar for the registry meta.json (best-effort — it
// defaults to "" when absent). Rather than pull in a YAML parser we scan the
// envelope for the first `description:` line and resolve the common YAML scalar
// forms so exported descriptions match what the host produced:
//   - double-quoted ("…")  → unescaped, trailing inline comment ignored
//   - single-quoted ('…')  → '' → ', trailing inline comment ignored
//   - plain (unquoted)     → trailing " #comment" stripped (YAML comment rule)
// Block scalars (`description: |`) are NOT expanded — they yield "" (skill
// descriptions are single-line in practice).

const FENCE = "---";
const KEY = "description:";
const BLOCK_SCALAR_INDICATORS = new Set(["|", ">", "|-", ">-", "|+", ">+"]);

const isYamlSpace = (char: string | undefined): boolean => char === " " || char === "\t";

// Double-quoted scalar: walk to the closing unescaped quote, processing the
// escapes a description realistically carries (\" \\ \n \t; any other \x → x).
function parseDoubleQuoted(value: string): string {
  const out: string[] = [];
  for (let i = 1; i < value.length; i += 1) {
    const char = value[i];
    if (char === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      out.push(next === "n" ? "\n" : next === "t" ? "\t" : next);
      i += 1;
      continue;
    }
    if (char === '"') break; // closing quote — ignore any trailing comment
    out.push(char);
  }
  return out.join("");
}

// Single-quoted scalar: the only escape is a doubled quote ('').
function parseSingleQuoted(value: string): string {
  const out: string[] = [];
  for (let i = 1; i < value.length; i += 1) {
    const char = value[i];
    if (char === "'") {
      if (value[i + 1] === "'") {
        out.push("'");
        i += 1;
        continue;
      }
      break; // closing quote — ignore any trailing comment
    }
    out.push(char);
  }
  return out.join("");
}

// Plain scalar: a "#" preceded by whitespace (or at the start) begins a YAML
// comment; "#" not preceded by whitespace (e.g. "C#") is literal.
function stripPlainComment(value: string): string {
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "#" && (i === 0 || isYamlSpace(value[i - 1]))) return value.slice(0, i);
  }
  return value;
}

/** Extract the frontmatter `description` from raw SKILL.md text. Returns "" when
 *  there's no `---` envelope, no `description:` key, or the value is a block
 *  scalar indicator. */
export function parseSkillDescription(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) return "";
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === FENCE) return ""; // end of envelope, key not found
    if (!line.startsWith(KEY)) continue;
    const value = line.slice(KEY.length).trim();
    if (value === "" || BLOCK_SCALAR_INDICATORS.has(value)) return "";
    if (value.startsWith('"')) return parseDoubleQuoted(value);
    if (value.startsWith("'")) return parseSingleQuoted(value);
    return stripPlainComment(value).trim();
  }
  return "";
}
