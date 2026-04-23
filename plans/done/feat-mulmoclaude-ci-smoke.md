# feat: CI smoke test for `mulmoclaude` npm package

## Problem

The `mulmoclaude` npm package is "the whole app bundled into one launcher". Unlike a normal npm package, three subtle things bite us on every release (see `.claude/skills/publish-mulmoclaude/SKILL.md` for the full lessons):

1. **Implicit-dep trap**: `server/` imports a bare package, but it's only in the root `package.json` — not `packages/mulmoclaude/package.json`. Works locally via yarn's workspace inheritance, explodes with `ERR_MODULE_NOT_FOUND` when the tarball is installed elsewhere.
2. **Workspace-drift trap**: a local `@mulmobridge/*` package's `src/` adds a new `export` without bumping its version. `npm install` resolves the stale published `dist/`, and the launcher fails with `SyntaxError: The requested module does not provide an export named X`.
3. **Tarball layout trap**: `prepare-dist.js` copies `server/`, `client/`, `src/` into the package dir. If any of those dirs is missing (e.g. `yarn build` wasn't run) the smoke test catches it; a typo in the filter function would slip past a local `npm pack` but fail on a fresh machine.

All three are only discoverable by actually running the launcher from the tarball in a clean environment. Today that's a manual 10-step checklist at release time — the skill exists, but it only protects the release engineer, not every PR that *could* have broken the publish.

## Goal

Run the manual publish-prep steps automatically on every PR + every `main` push, without actually publishing:

- Guard the implicit-dep trap (§1 of the skill) — fail PRs that add an `import` to `server/` without adding the package to `mulmoclaude`'s deps.
- Guard the workspace-drift trap (§2) — fail PRs where a local `@mulmobridge/*` package's `src/` has added a value export that the currently-published `dist/` doesn't expose.
- Guard the tarball-layout trap (§4) — `npm pack` the package, install it into a clean dir, start it on a free port, assert HTTP 200 on `/`.

Explicitly out of scope: `npm publish` itself. Releases stay on the human in the loop.

## Shape

Two files:

### 1. `scripts/mulmoclaude/smoke.mjs` (plain Node ESM, no deps)

A single driver that performs §1 + §2 + the parts of §4 that don't need a browser. Re-implements the logic currently inlined in `.claude/skills/publish-mulmoclaude/SKILL.md`:

```js
// High-level shape; concrete code lives in the file.
async function main() {
  const missing = await auditServerDeps();        // §1
  if (missing.length > 0) fail(`mulmoclaude is missing deps: ${missing.join(", ")}`);

  const drifted = await checkWorkspaceDrift();    // §2
  if (drifted.length > 0) fail(`stale @mulmobridge/* dist/ vs src/: ${drifted.join(", ")}`);

  await runTarballSmoke();                        // §4 minus the browser check
}
```

`runTarballSmoke` does:

1. `npm pack` inside `packages/mulmoclaude/`.
2. Fresh `/tmp/mc-ci/` (or `$RUNNER_TEMP/mc-ci` on GH Actions) → `npm init -y` → `npm install /abs/path/to/.tgz`.
3. Start the launcher with `--no-open --port <free port>` in the background.
4. Poll `http://127.0.0.1:<port>/` up to 30 s for HTTP 200.
5. Kill the launcher process group; fail the driver if the banner / HTTP 200 didn't appear.

The port is picked by asking the OS for an ephemeral port (same trick as `server/utils/port.mjs`), so parallel CI jobs don't collide.

Extract the three helpers (`auditServerDeps`, `checkWorkspaceDrift`, `runTarballSmoke`) into separate files under `scripts/mulmoclaude/` so each one is independently unit-testable from `test/scripts/mulmoclaude/`. The skill's inline Python `dep audit` becomes JS so there's one language in the tree.

### 2. `.github/workflows/mulmoclaude_smoke.yaml` (separate from the existing `pull_request.yaml`)

Kept separate because:

- The existing `lint_test` runs on a 6-cell matrix (2 Node × 3 OS). The smoke job only needs one cell — `ubuntu-latest, 22.x` is enough. Sharing the workflow would double the matrix even though 5/6 cells waste ~90 s each.
- The tarball step writes into `$RUNNER_TEMP`, spawns a background process, and needs a clean `node_modules`. Keeping it in its own workflow means a failure is easy to find in the UI.

Skeleton:

```yaml
name: MulmoClaude publish smoke

on:
  pull_request:
    branches: [main]
    paths:
      - 'packages/mulmoclaude/**'
      - 'packages/protocol/**'
      - 'packages/client/**'
      - 'packages/chat-service/**'
      - 'server/**'
      - 'src/**'
      - 'scripts/mulmoclaude/**'
      - '.github/workflows/mulmoclaude_smoke.yaml'
  push:
    branches: [main]
  workflow_dispatch: {}   # manual trigger from the release PR

permissions:
  contents: read

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22.x
          cache: yarn
      - run: yarn install --frozen-lockfile --network-timeout 120000
      - run: yarn build:packages
      - run: yarn build
      - name: Run publish smoke
        run: node scripts/mulmoclaude/smoke.mjs
      - name: Upload launcher log on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: mulmoclaude-launcher-log
          path: /tmp/mc-ci/launcher.log
          if-no-files-found: ignore
```

`paths:` filter means PRs that only touch `docs/`, `e2e/`, or an unrelated bridge don't burn CI minutes. The `push: main` trigger plus artifact upload is the safety net — if a merge-queue race breaks main, the next push catches it and the log artifact shows exactly why.

## Decisions

- **Ubuntu-only matrix** — Windows + macOS don't buy anything here. The tarball install path is pure Node, and setup-node normalizes the environment. If a Windows-specific regression ever appears, add a second cell; don't pay for it by default.
- **`npm publish --dry-run` is NOT sufficient** — it only validates the file list, not that the installed package actually boots. Our three traps all pass `--dry-run`.
- **Skip the full `yarn test` step** — the existing `lint_test` job already covers unit tests across the matrix. The smoke job's job is specifically "tarball → running app", not re-running tests.
- **The driver fails fast** — if §1 fails, don't spend 30 s packing and installing before reporting. Each stage runs in sequence and exits non-zero immediately.

## Migration

- [ ] Step 1: extract `scripts/mulmoclaude/deps.mjs` (§1 logic), unit-test it against fixtures in `test/scripts/mulmoclaude/`.
- [ ] Step 2: extract `scripts/mulmoclaude/drift.mjs` (§2 logic), ditto.
- [ ] Step 3: extract `scripts/mulmoclaude/tarball.mjs` (§4 pack + install + poll), ditto.
- [ ] Step 4: wire them together in `scripts/mulmoclaude/smoke.mjs`.
- [ ] Step 5: add `.github/workflows/mulmoclaude_smoke.yaml`, verify it runs green on the PR that introduces it.
- [ ] Step 6: intentionally break each trap (one PR per trap, dev-only) to confirm the workflow catches it. Delete the intentionally-broken PRs once verified.
- [ ] Step 7: update `.claude/skills/publish-mulmoclaude/SKILL.md` §1 / §2 / §4 to say "CI runs this on every PR — before a release, just re-run the latest `mulmoclaude_smoke` job to confirm main is green."

## Out of scope for this plan

- Publishing — remains human-driven.
- `@mulmobridge/*` cascade publishing — the drift check here *flags* it; the actual publish is still manual (the skill's §2 bump step).
- Matrix expansion to Node 24 / Windows / macOS — can be added later without rework since the driver script is platform-agnostic.
- Caching `mulmoclaude-*.tgz` across workflow runs — premature until CI minutes become an issue.
