# feat: migrate todo to runtime-plugin shape (#1145)

Move the built-in `todo` plugin (Vue + server + io + lang + config + workspace dirs all spread across the repo) to the colocated runtime-plugin shape that bookmarks (`packages/bookmarks-plugin/`) already uses, so the boundary becomes one workspace package and the runtime-plugin pattern has a richer reference than bookmarks.

Spec issue: [#1145](https://github.com/receptron/mulmoclaude/issues/1145)

## Why this is split into 5 PRs

todo is ~2300 LOC across 12 files. A single PR would be unreviewable. The runtime-plugin loader's collision policy (static plugins win over runtime plugins of the same `TOOL_DEFINITION.name`) lets us keep both old and new code coexisting during the chain — the new (runtime) plugin is dormant until the old (static) one is removed in PR5.

## PR1 (this PR's branch: `feat/todo-plugin-pr1-1145`)

### Scope

Scaffold `packages/todo-plugin/` following the bookmarks pattern. Register as a preset (`server/plugins/preset-list.ts`) so it loads on every dev/prod boot. Empty / no-op handler to start; behaviour is unchanged because the static plugin keeps winning the name collision.

### Files

```
packages/todo-plugin/
├── package.json                    @mulmoclaude/todo-plugin
├── tsconfig.json
├── vite.config.ts                  vue + dts, externals: vue + gui-chat-protocol/vue
├── eslint.config.mjs               extends gui-chat-protocol/eslint-preset
└── src/
    ├── index.ts                    definePlugin factory; handler returns { ok: false, error: "not yet migrated" }
    ├── definition.ts               TOOL_DEFINITION (name: "manageTodoList" as const)
    ├── shims-vue.d.ts              Vue SFC shim
    └── View.vue                    placeholder; not actually mounted
```

### Acceptance for PR1

- [ ] `packages/todo-plugin/` builds (`yarn build` in workspace)
- [ ] Boot log: `[plugins/runtime] registered runtime plugins ...userInstalled=2 ...collisions=0` (bookmarks + todo, no name collision because runtime-vs-static collision is policy-handled silently)
- [ ] Existing todo behaviour identical (LLM tool calls work, View renders, multi-tab sync works) — proven by the existing test suite + manual smoke
- [ ] `yarn typecheck / lint / build / test / e2e` all green
- [ ] No `node:fs` / `node:path` / `console` references in plugin source

## PR2〜5 outline

See issue #1145.

PR2: items handler logic. PR3: columns + dispatch. PR4: frontend View migration. PR5: delete old + data migration script.

## Open design questions for PR2

- **Action discriminator name**: dispatch handler will switch on `kind` like bookmarks does. The LLM-callable surface comes from `manageTodoList`'s arg shape (one entry point); the View's many REST calls collapse into the same dispatch with different `kind`s. Need to enumerate every action the View calls today and assign `kind` names.
- **Data migration shape**: `~/mulmoclaude/data/todos/todos.json` becomes `~/mulmoclaude/data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json` (URL-encoded scoped name; same convention as bookmarks). Migration script moves files; doesn't touch JSON shape.

## Out of scope

- npm publish (workspace-only)
- Migrating other built-in plugins
- Touching accounting (separate plan, #1110)
