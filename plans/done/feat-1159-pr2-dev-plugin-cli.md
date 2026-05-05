# Dev plugin loading via CLI flag (PR2 of #1159)

PR1 (#1163) shipped the scaffold CLI. PR2 closes the dev loop:
plugin author edits code → vite rebuilds `dist/` → reload mulmoclaude
→ change is live. No publish, no install ledger.

## Goal

A plugin author runs:

```bash
# Terminal A — plugin project
yarn dev          # vite build --watch, keeps dist/ fresh

# Terminal B — mulmoclaude
mulmoclaude --dev-plugin ./my-plugin --dev-plugin ../other-plugin
```

Per code change:
- editor save → vite rebuild → ⌘R in browser → updated plugin runs

PR3 will swap the manual ⌘R for chokidar-driven push reload, but PR2
delivers a complete dev loop on its own.

## CLI surface

`--dev-plugin <path>` repeatable:

- Multiple flags allowed: `--dev-plugin a --dev-plugin b`
- Path can be absolute OR relative; relative resolves against `cwd`
- Each path points to a **plugin project root** (the dir containing
  `package.json`), not the `dist/` itself — same shape as an extracted
  tgz, so the existing loader path works unchanged
- Plugin must have built its `dist/` at least once (`yarn build` or
  one save under `yarn dev`)

## Logging

Plugin authors will hit "wait, where did that path resolve to?" — so
log the resolved abs path explicitly:

```text
[dev-plugin] ./my-plugin → /Users/.../my-plugin
[dev-plugin] loaded @example/my-plugin from /Users/.../my-plugin
```

Failures (missing dir / missing `package.json` / missing
`dist/index.js`) name the resolved abs path, not the user input, so
the dev sees what mulmoclaude actually checked.

## Collision policy

Per user: **fatal at startup** in either of these cases:

1. A name appears in the install ledger (prod) AND a `--dev-plugin`
   path resolves to the same package name
2. Two `--dev-plugin` paths resolve to the same package name

The error names the abs path(s) of every source involved, then
`process.exit(1)`. No best-effort "use the dev one" fallback — silent
shadowing is exactly the kind of bug that wastes a debugging hour.

## Implementation

### Launcher (`packages/mulmoclaude/bin/mulmoclaude.js`)

- Parse `--dev-plugin` (repeatable). Each value:
  - Resolve to abs path against `process.cwd()`
  - Log `[dev-plugin] <input> → <abs>`
- Pass to server via env: `MULMOCLAUDE_DEV_PLUGINS=<abs1>:<abs2>:…`
  (POSIX `:` separator on Linux/macOS, `;` on Windows — use
  `path.delimiter` so cross-platform stays clean)
- `--help` text gains the new option

### Server boot (`server/index.ts` / `server/agent/index.ts`)

- Read `process.env.MULMOCLAUDE_DEV_PLUGINS`, split by `path.delimiter`
- For each path, validate:
  - Exists and is a directory
  - `package.json` exists and has a `name` field
  - `dist/index.js` exists (clear actionable error if not — "did you
    `yarn build`?")
- Load via existing `loadPluginFromCacheDir(name, "dev", absPath)` —
  the literal string `"dev"` as version distinguishes from real
  semvers in the asset URL (`/api/plugins/runtime/<pkg>/dev/...`)
- Detect collisions before merging into the registry; on collision,
  log abs paths of all conflicting sources and `process.exit(1)`
- On success, log loaded list before the existing
  `registerRuntimePlugins` call

### Frontend

Nothing dev-specific — `/api/plugins/runtime/list` already returns
all registered plugins, dev or prod. The runtimeLoader treats them
uniformly. The dev "version" string just shows up in the URL.

## Tests

Unit:

- Path resolver: relative → abs (cwd anchor), missing dir, missing
  `package.json`, missing `dist/index.js`, `package.json` without `name`
- Collision detector: prod + dev clash → throws with both abs paths;
  two dev paths same name → throws with both abs paths

Integration (server-side, no spawned mulmoclaude needed):

- Mock workspace: one prod plugin in ledger, one dev plugin via env
  → both end up in registry, asset routes serve from each
- Mock workspace: dev plugin name == prod plugin name → boot throws

E2E (Playwright, optional):

- Defer. The dev loop is a developer-facing surface; manual smoke is
  fine for PR2

## README updates

- `packages/create-mulmoclaude-plugin/README.md` — replace the
  misleading `yarn link` section (which never worked because the
  runtime loader doesn't read `node_modules`) with the
  `--dev-plugin` recipe
- `packages/mulmoclaude/README.md` — document `--dev-plugin` in the
  CLI options section

## Out of scope (PR3)

- chokidar watching `<dev-plugin>/dist/` + WebSocket push reload
- Plugin-management UI (still a much-later concern; a CLI flag covers
  the dev case completely)

## Open questions

None — every decision is captured above. If a wrinkle comes up
during implementation, raise it in the PR before working around it.
