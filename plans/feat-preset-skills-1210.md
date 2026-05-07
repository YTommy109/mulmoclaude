# Preset skills bundled with mulmoclaude (#1210)

Ship Claude Code skills (markdown-driven slash commands) as part of
the launcher, copied into the workspace on boot. Mirror the existing
`config/helps/` distribution mechanism so the implementation is small
and well-understood. Use `mc-` slug prefix to avoid collisions with
user-authored skills.

This plan covers **PR-A only** — the infrastructure. The first
concrete preset (`mc-library`) lands in a separate PR per the issue's
phasing.

## Architecture recap

Claude Code resolves slash commands against two hardcoded paths:

1. `~/.claude/skills/<slug>/SKILL.md` — user, global
2. `<cwd>/.claude/skills/<slug>/SKILL.md` — project (cwd = workspace
   root, so `~/mulmoclaude/.claude/skills/`)

There's no CLI flag to add a third path. So a "preset skill shipped
with mulmoclaude" must materialise at one of those two locations.
The `<workspaceRoot>/.claude/skills/` path is the natural fit — it's
already where MulmoClaude allows `manageSkills` to write.

## Source of truth

```
server/workspace/skills-preset/
├── mc-<slug-1>/
│   └── SKILL.md
├── mc-<slug-2>/
│   └── SKILL.md
└── …
```

Sibling to `server/workspace/helps/`, deliberately. `prepare-dist.js`
copies `server/` recursively, so this dir ships in the launcher
tarball without further wiring.

For PR-A, ship one stub: `mc-example/SKILL.md` containing a one-paragraph
"this is a preset skill bundled with mulmoclaude" body. Real presets
land in PR-B onwards.

## Boot-time copy

Extend `server/workspace/workspace.ts`'s `initWorkspace()`. Today it
copies `server/workspace/helps/*` → `<workspaceRoot>/config/helps/`
on every start. Add a parallel block:

1. Discover entries under `<launcherInstall>/server/workspace/skills-preset/`
2. For each `<slug>/`:
   - Verify slug starts with `mc-` (boot-time guard — see below)
   - Verify a `SKILL.md` exists
   - `mkdirSync(<workspaceRoot>/.claude/skills/<slug>, { recursive: true })`
   - `copyFileSync` SKILL.md across (unconditional overwrite — same
     contract as helps)
3. Cleanup pass: list `<workspaceRoot>/.claude/skills/` for entries
   starting with `mc-` whose slug is NOT in the current preset list.
   Delete those (`rm -rf` on the dir). Removes presets that were
   retired between releases.

Cleanup is bounded to `mc-*` slugs by design — user-authored entries
without the prefix are never touched.

## Slug guard

A boot-time check rejects any `skills-preset/<slug>/` whose slug
doesn't start with `mc-`. The first iteration uses **error + log,
not exit** — log a clear warning and skip the entry, so a typo
doesn't brick mulmoclaude on boot. (If we get bitten by silent skips
we can promote to hard error later.)

Implementation lives next to the boot hook, not deeper in the skill
discovery layer, so it fires before any user gets to invoke a
mis-prefixed preset.

## Code touch surface

- `server/workspace/workspace.ts`
  - new constant: `SKILLS_PRESET_DIR = path.join(__dirname, "skills-preset")`
  - new constant: `SKILLS_PROJECT_DIR_REL = ".claude/skills"`
  - new function: `syncPresetSkills(workspaceRoot, presetSrc)` →
    pure-ish, returns `{ copied: string[], removed: string[], skipped: string[] }`
    for tests; helper handles validation + copy + cleanup
  - call site: inside `initWorkspace()`, after the existing helps copy
- `server/workspace/skills-preset/mc-example/SKILL.md` — stub preset
  so the directory exists and the copy path is exercised

No changes needed to `discovery.ts` — preset slugs land in the
project-scope path the existing logic already scans.

## Tests

`test/workspace/test_skills_preset.ts` (new):

- **happy path**: with one preset `mc-foo`, after `syncPresetSkills`,
  `<workspace>/.claude/skills/mc-foo/SKILL.md` exists with the
  preset's content
- **overwrite**: an existing `<workspace>/.claude/skills/mc-foo/SKILL.md`
  with stale content gets refreshed
- **user-skill safety**: an existing `<workspace>/.claude/skills/library/`
  (no `mc-` prefix) is untouched
- **slug guard**: a preset entry `bad-slug` (no prefix) is logged + skipped, NOT copied
- **cleanup**: a `<workspace>/.claude/skills/mc-stale/` whose slug is
  no longer in `skills-preset/` gets removed
- **cleanup respects user**: a `<workspace>/.claude/skills/library/`
  (no `mc-` prefix) is NOT removed even though it's not in
  `skills-preset/`
- **idempotent**: running `syncPresetSkills` twice in a row yields
  the same on-disk state, no errors

Tmpdir-based fixtures, no real workspace touched. Pattern mirrors
`test/utils/files/test_atomic.ts` and the helps tests.

## Known trade-offs

1. **Unconditional overwrite of `mc-*` slugs**: a user who edits
   `<workspace>/.claude/skills/mc-library/SKILL.md` loses their edits
   on next boot. This is the intended contract — preset skills are
   "factory defaults". Document it in the SKILL.md template comment.
   Customisation path: copy the file out, drop the `mc-` prefix, edit
   the copy.
2. **Cleanup deletes `mc-*` slugs not in source**: a user who
   manually creates an `mc-foo/SKILL.md` (mimicking the preset
   convention) will see it disappear on boot. Same contract — `mc-*`
   is the launcher's namespace. Document loudly.
3. **No backwards compatibility for retired presets**: we don't
   stage a deprecation period. If the launcher decides `mc-foo` is
   gone, the workspace entry vanishes too. Acceptable because:
   - Skills are shipped, not user-state — losing an old preset is
     like losing a default config option
   - Anyone who modified the preset under its `mc-` name should not
     have done so (see trade-off 1)

## Out of scope (future PRs)

- The first real preset (`mc-library`) — separate PR per #1210
  phasing (PR-B)
- UI badge for "preset" skills in the manageSkills view — the
  source detection is already trivial (slug starts with `mc-`),
  but the UI work is its own thing
- `discoverSkills()` extension to surface `"preset"` as a distinct
  source — also out of scope; current 2-tier (user, project) stays
  fine since presets land in the project path

## Steps

1. Branch `feat/preset-skills-1210` (already on it)
2. Commit this plan
3. Implement: `syncPresetSkills` helper + boot wiring + stub
   `mc-example/SKILL.md`
4. Tests
5. `yarn lint` / `yarn typecheck` / `yarn test` clean
6. Manual smoke: `yarn dev`, confirm `~/mulmoclaude/.claude/skills/mc-example/SKILL.md`
   appears, then delete it and reboot — appears again
7. Open PR linked to #1210 as PR-A
EOF
)