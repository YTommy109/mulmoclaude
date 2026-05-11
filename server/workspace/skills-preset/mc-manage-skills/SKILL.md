---
name: mc-manage-skills
description: Save, edit, list, or delete a Claude Code skill in this workspace. Use when the user wants to turn a workflow into a reusable skill ("skill 化して", "save this as a skill"), modify or remove one, or list what's registered. Writes one `SKILL.md` per skill at `.claude/skills/<slug>/SKILL.md` (cwd-relative — the agent already runs with cwd = workspace); the auto-refresh hook re-registers scheduled skills on save.
---

# Skill manager

A bundled MulmoClaude preset skill (`mc-` prefix = launcher-managed; do not edit
this file in the workspace, it is overwritten on every server boot).

Help the user manage **project-scope** Claude Code skills — the ones that live
under `.claude/skills/` (cwd-relative; the agent runs with cwd set to the
workspace root, so every path in this file is plain cwd-relative). The
user-scope folder `~/.claude/skills/` is read-only territory managed outside
MulmoClaude — don't touch those.

End with a one-line confirmation ("Saved as foo-skill." / "Removed foo-skill.")
so the user can verify without scrolling.

## Workflow 1: save a new skill

**Triggers**: "skill 化して", "save this as a skill", "make this reusable",
"そのまま skill に".

**Step 1 — distil.** If the user is asking you to skill-ify the current
conversation, read the chat transcript first. The transcript lives at
`chat/<session-id>.jsonl`; if you don't know the session id, list the
directory and pick the most-recent one. Reduce the conversation into a
focused markdown body in **second person** ("First, do X. Then, do Y.") that
captures the reusable workflow — not the one-off details that won't generalise.

**Step 2 — pick a kebab-case slug.** Lowercase ASCII letters / digits, single
hyphens between segments, no leading / trailing / consecutive hyphens, 1-64
characters. Pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`. If the user proposed a name,
use it as-is (validate the same way).

If `.claude/skills/<slug>/SKILL.md` already exists, ask before overwriting.

**Step 3 — Write the SKILL.md**:

```markdown
---
name: <slug>
description: One-line summary that frames *when* the skill should run.
schedule: daily 09:00      # optional — auto-runs on schedule
roleId: general            # optional — role to use for scheduled runs
---

# <Skill name>

Body in markdown, second person. Focused on the reusable workflow.
```

**Description rules** (the discovery layer reads this — make it count):

- Lead with an action verb + noun ("Save / list / delete a recipe", "Schedule
  a recurring task"). Vague descriptions like "Helps with X" don't trigger.
- Include a few **trigger phrases** the user might say, in their language.
- Cap around 1-2 sentences. Long descriptions get truncated when the listing
  is sent to Claude.

**Optional fields**:

- `schedule` — `daily HH:MM` (UTC) or `interval Ns` / `Nm` / `Nh`. The
  scheduler auto-runs the skill at that cadence.
- `roleId` — role to use for scheduled runs (defaults to `general`).

The auto-refresh hook (`.claude/hooks/config-refresh.mjs`) fires on Write/Edit,
so a new `schedule:` activates without a server restart.

## Workflow 2: recall / browse

**Triggers**: "what skills do I have?", "保存した skill みせて", "list my
skills".

List the directory:

```bash
find .claude/skills -maxdepth 2 -name SKILL.md | sort
```

Read each skill's frontmatter and present the names + one-line descriptions
in chat. Don't dump raw markdown unless the user asks for one specifically.

## Workflow 3: update

**Triggers**: "〇〇 の skill を更新して", "change the description of foo",
"add a schedule to foo-skill".

Read the current `SKILL.md`, apply the change with Edit (preserve every other
field unless the user explicitly asked to change it), and confirm. The
auto-refresh hook re-registers scheduled skills after the write.

## Workflow 4: delete

**Triggers**: "remove the foo skill", "foo-skill いらない".

Only when the user explicitly asks. **Re-validate the slug against
`^[a-z0-9]+(-[a-z0-9]+)*$` before running the command** — if it fails,
refuse and ask the user to confirm by name. When valid, quote the path:

```bash
rm -rf ".claude/skills/<slug>/"
```

Then confirm afterward.

## Tone

Friendly, practical. Don't lecture about paths or frontmatter — just save and
confirm. If a request needs several decisions (e.g. "save as foo and schedule
it daily"), do them in one go, don't ping-pong.
