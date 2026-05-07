---
name: mc-example
description: Stub preset skill bundled with mulmoclaude. Demonstrates the preset distribution mechanism — real preset skills replace this in subsequent PRs.
---

# Preset skill — example

This file is shipped with mulmoclaude under
`server/workspace/skills-preset/mc-example/SKILL.md` and copied into
`<workspaceRoot>/.claude/skills/mc-example/SKILL.md` on every server
boot. The `mc-` prefix is the launcher's namespace — anything under
`mc-*` belongs to mulmoclaude and may be added, refreshed, or
removed across releases.

If you edit this file in your workspace, your changes will be
overwritten on the next server boot. To customise, copy the body
into a new skill under your own slug (e.g. `~/.claude/skills/my-thing/SKILL.md`)
and edit that copy.

## What this skill does

Nothing — it's a placeholder. Replace with real workflow guidance in
real preset skills (e.g. `mc-library` for the personal reading list
in #1210 PR-B).
