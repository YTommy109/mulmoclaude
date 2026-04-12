# CLAUDE.md

This file provides guidance to Claude Code when working with the MulmoClaude repository.

## Project Overview

MulmoClaude is a text/task-driven agent app with rich visual output. It uses **Claude Code Agent SDK** as the LLM core and **gui-chat-protocol** as the plugin layer.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

See `plan/mulmo_claude.md` for the full design plan.

## Key Commands

- **Dev server**: `npm run dev` (runs both client and server concurrently)
- **Lint**: `yarn lint` / **Format**: `yarn format` / **Typecheck**: `yarn typecheck` / **Build**: `yarn build`

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

Set via `WORKSPACE_PATH` env var (defaults to `cwd()`). All data lives as plain Markdown + YAML frontmatter files:

```
workspace/
  chat/           ← session ToolResults (one .jsonl per session)
  chat/index/     ← per-session title/summary cache (chat indexer)
  todos/          ← todo items
  calendar/       ← calendar events
  wiki/           ← wiki pages + assets
  summaries/      ← journal output (daily/ + topics/ + archive/)
  memory.md       ← distilled facts always loaded as context
```

## Key Files

| File | Purpose |
|---|---|
| `server/agent.ts` | Agent loop, MCP server creation per role |
| `server/routes/agent.ts` | `POST /api/agent` → SSE stream |
| `server/journal/` | Workspace journal (daily + optimization passes) |
| `server/chat-index/` | Per-session summarizer + sidebar title cache |
| `server/utils/` | Shared helpers: `fs.ts`, `errors.ts` |
| `server/csrfGuard.ts` | CSRF origin-check middleware |
| `src/config/roles.ts` | Role definitions |
| `src/tools/index.ts` | Plugin registry |
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
- Honour the `sonarjs/cognitive-complexity` threshold (warn at >15). Split rather than suppress.

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

Periodically audit for duplication (`sonarjs/no-duplicate-string` warnings, `jscpd`). Batch low-risk extractions into a single refactor PR (as #145 did).

### Files: one concept per file

- Name files for the concept they contain — **not** generic `utils.ts` / `helpers.ts` / `common.ts` (conflict magnets).
- Split at ~500 lines or when two concepts are touched independently by parallel PRs.
- No re-export barrel files (`index.ts` that re-exports siblings) without specific reason.

### Directories: the name is the contract

Looking at a directory name should predict what's inside:

```
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
  plugins/<name>/ ← one dir per plugin (definition, index, View, Preview)
  tools/          ← plugin registry + types
  types/          ← shared type definitions
  utils/          ← grouped by concern (dom/, format/, path/, role/)

test/             ← mirrors source layout 1:1
plans/            ← one file per feature/refactor/fix
```

- Group by *what files are about*, not file kind. `src/plugins/wiki/` keeps def/index/View/Preview together.
- Mirror source layout in `test/`. `server/journal/dailyPass.ts` → `test/journal/test_dailyPass.ts`.
- Prefer a new named directory over dropping files into the closest pre-existing bucket.

## Tech Stack

- **Frontend**: Vue 3 + Tailwind CSS v4
- **Agent**: `@anthropic-ai/claude-agent-sdk`
- **Plugin protocol**: `gui-chat-protocol`
- **Server**: Express.js (SSE streaming)
- **Storage**: Local file system (plain Markdown files)
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
