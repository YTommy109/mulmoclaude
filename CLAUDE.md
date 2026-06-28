# CLAUDE.md

This file provides guidance to Claude Code when working with the MulmoClaude repository.

## Project Overview

MulmoClaude is a text/task-driven agent app with rich visual output. It uses **Claude Code Agent SDK** as the LLM core and **gui-chat-protocol** as the plugin layer. Shared code is published as `@mulmobridge/*` npm packages under `packages/`.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

## Key Commands

- **Dev server**: `npm run dev` (runs both client and server concurrently)
- **Lint**: `yarn lint` / **Format**: `yarn format` / **Typecheck**: `yarn typecheck` / **Build**: `yarn build`
- **Unit tests**: `yarn test` (node:test, server handlers + utils)
- **E2E tests**: `yarn test:e2e` (Playwright, browser UI tests — no backend needed)

**IMPORTANT**: After modifying any source code, always run `yarn format`, `yarn lint`, `yarn typecheck`, and `yarn build` before considering the task done.

**IMPORTANT**: Always write error handling for all `fetch` calls. Handle both network errors (try/catch) and HTTP errors (`!response.ok`).

## Key Rules (always apply)

### Shared utilities — check before reinventing

Before writing a new helper, scan [`docs/shared-utils.md`](docs/shared-utils.md). If a similar helper exists, use it. When you add a new shared helper, append a 1-line entry to that catalog **in the same PR**. Skipping this is how `truncate()` ended up with 6 implementations (#1304).

### Constants — no magic literals

- **Time**: NEVER use raw numbers (`1000`, `60000`, `3600000`). Import from `server/utils/time.ts`
- **Strings**: scheduler types, event types, API routes, tool names — use existing `as const` objects
- **Paths**: use `WORKSPACE_PATHS` / `WORKSPACE_DIRS` / `WORKSPACE_FILES` — never hardcode

### File I/O — domain modules only

NEVER use raw `fs.readFile` / `fs.writeFile` in route handlers. Use `server/utils/files/<domain>-io.ts`. All writes go through `writeFileAtomic`.

### Network I/O — centralized helpers

- **Frontend → Server**: use `src/utils/api.ts` (`apiGet`, `apiPost`, etc.) — auto-attaches bearer token
- **MCP → Server**: use `postJson()` with `AUTH_HEADER`
- **Server → External**: use `AbortController` for timeouts, check `response.ok`

### Cross-platform

- Build paths with `node:path` (`path.join`, `path.resolve`) — NEVER concatenate `/`
- Atomic writes: tmp file alongside destination, not in `os.tmpdir()`
- Package exports: include `"require"` and `"default"` conditions (Docker CJS mode)

### Code style

- Functions under 20 lines; split into smaller functions if needed
- `const` over `let`; never `var`
- Extract pure logic into exported helpers for testability
- Honour `sonarjs/cognitive-complexity` threshold (error at >15)
- No re-export barrel files without specific reason

### GitHub posts

NEVER escape backticks with `\`` in `gh` commands. Use single-quoted heredoc (`<<'EOF'`).

### Error-recovery know-how — keep `error-recovery.md` in sync

When you (or a PR you're reviewing) adds a new diagnostic / fix for a recurring failure mode — sandbox auth, build ordering, plugin install, anything the agent might hit at runtime — also add a section (or extend an existing one) in [`packages/core/assets/helps/error-recovery.md`](packages/core/assets/helps/error-recovery.md). The agent reads that file BEFORE asking the user a clarifying question on a tool failure (see the "When a tool call fails" section in `server/prompts/system/system.md`), so know-how that lives only in a PR description / commit message / `docs/` is invisible to it. Bump `@mulmoclaude/core` whenever `assets/helps/*` changes (it ships to npm via `files: ["dist", "assets"]`).

### Edit-time deeper rules (read when relevant)

- **Lint warnings + `eslint-disable` etiquette** → [`docs/lint-policy.md`](docs/lint-policy.md)
- **UI control sizes + chrome row layout** → [`docs/ui-controls.md`](docs/ui-controls.md)
- **UI region naming + testid discipline + when to update layout art** → [`docs/ui-cheatsheet.md`](docs/ui-cheatsheet.md) (also the source of truth for the ASCII layout map)
- **i18n (all 8 locales in lockstep, add / rename / remove keys, new locale registration)** → [`docs/i18n.md`](docs/i18n.md)

## Package dependency direction (always apply)

The monorepo has three package families. **Dependencies flow in ONE direction only** — violating this creates uphill imports, parallel-build races, and the tier-ordering dance that #1789 / #1795 had to dismantle.

```
                       ▲ depends on
                       │
        host           │   (server/, src/, packages/mulmoclaude)
        ──────         │
        plugins        │   (packages/plugins/*-plugin)
        ──────         │
   shared core         │   (@mulmoclaude/core — formerly the 7 packages/services/*)
                       │
        no deps        │   (leaf libs: @mulmobridge/protocol, @receptron/task-scheduler, etc.)
                       │
```

**Rules:**

- A **plugin** (`packages/plugins/<name>-plugin`) MAY import `@mulmoclaude/core/<subpath>` (or any leaf lib). It MUST NOT import another `*-plugin`. Cross-plugin sharing goes through core.
- **Shared core** (`@mulmoclaude/core` — provides `./collection`, `./collection/server`, `./collection-watchers`, `./skill-bridge`, `./notifier`, `./scheduler`, `./whisper`, `./whisper/client`, `./workspace-setup`, `./workspace-setup/slug`, `./file-change-publisher`) MUST NOT import any `*-plugin`. If a plugin owns code that core / another plugin needs, **pull it OUT of the plugin into core** (the `isSafeActionTemplatePath` / `discoverCollections` extraction in #1795 is the canonical pattern), don't import uphill.
- **Browser-safe surfaces of core** stay on dedicated subpaths (`@mulmoclaude/core/whisper/client`, `@mulmoclaude/core/workspace-setup/slug`). Everything else under `@mulmoclaude/core/*` is server-only.
- **Host** (`server/`, `src/`, `packages/mulmoclaude`) MAY import anything below it. Host code stays generic — provider-specific code belongs in the relevant plugin, not in `server/`.

When the build complains "Cannot find module `@mulmoclaude/foo`" cold, the cause is almost always an uphill or peer import. **Don't patch with a new tier or a `--first=foo` flag** — surface the import and move the code instead. Plan record: [`plans/done/refactor-shared-core.md`](plans/done/refactor-shared-core.md).

## Server Logging

Use `log.{error,warn,info,debug}(prefix, msg, data?)`. Never call `console.*` directly. Full reference: [`docs/logging.md`](docs/logging.md).

## Architecture (quick map)

| File | Purpose |
|---|---|
| `server/agent/index.ts` | Agent loop, MCP server creation |
| `server/agent/mcp-server.ts` | stdio JSON-RPC MCP bridge |
| `server/api/routes/agent.ts` | `POST /api/agent` → SSE stream |
| `server/workspace/paths.ts` | Workspace path constants |
| `server/utils/time.ts` | Time constants + timeout presets |
| `src/config/apiRoutes.ts` | API endpoint path constants |
| `src/config/roles.ts` | Role definitions |
| `src/App.vue` | Main UI |

Full layout + workspace tree + process map: [`docs/developer.md`](docs/developer.md).

## When you do certain tasks (read the dedicated doc)

| Task | Doc |
|---|---|
| **Create or edit a plugin** | [`docs/plugin-development.md`](docs/plugin-development.md) (built-in + runtime, scaffold sync, host aggregators, "extract shared code into core" recipe) |
| **Add a workspace package, debug a tier order issue** | [`docs/build-orchestration.md`](docs/build-orchestration.md) |
| **Release the app** (`vX.Y.Z`) | `/release-app` skill |
| **Publish `mulmoclaude` to npm** | `/publish-mulmoclaude` skill |
| **Publish a shared `@mulmoclaude/*` or `@mulmobridge/*` npm package** | `/publish` skill — tag `@scope/name@X.Y.Z` (no `v`), GH release with `--latest=false` |
| **Add / write an e2e test** (mock or live) | [`docs/developer.md#e2e-testing-playwright`](docs/developer.md#e2e-testing-playwright) for mock, [`docs/e2e-live-testing.md`](docs/e2e-live-testing.md) for live (must-read before adding a `e2e-live/tests/*.spec.ts`) |
| **Manual-test scenarios that can't be automated** | [`docs/manual-testing.md`](docs/manual-testing.md) |
| **Reference the centralised constants** (`API_ROUTES`, `TOOL_NAMES`, `WORKSPACE_DIRS`, `PUBSUB_CHANNELS`, `EVENT_TYPES`, `SCHEDULE_TYPES`) | [`docs/developer.md#centralized-constants`](docs/developer.md#centralized-constants). For the four plugin-aware aggregators, edit the plugin's `meta.ts` — never the host record. |

## exe.dev 固有の変更（upstream merge 時に維持すること）

このリポジトリは https://github.com/receptron/mulmoclaude のフォーク。
upstream merge でコンフリクトした場合は以下の変更を exe.dev 側に保つ。

| ファイル | 変更内容 | 理由 |
|---------|---------|------|
| `server/index.ts` L276–285 | `sandboxEnabled` 時の Docker ブリッジ IP 二次リスナー | Docker コンテナ内 MCP → ホスト HTTP の到達性確保 |
| `server/docker.ts` | `getDockerBridgeIp()` | docker0 インターフェースの取得（Node の networkInterfaces が DOWN を無視するため） |
| `server/csrfGuard.ts` | `isAllowedOrigin()`, `EXTRA_ALLOWED_ORIGINS`, `EXTRA_ALLOWED_HOSTS` | exe.dev リバースプロキシ経由アクセスの CSRF 許可 |
| `vite.config.ts` | `VITE_PORT` / `VITE_ALLOWED_HOSTS` の env 読み取り | exe.dev ポート要件（デフォルト 8000）とホスト名の外部化 |
| `e2e/playwright.config.ts` | `VITE_PORT` からのポート読み取り | テスト環境ポートの統一 |
| `server/agent/config.ts` `buildCliArgs()` | `--disallowedTools Task` を `--permission-prompt-tool` と同時に渡す | Task サブエージェントは `--mcp-config` を継承しないため `handlePermission` を解決できず exit-1 になる |

### upstream merge の手順

```bash
git fetch upstream
git log upstream/main ^main --oneline   # 差分を確認
git merge upstream/main
# コンフリクト解決（上記テーブルを参照）
yarn format && yarn lint && yarn typecheck && yarn build
```
