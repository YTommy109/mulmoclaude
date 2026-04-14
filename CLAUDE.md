# CLAUDE.md

This file provides guidance to Claude Code when working with the MulmoClaude repository.

## Project Overview

MulmoClaude is a text/task-driven agent app with rich visual output. It uses **Claude Code Agent SDK** as the LLM core and **gui-chat-protocol** as the plugin layer.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

See `plan/mulmo_claude.md` for the full design plan.

## Key Commands

- **Dev server**: `npm run dev` (runs both client and server concurrently)
- **Lint**: `yarn lint` / **Format**: `yarn format` / **Typecheck**: `yarn typecheck` / **Build**: `yarn build`
- **Unit tests**: `yarn test` (node:test, server handlers + utils)
- **E2E tests**: `yarn test:e2e` (Playwright, browser UI tests — no backend needed)
- **E2E single file**: `yarn test:e2e -- tests/smoke.spec.ts`
- **E2E headed**: `yarn test:e2e -- --headed` (opens browser for debugging)

**IMPORTANT**: After modifying any source code, always run `yarn format`, `yarn lint`, `yarn typecheck`, and `yarn build` before considering the task done.

**IMPORTANT**: Always write error handling for all `fetch` calls. Handle both network errors (try/catch) and HTTP errors (`!response.ok`). Surface errors to the user in the UI where appropriate.

## Architecture

### LLM Core

The agent loop runs via `runAgent()` in `server/agent.ts`. Claude decides autonomously which tools to use — built-in file tools or gui-chat-protocol plugins registered as MCP servers. The MCP server (`server/mcp-server.ts`) is a stdio JSON-RPC bridge spawned by the Claude CLI via `--mcp-config`.

### Plugin Layer

Plugins follow the gui-chat-protocol standard (`ToolDefinition`, `ToolResult`, `ViewComponent`, `PreviewComponent`). Plugin registry: `src/tools/index.ts`. Plugin types: `src/tools/types.ts`.

### Roles

Defined in `src/config/roles.ts`. A role defines a persona (system prompt), a plugin palette (`availablePlugins[]`), and a context reset on switch. **MCP servers are created per role switch** — only the current role's plugins are registered.

### Server → Client Communication

SSE from `POST /api/agent`: `{ type: "status" | "tool_result" | "error", ... }`.

### Workspace

