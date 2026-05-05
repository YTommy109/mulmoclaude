# `create-mulmoclaude-plugin` CLI (PR1 of #1159)

Scaffold a new MulmoClaude runtime plugin with one command:

```bash
npx create-mulmoclaude-plugin my-plugin
```

The CLI lives in `packages/create-mulmoclaude-plugin/` (workspace
package, published to npm). Output is a self-contained plugin
directory the user can `cd` into and `yarn install && yarn build`.

## What the user gets

A `my-plugin/` directory with:

- `package.json` — name set to the user's argument; `peerDependencies`
  on `gui-chat-protocol` / `vue` / `zod` aligned with the bookmarks-
  plugin reference; `main` / `exports` / `files` / `scripts` ready
  for npm publish.
- `tsconfig.json` / `vite.config.ts` / `eslint.config.mjs` / `.gitignore`
  matching the in-tree plugin convention (mirrors bookmarks-plugin).
- `README.md` — dev loop walkthrough (build, link to mulmoclaude,
  reload on change, publish).
- `src/`
  - `index.ts` — server entry: `definePlugin` factory with one
    sample action (`incrementCounter`) using `files.data` and
    `pubsub.publish`.
  - `definition.ts` — `TOOL_DEFINITION` with the matching schema.
  - `vue.ts` — browser entry exporting `{ toolDefinition,
    viewComponent }`.
  - `View.vue` — minimal Vue SFC using `useRuntime()` to dispatch
    the action and subscribe to the pubsub channel.
  - `shims-vue.d.ts` — Vue SFC type shim for `tsc --noEmit`.
  - `lang/{en,ja,index}.ts` — plugin-local i18n via the runtime's
    `locale` ref.

The sample is a counter (~80 LOC of plugin code) — interactive
enough to exercise read / write / pubsub / dispatch, small enough
that the user can rename and reshape without fighting boilerplate.

## CLI behavior

Single positional argument: the plugin name.

```bash
npx create-mulmoclaude-plugin notes-plugin
npx create-mulmoclaude-plugin @example/cool-plugin
```

Validates against npm package-name rules (lowercase, optional `@scope/`
prefix, hyphens, no spaces, length ≤ 214). Refuses to overwrite an
existing directory. The package name in `package.json` is set to the
argument verbatim; everything else stays as the counter sample.

No interactive prompts (Phase 1). The CLI prints next steps:

```
✓ Created notes-plugin/

Next:

  cd notes-plugin
  yarn install
  yarn build

  # Link into mulmoclaude for local dev (PR2 will replace this with
  # a UI install-from-path mode):
  yarn link
  cd ../mulmoclaude && yarn link notes-plugin

  # Publish when ready:
  npm publish
```

## Implementation

```
packages/create-mulmoclaude-plugin/
  package.json                 — declares `bin: { "create-mulmoclaude-plugin": "./dist/index.js" }`
  tsconfig.json
  src/
    index.ts                   — CLI entry: parse argv, validate, write
    validate.ts                — pure name validator
    template.ts                — template file table (path → content)
  test/
    test_validate.ts           — happy / boundary / reject cases
    test_template.ts           — every entry has expected placeholder slots
    test_create.ts             — integration: spawn CLI in mkdtemp, assert tree
  README.md
```

The template files live as **string constants in `template.ts`** rather
than as separate files on disk. Reasons:

1. `tsc --noEmit` would lint template `.vue` / `.ts` files and trip
   on `{{PLUGIN_NAME}}` placeholders.
2. The eslint preset `plugin-imports-banned` would flag the template's
   `gui-chat-protocol` import (templates aren't real source).
3. Bundling the CLI to a single `dist/index.js` is simpler when the
   template is inline.

The trade-off is that template edits require re-typing the source as a
string literal. With ~10 template files and ~300 total LOC of template
content, this is acceptable.

## Placeholders

Only one substitution: `{{PLUGIN_NAME}}` → the user's argument.

Substituted in:
- `package.json` `name` field
- `README.md` for example commands
- `vite.config.ts` build output names (where applicable — usually not
  needed because `lib.entry` already names them)

Everything else (tool name, action names, file names) stays as the
counter sample. The user renames as they evolve their plugin.

## Out of scope (future PRs)

- Runtime loader local-path install (PR2 of #1159)
- Settings UI for installed-plugin reload (PR3 of #1159)
- Hot reload (deferred; vite HMR through the runtime loader is non-
  trivial)
- Interactive prompt mode (Phase 2 if there's demand)
- Different template flavours (e.g. UI-less plugin, bridge plugin) —
  one template = one cognitive load; specialise later

## Tests

- `validate.ts` — accepts unscoped / scoped / hyphenated; rejects
  spaces, uppercase, overlong, empty, leading dot, etc.
- `template.ts` — every template entry referencing `{{PLUGIN_NAME}}`
  produces a non-empty string after substitution.
- Integration — run the CLI in an `mkdtemp`'d directory, assert
  every expected file is present and contains the correct package
  name. Skip the actual `yarn install / yarn build` (CI-expensive
  and not what the CLI is responsible for).

## Publish flow

The CLI itself ships via the existing `/publish` skill. First release:
`create-mulmoclaude-plugin@0.1.0`. Tag style follows
`@scope/name@X.Y.Z` per project convention; this one is unscoped, so
the tag is `create-mulmoclaude-plugin@0.1.0`.
