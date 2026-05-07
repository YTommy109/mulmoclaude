# Plan: `@mulmoclaude/recipe-book-plugin` (PR-A of #1169 Phase 1 Cooking Coach)

Sub-issue: #1175. Parent: #1169 ("Home Application: 8 plugin sets for everyday personal use") — first slice of Phase 1 (Cooking Coach).

## Principle (#1169)

**Plugin code stays in the plugin.** The Home Application plugin sets are also reference samples for plugin authors, so the host side must hold ONLY truly host-level concerns (roles, infra). Per-feature plugins live entirely in `packages/<name>-plugin/` and ship via the runtime-plugin path, mirroring the existing `bookmarks-plugin` / `todo-plugin` / `spotify-plugin` examples.

This rules out the in-tree path (`src/plugins/<name>/` + scattered `server/api/routes/*.ts` + `server/utils/files/*-io.ts` + `server/agent/mcp-server.ts` handler additions) — even though it's how the older plugins still work. New #1169 plugins go runtime-only.

## Decisions (from chat)

1. **Runtime plugin** (option C). Not in-tree.
2. **One plugin per small PR.** PR-A is recipe-book alone; PR-B is fridge + grocery; PR-C is cooked-log + meal-planner + the cookingCoach role's evolution.
3. **Plugin-managed storage.** All recipe data lives under the plugin's `files.data` scope (`~/mulmoclaude/data/plugins/%40mulmoclaude%2Frecipe-book-plugin/recipes/<slug>.md`). Markdown-per-record so a curious user can browse / hand-edit.

## What ships in this PR

A `manageRecipes` tool + canvas Vue View, packaged as `@mulmoclaude/recipe-book-plugin` and bundled as a preset. Plus a new `cookingCoach` host role with the system prompt that frames the assistant.

User flow:
- Switch to **Cooking Coach** role
- "ピーマンの肉詰めのレシピを保存して" / "Save my Mom's lasagna recipe" → Claude calls `manageRecipes({ kind: "save", slug, title, tags?, servings?, prepTime?, cookTime?, body })`
- "保存したレシピを見せて" → list pane / detail pane in canvas
- "豚キムチのレシピを更新して" / "削除して" → same shape

What is NOT in this PR (deferred):
- PR-B: fridge inventory + grocery list runtime plugins
- PR-C: cooked-log + meal-planner + cookingCoach role evolution
- Cross-plugin orchestration ("今日作れる料理は?" reading fridge × recipes)
- Tag-based filter UI
- Recipe import from URLs / photos

## Plugin shape (mirrors `bookmarks-plugin`)

```
packages/recipe-book-plugin/
  package.json           ← peerDeps gui-chat-protocol / vue / zod
  vite.config.ts         ← two bundles: dist/index.js (server), dist/vue.js (browser)
  tsconfig.json
  eslint.config.mjs      ← extends gui-chat-protocol/eslint-preset (bans node:fs / fetch / console)
  src/index.ts           ← definePlugin factory; manageRecipes handler
  src/definition.ts      ← TOOL_DEFINITION (shared by index.ts + vue.ts)
  src/vue.ts             ← exports { plugin: { toolDefinition, viewComponent: View } }
  src/View.vue           ← canvas: list pane + detail pane + delete button
  src/shims-vue.d.ts
  src/lang/{en,ja,index}.ts ← plugin-local i18n via useRuntime().locale
```

### Args (Zod-discriminated)

```ts
const Args = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list") }),
  z.object({ kind: z.literal("save"),   slug, title, tags?, servings?, prepTime?, cookTime?, body }),
  z.object({ kind: z.literal("update"), slug, title, tags?, servings?, prepTime?, cookTime?, body }),
  z.object({ kind: z.literal("delete"), slug }),
]);
```

`servings` / `prepTime` / `cookTime` are `z.number().int().nonnegative().optional()` — the schema rejects decimals and negatives at the boundary so the disk never sees `servings: 2.9` or `cookTime: -5`.

### Storage shape

One markdown file per recipe at `recipes/<slug>.md` inside the plugin's `files.data` scope, with YAML frontmatter:

```markdown
---
title: ピーマンの肉詰め
tags:
  - 和食
  - 主菜
servings: 4
prepTime: 15
cookTime: 20
created: 2026-05-06T...
updated: 2026-05-06T...
---

## 材料
- ピーマン 8個
- 合いびき肉 300g
...

## 手順
1. ピーマンを縦半分に切る
...
```

A tiny inline frontmatter writer / reader handles serialisation — pulling in `js-yaml` for a 6-key scalar/array schema would bloat the bundle. Body is trimmed-trailing-whitespace and gets a trailing newline.

### Concurrency

Per-plugin `withWriteLock(fn)` chain serialises read-modify-write so two parallel save / update / delete calls can't race. Same pattern as bookmarks-plugin (CodeRabbit PR #1124 review).

### Slug rules

`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, length 1-64. Pure ASCII. The plugin re-implements the rule (rather than depending on `server/utils/slug.ts` from the host) because the principle bans host imports — the plugin must work standalone.

## Host changes (deliberately tiny)

| File | Change |
|---|---|
| `server/plugins/preset-list.ts` | One row added: `{ packageName: "@mulmoclaude/recipe-book-plugin" }` |
| `src/config/roles.ts` | New `cookingCoach` role: prompt + queries + `availablePlugins: [TOOL_NAMES.presentForm]` (manageRecipes is auto-included since it's runtime). Plus `BUILTIN_ROLE_IDS.cookingCoach`. |

That's it for host. Zero `src/plugins/recipeBook/`, zero `server/api/routes/recipes.ts`, zero `server/utils/files/recipes-io.ts`, zero `WORKSPACE_DIRS` entry, zero `TOOL_NAMES` change, zero codegen output, zero host i18n keys.

## What didn't survive from the in-tree draft

The earlier in-tree implementation of this PR (commits 56d6e47..e31a5a8 on this branch, force-rewound) shipped:

- `src/plugins/recipeBook/{meta,definition,index,View,Preview}.{ts,vue}` (5 files)
- `server/api/routes/recipes.ts` (REST surface)
- `server/utils/files/recipes-io.ts` (frontmatter IO)
- `server/agent/mcp-server.ts` `handleManageRecipes` MCP bridge
- `src/main.ts` `recipes:` endpoint registry entry
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` `pluginRecipeBook.*` keys (8 locales)
- Codegen output for recipeBook in `src/plugins/_generated/*.ts`
- Test snapshot updates (`test/workspace/test_paths_shape.ts` `cookingRecipes` key)
- Plus per-PR review fixes (numeric validation, ARIA on list rows)

All of that was deleted by the reset. The runtime-plugin reimplementation collapses it into ~12 plugin-local files + 2 host edits.

## Tests

E2E + integration tests for runtime plugins live under `test/plugins/test_<plugin>_integration.ts` (mirroring `test_bookmarks_integration.ts`, `test_todo_plugin_integration.ts`). Deferred to a follow-up so PR-A stays minimal. The Zod schema covers boundary validation for free.

## QA

After merge, the user can:

1. `yarn install` (picks up the new workspace package)
2. `yarn dev`
3. Switch role → **Cooking Coach**
4. "Save my Mom's stuffed peppers recipe" → markdown lands at `~/mulmoclaude/data/plugins/%40mulmoclaude%2Frecipe-book-plugin/recipes/stuffed-peppers.md`
5. "Show my recipes" → canvas opens, list + detail
6. Hand-edit the .md file → reload → changes appear