Hard-coded to `~/mulmoclaude/` (see `server/workspace.ts:11`). There is **no `WORKSPACE_PATH` env override**; changing the location requires a code edit or a symlink. Full directory layout is documented in [`docs/developer.md`](docs/developer.md#workspace-layout-mulmoclaude); the short version:

```text
~/mulmoclaude/
  chat/           ← session ToolResults (one .jsonl per session)
  chat/index/     ← per-session title/summary cache (chat indexer)
  todos/          ← todo items
  calendar/       ← calendar events
  wiki/           ← wiki pages + assets
  configs/        ← web Settings UI (settings.json, mcp.json)
  summaries/      ← journal output (daily/ + topics/ + archive/)
  memory.md       ← distilled facts always loaded as context
```

### Routing (vue-router, history mode)

URL-based navigation via `vue-router` (history mode — clean paths, no `#`). The router manages session, view mode, and (in future phases) file path, result UUID, and role in the URL.

**URL scheme** (see #108 for full plan):

```text
/                                          → /chat redirect
/chat                                      → new session, single view
/chat/:sessionId                           → existing session, single view
/chat/:sessionId?view=stack                → stack view
/chat/:sessionId?view=files                → files view
/chat/:sessionId?view=files&path=wiki/foo  → files view + file selected (future)
```

**Key pattern — ref + bidirectional sync**: `router.push` is async, so state that must be readable synchronously (e.g. `currentSessionId`, `canvasViewMode`) is kept as a plain `ref`. The ref is the source of truth for reads; `router.push`/`router.replace` keeps the URL in sync. A `watch` on route params/query handles external URL changes (back/forward button, typed URL).

**Navigation guards** (`src/router/guards.ts`): `beforeEach` validates all URL params (sessionId format, view whitelist) and strips invalid values via `router.replace`.

**`navigateToSession`** in `App.vue` uses `buildViewQuery()` (from `useCanvasViewMode`) instead of raw `route.query` for the view param — this avoids a stale-query race when `setCanvasViewMode` and `navigateToSession` are called in the same synchronous block.

## Key Files

| File | Purpose |
|---|---|
| `server/agent.ts` | Agent loop, MCP server creation per role |
| `server/routes/agent.ts` | `POST /api/agent` → SSE stream |
| `server/journal/` | Workspace journal (daily + optimization passes) |
| `server/chat-index/` | Per-session summarizer + sidebar title cache |
| `server/utils/` | Shared helpers: `fs.ts`, `errors.ts` |
| `server/logger/` | Structured logger (console + rotating file + telemetry stub) |
| `server/csrfGuard.ts` | CSRF origin-check middleware |
| `src/config/roles.ts` | Role definitions |
| `src/tools/index.ts` | Plugin registry |
| `src/router/index.ts` | Vue-router setup (history mode, route definitions) |
| `src/router/guards.ts` | Navigation guards (param validation + sanitize) |
| `src/composables/useCanvasViewMode.ts` | View mode state — URL sync via router, localStorage fallback |
| `src/App.vue` | Main UI — sidebar + canvas + role switcher |

## Plugin Development

Each plugin is a `ToolPlugin` (from `gui-chat-protocol/vue`, extended in `src/tools/types.ts`): `toolDefinition` + `execute()` + `viewComponent` + `previewComponent`.

### Adding a package plugin (`@gui-chat-plugin/*` or `@mulmochat-plugin/*`)

Import the canonical `TOOL_DEFINITION` directly — **do not copy or re-type the schema**. Update **4 places**:

1. `server/mcp-server.ts` — import and add to `TOOL_ENDPOINTS` + `ALL_TOOLS`
2. `src/tools/index.ts` — register in the `plugins` map using `TOOL_NAME` as key
3. `src/config/roles.ts` — add to relevant role's `availablePlugins`
4. `server/agent.ts` — add to `MCP_PLUGINS`

Route handler goes in `server/routes/plugins.ts`.

### Adding a local plugin (`src/plugins/<name>/`)

Local plugins import Vue components, so `toolDefinition` must be in a **separate file** (`definition.ts`) to allow server-side imports without pulling in Vue. Update **7 places**: `definition.ts`, `index.ts`, `server/routes/<name>.ts`, `server/mcp-server.ts`, `src/tools/index.ts`, `src/config/roles.ts`, `server/agent.ts`.

> If a plugin is in `availablePlugins` but absent from `MCP_PLUGINS` or `ALL_TOOLS`, it will be silently dropped.

> The key in `src/tools/index.ts` must exactly match the tool's `name` field.

## Express Route Type Safety

MUST use Express generics to type route handlers — NEVER use `as` casts on `req.body`, `req.params`, or `req.query`.

```typescript
// GOOD — fully typed
router.post("/items/:id", (req: Request<MyParams, unknown, MyBody>, res: Response) => { ... });

// BAD — untyped, requires casts
router.post("/items/:id", (req: Request, res: Response) => { const x = req.body as MyBody; });
```

- NEVER cast `req.query` — use `typeof req.query.x === "string" ? req.query.x : undefined`
- Use type annotation (`const data: MyType = JSON.parse(raw)`) instead of `as` cast

## Code Organization

The repo runs several PRs in flight at once. Code that sprawls across large functions or monolithic files creates expensive merge conflicts. Keep units small so parallel PRs touch different blocks.

### Functions: small, pure, extractable

- Extract pure logic into exported helpers so unit tests can exercise them without a harness. Examples: `parseRange` / `classify` / `isSensitivePath` in `server/routes/files.ts`, `normalizeTopicAction` / `computeJustCompletedSessions` in `server/journal/dailyPass.ts`.
- Prefer discriminated-union return types (`{ kind: "skipped", reason } | { kind: "processed", ... }`) over null / thrown errors for multi-outcome helpers.
- Honour the `sonarjs/cognitive-complexity` threshold (**error at >15** in `.ts` / `.js`; temporarily **warn** in `.vue` until pre-existing violations like `App.vue#sendMessage` at 47 and `spreadsheet/View.vue` at 163 are refactored). Split rather than suppress.

### Linting covers .vue files

`eslint-plugin-vue` + `vue-eslint-parser` are enabled (`eslint.config.mjs`). The `.vue` override block at the end of the config:

- demotes `vue/multi-word-component-names` to off — the `View` / `Preview` component names are the MulmoClaude plugin convention
- demotes `sonarjs/cognitive-complexity`, `sonarjs/slow-regex`, and `vue/no-v-html` to **warn** because pre-existing violations would otherwise block CI
- keeps `vue/attributes-order` / `vue/attribute-hyphenation` as warn (auto-fixable)

Each warn-level rule is a follow-up target — when all violations in `.vue` are fixed, re-raise to `error` in the override block. The goal is parity with `.ts` files.

### DRY: eliminate duplication aggressively

When the same 3+ line pattern appears in two or more files, extract a shared helper immediately — don't wait for a third copy. Place helpers in named files under the right directory (`server/utils/fs.ts`, not inlined in the first consumer). Before writing new boilerplate, grep the codebase — it probably already exists in `server/utils/` or `src/utils/`.

Key shared helpers in this repo:

| Helper | Location |
|---|---|
| `resolveWithinRoot(root, relPath)` | `server/utils/fs.ts` |
| `errorMessage(err)` | `server/utils/errors.ts` |
| `statSafe` / `readDirSafe` | `server/utils/fs.ts` |
| `dispatchResponse(res, result)` | `server/routes/dispatchResponse.ts` |
| `useFreshPluginData(opts)` | `src/composables/useFreshPluginData.ts` |
| `useCanvasViewMode(opts)` | `src/composables/useCanvasViewMode.ts` |
| `applyViewToQuery(query, mode)` | `src/composables/useCanvasViewMode.ts` |

Periodically audit for duplication (`sonarjs/no-duplicate-string` warnings, `jscpd`). Batch low-risk extractions into a single refactor PR (as #145 did).

### Files: one concept per file

- Name files for the concept they contain — **not** generic `utils.ts` / `helpers.ts` / `common.ts` (conflict magnets).
- Split at ~500 lines or when two concepts are touched independently by parallel PRs.
- No re-export barrel files (`index.ts` that re-exports siblings) without specific reason.

### Directories: the name is the contract

Looking at a directory name should predict what's inside:

```text
server/
  agent/          ← agent-loop (config, prompt, stream)
  chat-index/     ← per-session summarizer + manifest
  journal/        ← workspace journal (daily + optimization)
  routes/         ← one file per /api/* surface
  task-manager/   ← cron-like task runner
  utils/          ← shared helpers, one file per concept

src/
  components/     ← shared Vue components
  composables/    ← Vue 3 composables
  config/         ← static config (roles, system prompts)
  router/         ← vue-router setup + navigation guards
  plugins/<name>/ ← one dir per plugin (definition, index, View, Preview)
  tools/          ← plugin registry + types
  types/          ← shared type definitions
  utils/          ← grouped by concern (dom/, format/, path/, role/)

test/             ← mirrors source layout 1:1
e2e/              ← Playwright E2E tests + fixtures
plans/            ← one file per feature/refactor/fix
```

- Group by *what files are about*, not file kind. `src/plugins/wiki/` keeps def/index/View/Preview together.
- Mirror source layout in `test/`. `server/journal/dailyPass.ts` → `test/journal/test_dailyPass.ts`.
- Prefer a new named directory over dropping files into the closest pre-existing bucket.

## E2E Testing (Playwright)

Browser-based tests in `e2e/`. No backend server required — all `/api/*` calls are intercepted with `page.route()` and served from fixtures.

### Structure

```text
e2e/
  playwright.config.ts    ← Chromium-only, auto-starts vite dev client
  fixtures/
    api.ts                ← mockAllApis(page) — shared API mock helper
    sessions.ts           ← session data fixtures
  tests/
    smoke.spec.ts         ← app loads, input works
    router-guards.spec.ts ← URL injection defence
```

### Writing tests

1. Call `await mockAllApis(page)` before `page.goto()` — it intercepts all API routes
2. Use `data-testid` attributes for element selection (change-resistant)
3. Use URL assertions for router behaviour (`expect(page.url()).toContain(...)`)
4. Override specific API responses per test by adding a `page.route()` AFTER `mockAllApis` (Playwright checks last-registered first)

### When to add E2E coverage

**Whenever a `.vue` component is modified**, consider whether the change needs a new E2E test. Unit tests cover the extracted pure helpers; E2E tests are the regression safety-net for the Vue component's wiring (template bindings, event handlers, reactive state flow, router integration). Concrete triggers:

- Touching `src/App.vue` — almost always add / extend a scenario in `e2e/tests/chat-flow.spec.ts` (the refactor flow).
- Touching a plugin's `View.vue` / `Preview.vue` — add or extend the plugin-specific spec (e.g. `file-explorer.spec.ts`, `image-plugins.spec.ts`).
- Adding a new route or changing guard logic — `router-navigation.spec.ts` / `router-guards.spec.ts`.
- Changing SSE event handling, session loading, or sidebar session merging — `chat-flow.spec.ts` already exercises these; add a case if a new event type / selection rule / merge path is introduced.

Skip if the change is purely cosmetic (Tailwind class tweaks, copy fixes, emoji swaps) with no behavioural path touched.

### Gotchas

- **Route order is reversed**: Playwright checks routes last-registered-first. Register catch-all FIRST, specific routes AFTER.
- **URL predicate functions > globs**: `**/api/roles` doesn't reliably match `http://host/api/roles`. Use `(url) => url.pathname === "/api/roles"` instead.
- **Hash vs history mode**: Tests that assert URL query params behave differently between hash mode (`/#/chat?view=x`) and history mode (`/chat?view=x`). Write tests against the rendered UI state rather than raw URL strings when possible.

## Manual Testing

Some behaviours can't be covered by E2E — drag-and-drop via `vuedraggable` / Sortable, HTML canvas pixel state, iframe-sandboxed content, LLM-driven agent flows that require a real backend, etc. Those live in [`docs/manual-testing.md`](docs/manual-testing.md), which is the single source of truth for the out-of-E2E surface.

**Contract for PRs**:

- MUST update [`docs/manual-testing.md`](docs/manual-testing.md) whenever a change deliberately leaves a scenario uncovered by E2E — add an entry with the flow, the reason it can't be automated, and how to smoke-check it.
- MUST remove / strike-through an entry when a change brings a previously-manual scenario under E2E coverage.
- Per-PR smoke-test notes go in the PR description, NOT in this doc. The doc is for *persistent* manual-test obligations only.

See `plans/` entries and past PR descriptions (#193 wiki-backlinks, #195 tool-trace, #209 todo-items-crud) for examples of cleanly separating "E2E covers this" from "manual check after each release covers this".

## Server Logging

The server uses the structured logger at `server/logger/`. **Never call `console.*` directly outside that module** — import and use `log.{error,warn,info,debug}(prefix, msg, data?)` instead.

```ts
import { log } from "../logger/index.js";

log.info("my-module", "did a thing", { count: 3 });
log.error("my-module", "operation failed", { error: String(err) });
```

- `prefix` is lowercase, hyphenated, no brackets (the text formatter adds `[ ]`)
- Put structured values in the `data` payload, not interpolated into `msg` — the JSON file format depends on it
- Console default is `info`/`text`; file default is `debug`/`json` rotating daily under `server/logs/`
- Full reference (env vars, formats, rotation, recipes): [`docs/logging.md`](docs/logging.md)

The only remaining `console.*` call is `server/logger/sinks.ts`'s fallback path for when the file sink itself errors.

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
