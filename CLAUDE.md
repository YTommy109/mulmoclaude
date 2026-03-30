# CLAUDE.md

This file provides guidance to Claude Code when working with the MulmoClaude repository.

## Project Overview

MulmoClaude is a text/task-driven agent app with rich visual output. It uses **Claude Code Agent SDK** as the LLM core and **gui-chat-protocol** as the plugin layer.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

See `plan/mulmo_claude.md` for the full design plan.

## Key Commands

- **Development server**: `npm run dev` (runs both client and server concurrently)
- **Client only**: `npm run dev:client`
- **Server only**: `npm run dev:server`
- **Lint**: `npm run lint`
- **Format**: `npm run format`

**IMPORTANT**: Do NOT run build commands (`npm run build`, `npm run preview`) as they create unnecessary build artifacts.

## Architecture

### LLM Core

**Package**: `@anthropic-ai/claude-agent-sdk`

The agent loop runs via `query()` in `server/agent.ts`. Claude decides autonomously which tools to use — built-in file tools (bash, read, write, glob, grep) or gui-chat-protocol plugins registered as MCP servers.

### Plugin Layer

**Package**: `gui-chat-protocol`

Plugins follow the gui-chat-protocol standard (`ToolDefinition`, `ToolResult`, `ViewComponent`, `PreviewComponent`). Each plugin is wrapped as a Claude Code SDK `tool()` and registered via `createSdkMcpServer`.

Plugin registry: `src/tools/index.ts`
Plugin types: `src/tools/types.ts`

### Roles

Defined in `src/config/roles.ts`. A role defines:
- **Persona** — system prompt
- **Plugin palette** — `availablePlugins[]` maps to MCP servers created for that session
- **Context reset** — switching roles always starts a fresh `query()` call

**MCP servers are created per role switch** — only the current role's plugins are registered, keeping Claude's context lean.

### Server → Client Communication

The agent streams results to the frontend via **SSE** (Server-Sent Events) from `POST /api/agent`. Event types:
- `{ type: "status", message }` — agent progress updates
- `{ type: "tool_result", result }` — gui-chat-protocol ToolResult to render in canvas
- `{ type: "error", message }` — error from agent

### Workspace

The app operates on a workspace directory set via `WORKSPACE_PATH` env var (defaults to `cwd()`). All data lives here as plain Markdown + YAML frontmatter files:

```
workspace/
  chat/                   ← session ToolResults (one .jsonl per session)
  todos/                  ← todo items
  calendar/               ← calendar events
  contacts/               ← address book
  memory.md               ← distilled facts always loaded as context
```

## Key Files

| File | Purpose |
|---|---|
| `server/agent.ts` | Claude Code agent loop, MCP server creation per role |
| `server/routes/agent.ts` | POST /api/agent → SSE stream |
| `src/config/roles.ts` | Role definitions |
| `src/tools/index.ts` | Plugin registry |
| `src/tools/types.ts` | ToolPlugin type, MulmoClaudeToolContextApp |
| `src/App.vue` | Main UI — sidebar + canvas + role switcher |

## Plugin Development

Each plugin is a `ToolPlugin` (from `gui-chat-protocol/vue`, extended in `src/tools/types.ts`):
- `toolDefinition` — JSON Schema for Claude's function calling
- `execute()` — runs the plugin, returns a `ToolResult`
- `viewComponent` — Vue component rendered in the canvas
- `previewComponent` — Vue component shown in the sidebar

Adding a new plugin requires updates in **four places** — missing any one will silently break it:

1. **`src/plugins/<name>/index.ts`** — plugin definition (`toolDefinition`, `execute()`, components)
2. **`src/tools/index.ts`** — register in the `plugins` map
3. **`src/config/roles.ts`** — add plugin name to each role's `availablePlugins`
4. **`server/agent.ts`** — add plugin name to `MCP_PLUGINS` set (controls which plugins are exposed to the Claude CLI)
5. **`server/mcp-server.ts`** — add a full entry to `ALL_TOOLS` (name, description, inputSchema, endpoint) so the MCP server can handle the tool call

> Steps 4 and 5 are easy to miss. If a plugin is in `availablePlugins` but absent from `MCP_PLUGINS` or `ALL_TOOLS`, it will be silently dropped and Claude won't see the MCP tool.

## Tech Stack

- **Frontend**: Vue 3 + Tailwind CSS v4
- **Agent**: `@anthropic-ai/claude-agent-sdk`
- **Plugin protocol**: `gui-chat-protocol`
- **Server**: Express.js (SSE streaming)
- **Storage**: Local file system (plain Markdown files)
- **Language**: TypeScript throughout
