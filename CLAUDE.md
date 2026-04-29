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

### Lint warnings — drive them toward zero

`yarn lint` runs at error-strict for most rules. A handful are kept at `warn` because graduating them to error would force a noisy cleanup and risk regressions. Treat warnings as a backlog, not a baseline.

- **Reduce them.** When you touch a file, fix any warnings in it that are mechanically safe (`prefer-destructuring` auto-fix, missing `return undefined`, etc.). Don't leave a warning behind in code you just edited.
- **Per-line `eslint-disable-next-line` is intentional.** When you see one with a `--` rationale (e.g. `vue/no-v-html`, `no-unmodified-loop-condition`, `no-script-url` test fixtures, `no-new` URL/Intl probes, `no-loop-func` Mocha closures), it has been audited. **Never remove these comments during refactors** — they encode a trust decision. If the surrounding code changes shape, port the disable to the new line; don't drop it.
- **`vue/no-v-html` specifically.** Every `v-html` in this repo (NewsView, markdown/View, spreadsheet/View, textResponse/View, wiki/View) feeds from `marked.parse` or `XLSX.utils.sheet_to_html` over app-owned data — all intentional, all suppressed at the call site. If you add a new `v-html`, audit the data source and add the same comment with a one-sentence rationale; do NOT silence the rule globally.
- **For multi-line elements**, `eslint-disable-next-line` only reaches one line. Use a `<!-- eslint-disable <rule> -->` … `<!-- eslint-enable <rule> -->` pair around the element instead.

### GitHub posts

NEVER escape backticks with `\`` in `gh` commands. Use single-quoted heredoc (`<<'EOF'`).

### UI controls — standard height and spacing

Top-bar and panel-header controls share one sizing language. Use these exact classes when adding or editing a control that sits in a chrome row (anything outside the canvas itself):

- **Icon-only button** (bell, settings, lock, toggle, `+`): `h-8 w-8 flex items-center justify-center rounded` — 32px square.
- **Icon + label pill** (launcher buttons, role selector, tabs): `h-8 px-2.5 flex items-center gap-1` — 32px tall with 10px horizontal padding and 4px icon-to-label gap.
- **Row container** (outer wrapper holding multiple control groups): `flex items-center gap-2 px-3 py-2` — 8px between groups, 12/8 outer padding.
- **Icon-cluster group** (a run of adjacent icon-only buttons like lock/bell/settings): `flex gap-0.5` — 2px gap, tight but still visibly separated.

Do NOT introduce new heights (`h-7`, `h-9`, `py-1.5`, etc.) or new gap values for chrome controls. The logo in `SidebarHeader` is the one sanctioned exception — it escapes row padding via negative margins (`-my-3.5`) because it's a brand mark, not a control.

### UI references — anchor to testids and components

Big-picture ASCII layouts of the major surfaces (top chrome, NotificationBell, /chat, /calendar, /automations, /wiki, /sources, /todos, /files) live at [`docs/ui-cheatsheet.md`](docs/ui-cheatsheet.md). Use it for:

- **Naming a UI region in chat / PR / issue text**: prefer `[notification-badge]` / `<CalendarView>` / `(:wiki)` over "the bell" / "the calendar widget" / "the wiki page" — names are greppable, prose is not.
- **Onboarding context**: when proposing UI changes, point at the matching block to disambiguate which component / route is in scope.

When you rename a `data-testid`, restructure a layout, or add a new top-level surface, **update the matching ASCII block in `docs/ui-cheatsheet.md` in the same PR** — same discipline as updating tests when changing API. Out-of-date layout art is worse than no art; if you can't update it cleanly, delete the stale block instead of leaving it.

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
