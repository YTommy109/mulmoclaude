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

### i18n — all 8 locales in lockstep

Supported UI locales live under `src/lang/`: `en.ts`, `ja.ts`, `zh.ts`, `ko.ts`, `es.ts`, `pt-BR.ts`, `fr.ts`, `de.ts`. `src/lang/en.ts` is the schema source of truth; `typeof enMessages` is threaded through `createI18n` in `src/lib/vue-i18n.ts`, so `vue-tsc` treats every missing or extra key as a type error.

When adding, renaming, or removing any i18n key:

- MUST update **all 8** locale files in the same PR — NEVER land a change that only touches `en.ts` and defers the other locales "for later" (this breaks CI and every downstream branch)
- MUST keep the key order consistent across locales so diffs stay readable
- MUST translate the new string properly in each locale (do not just copy the English value) — placeholders like `{count}` / `{error}` / `{sizeMB}` stay verbatim
- Product / brand / role names stay in English (Claude, MulmoClaude, Docker, General, Office, etc.)
- When registering a new locale, update `SUPPORTED_LOCALES`, the `Locale` union, and the `messages` map in `src/lib/vue-i18n.ts` together
- When introducing a new UI string, extract it to `src/lang/en.ts` first (do NOT hardcode in templates) — `$t()` / `useI18n().t` is the only acceptable source

## Releases

See `/release-app` skill for app releases. See `/publish` skill for npm packages.

- App tags: `vX.Y.Z` (with `v` prefix)
- Package tags: `@scope/name@X.Y.Z` (no `v` prefix)
- MUST update `docs/CHANGELOG.md` before tagging
- Package releases: `--latest=false` on `gh release create`

## Architecture (summary)

Full reference: [`docs/developer.md`](docs/developer.md)

### Key structure

```text
server/          ← agent/, api/, workspace/, events/, system/, utils/
packages/        ← @mulmobridge/* npm packages (yarn workspaces)
src/             ← Vue 3 frontend (components/, composables/, plugins/, config/)
test/            ← mirrors source layout 1:1
e2e/             ← Playwright E2E tests + fixtures
plans/           ← feature plans (move to plans/done/ when PR lands)
```

### Workspace layout (`~/mulmoclaude/`)

```text
config/          ← settings.json, mcp.json, roles/, helps/
conversations/   ← chat/, memory.md, summaries/
data/            ← wiki/, todos/, calendar/, scheduler/, sources/
artifacts/       ← charts/, documents/, html/, images/, spreadsheets/
```

### Key files

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

## Plugin Development

Full reference: [`docs/developer.md`](docs/developer.md#plugin-development)

Adding a **local plugin** updates 8 places: `definition.ts`, `index.ts`, `server/api/routes/<name>.ts`, `server/agent/mcp-server.ts`, `src/tools/index.ts`, `src/config/roles.ts`, `server/agent/index.ts`, `src/config/apiRoutes.ts`.

## Centralized Constants

Full table: [`docs/developer.md`](docs/developer.md#centralized-constants)

Key ones to remember:

| What | Source of truth |
|---|---|
| API routes | `src/config/apiRoutes.ts` → `API_ROUTES` |
| Event types | `src/types/events.ts` → `EVENT_TYPES` |
| Workspace paths | `server/workspace/paths.ts` → `WORKSPACE_PATHS` |
| Time | `server/utils/time.ts` → `ONE_SECOND_MS` / `ONE_MINUTE_MS` / `ONE_HOUR_MS` |
| Scheduler | `@receptron/task-scheduler` → `SCHEDULE_TYPES` / `TASK_RESULTS` |

## Testing

### E2E (Playwright)

Full reference: [`docs/developer.md`](docs/developer.md#e2e-testing-playwright)

- Use `data-testid` for element selection (name by function, not position)
- Call `mockAllApis(page)` before `page.goto()`
- Reusable interactions in `e2e/fixtures/chat.ts`

### Manual testing

Scenarios that can't be automated: [`docs/manual-testing.md`](docs/manual-testing.md)


## Server Logging

Full reference: [`docs/logging.md`](docs/logging.md)

Use `log.{error,warn,info,debug}(prefix, msg, data?)`. Never call `console.*` directly.

## Tech Stack

- **Frontend**: Vue 3 + Tailwind CSS v4
- **Agent**: `@anthropic-ai/claude-agent-sdk`
- **Plugin protocol**: `gui-chat-protocol`
- **Server**: Express.js (SSE streaming)
- **Storage**: Local file system (plain Markdown files)
- **E2E Testing**: Playwright (Chromium)
- **Language**: TypeScript throughout

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

### upstream merge の手順

```bash
git fetch upstream
git log upstream/main ^main --oneline   # 差分を確認
git merge upstream/main
# コンフリクト解決（上記テーブルを参照）
yarn format && yarn lint && yarn typecheck && yarn build
```
