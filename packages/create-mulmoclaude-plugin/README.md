# create-mulmoclaude-plugin

Scaffold a new MulmoClaude runtime plugin.

```bash
npx create-mulmoclaude-plugin my-plugin
# or
npx create-mulmoclaude-plugin @example/cool-plugin
```

Creates a directory in the current working directory with a runnable
counter sample plugin: server-side `definePlugin` factory, `View.vue`
canvas component, plugin-local i18n, and the build / lint config the
in-tree reference plugins (`bookmarks-plugin`, `accounting-plugin`,
`todo-plugin`) use.

The output is a starting point — rename the tool, replace the counter
logic with whatever your plugin actually does, ship.

## Output

```text
my-plugin/
  package.json           name set to your argument; peer-deps and scripts ready
  tsconfig.json
  vite.config.ts         two bundles: dist/index.js (server) + dist/vue.js (browser)
  eslint.config.mjs      extends gui-chat-protocol/eslint-preset
  .gitignore
  README.md              dev-loop instructions for your new plugin
  src/
    index.ts             definePlugin factory + sample handler
    definition.ts        TOOL_DEFINITION shared between server + browser
    vue.ts               browser entry: { toolDefinition, viewComponent }
    View.vue             canvas SFC using useRuntime() + dispatch + pubsub
    shims-vue.d.ts
    lang/
      en.ts ja.ts        translation tables
      index.ts           useT() composable reading runtime.locale
```

## Next steps after scaffolding

```bash
cd my-plugin
yarn install
yarn build
```

To develop against MulmoClaude before publishing, the current path is
`yarn link`:

```bash
# In the plugin directory:
yarn link

# In the mulmoclaude monorepo:
yarn link my-plugin
```

A first-class "install from local path" surface is being tracked at
[receptron/mulmoclaude#1159](https://github.com/receptron/mulmoclaude/issues/1159)
PR2 / PR3.

## Why a sample, not an empty plugin

Every line of the counter sample exists because a plugin author
needs to know *how* to do that thing. Boilerplate is fine if it
demonstrates the runtime API surface. The trade-off is a handful of
deletions when you're ready to write your real plugin — small price
for not having to reverse-engineer the API on day one.

## License

MIT
