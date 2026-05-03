# feat: runtime plugin platform extensions (#1110)

Build the platform extensions documented in [#1110](https://github.com/receptron/mulmoclaude/issues/1110) so that plugin authors can write rich plugins (multi-action + persistent + multi-tab live sync + i18n) entirely as installable npm packages.

**This PR scope: API + docs + Bookmarks sample only.** The accounting plugin migration is deliberately out of scope — that lands as a separate PR series later (PR2 〜 PR5 in the issue's migration plan).

Authoritative spec: [issue #1110 latest spec comment](https://github.com/receptron/mulmoclaude/issues/1110#issuecomment-4364716681). Anything in this plan that conflicts with the spec — the spec wins.

## Cross-repo work

This change spans **two repos** (we own both):

1. `~/ss/llm/gui-chat-protocol/` — add `definePlugin`, `useRuntime`, `eslint-preset`. Publish as v0.3.0. Backward-compatible: old `(context, args)` shape keeps working.
2. `~/ss/llm/mulmoclaude5/` — implement `makePluginRuntime` (server) + `ScopedRoot` (frontend) + path normalization + sample Bookmarks plugin under `packages/bookmarks-plugin/`.

Development order (shortest feedback loop first):

1. Extend `gui-chat-protocol` (no publish yet — `yarn link` from mulmoclaude during dev)
2. Implement server `makePluginRuntime` + loader factory detection
3. Implement frontend `ScopedRoot` + browser runtime
4. Build `packages/bookmarks-plugin/` end-to-end
5. Tests + docs
6. Once the loop works, publish `gui-chat-protocol@0.3.0`, bump in mulmoclaude `package.json`, commit, open PR
7. Bookmarks plugin extraction to its own repo lands in a follow-up PR (out of scope for this one)

## API surface (recap)

### `gui-chat-protocol` additions

- **`definePlugin<T>(setup: (runtime: PluginRuntime) => T): (runtime: PluginRuntime) => T`** — identity function for type inference. Same philosophy as `defineComponent`.
- **`PluginRuntime`** type (server): `pubsub`, `locale`, `files: { data, config }`, `log`, `fetch`, `fetchJson`, `notify`.
- **`FileOps`** type for `data` / `config`: `read / readBytes / write / readDir / stat / exists / unlink`. All paths POSIX-relative.
- **`BrowserPluginRuntime`** type (frontend): `pubsub`, `locale: Ref<string>`, `log`, `openUrl`, `notify`.
- **`PLUGIN_RUNTIME_KEY: InjectionKey<BrowserPluginRuntime>`** + **`useRuntime()`** composable.
- **`gui-chat-protocol/eslint-preset`** subpath export with `no-restricted-imports` (fs / path) + `no-console`.

Backward compatibility:
- Existing `ToolPluginCore.execute: (context, args) => Promise<ToolResult>` signature stays untouched.
- Plugins that export the old shape (`mod[TOOL_DEFINITION.name] = (ctx, args) => ...`) still work.
- New plugins use `export default definePlugin(...)` which the loader detects and treats differently.

### mulmoclaude server additions

- `WORKSPACE_PATHS.pluginsData` = `~/mulmoclaude/data/plugins/`
- `WORKSPACE_PATHS.pluginsConfig` = `~/mulmoclaude/config/plugins/`
- `server/plugins/runtime.ts` (new) — `makePluginRuntime(pkgName, host) → PluginRuntime`
  - Scoped pubsub: `publish(name, payload)` → `host.publish(\`plugin:${pkgName}:${name}\`, payload)`
  - `files.data` / `files.config`: each FileOps method runs `normalize(rel) → ensureInsideBase(absolute, scopeRoot)` before disk I/O
  - Path normalization: `\` → `/`, `path.posix.normalize`, then `path.posix.resolve(scopeRoot, normalized)` — accepts plugin code that misuses `node:path` on Windows but rejects traversal
  - `writeFileAtomic` reused from `server/utils/files/atomic.ts`
  - `log` wraps `server/system/logger` with prefix `plugin/${pkgName}`
  - `fetch` wraps `globalThis.fetch` with `AbortController` + `timeoutMs` (default 10s) + optional `allowedHosts` check (URL.hostname must match)
  - `fetchJson` = `fetch` + `response.json()` + optional `parse: (raw) => T` (Zod-agnostic; plugin can pass `(raw) => Schema.parse(raw)`)
  - `notify` publishes to `PUBSUB_CHANNELS.notifications` with the host's existing payload shape
- `server/plugins/runtime-loader.ts` modification — detect factory-shape: if `mod.default` is a function (not object), call it with `makePluginRuntime(plugin.name, host)` and the result becomes the plugin module.

### mulmoclaude frontend additions

- `src/utils/plugin/runtime.ts` (new) — `makeBrowserPluginRuntime(pkgName, hostWS, hostI18n) → BrowserPluginRuntime`
  - Scoped pubsub: `subscribe(name, handler)` → `hostWS.subscribe(\`plugin:${pkgName}:${name}\`, handler)`
  - `locale: Ref<string>` derived from `i18n.global.locale` (already a `WritableComputedRef`)
  - `log` → `console.*` (in production, may route to host log channel)
  - `openUrl` → `window.open(url, "_blank", "noopener,noreferrer")`
  - `notify` → publishes to host notifications channel (frontend symmetry with server's `notify`)
- `src/components/PluginScopedRoot.vue` (new) — wraps a plugin's component subtree, calls `provide(PLUGIN_RUNTIME_KEY, runtime)`
- `src/plugins/runtime.ts` (or update existing dynamic loader) — when mounting a runtime plugin's `viewComponent`, wrap it in `<PluginScopedRoot :pkg-name="..." :runtime="...">`

### packages/bookmarks-plugin

- New workspace package, not published initially
- `package.json`: `"name": "@mulmoclaude/bookmarks-plugin"` (placeholder; will rename when extracting)
- `src/index.ts` — server (definePlugin)
- `src/View.vue` — frontend (useRuntime)
- `src/lang/{en,ja}.ts` + `useT` helper
- `eslint.config.mjs` — extends `gui-chat-protocol/eslint-preset`
- Build pipeline (vite library mode) emits `dist/{index.js, vue.js, style.css}`. lang files inlined into `vue.js` via Vue SFC bundling.

## Path normalization contract (永続化対象)

> Per spec: the platform receives plugin-supplied path strings and **always** runs:
>
> 1. Replace `\` with `/` (Windows path.join leak repair)
> 2. `path.posix.normalize` (folds `..`, `.`, double-slash)
> 3. `path.posix.resolve(scopeRoot, normalized)` (absolutize)
> 4. `ensureInsideBase(absolute, scopeRoot)` — throw `Error("path escapes plugin scope")` if outside
>
> Plugin code that uses `node:path` accidentally still works on Windows (because of step 1). Plugin code that tries `"../../etc/passwd"` is rejected.
>
> Implemented once in `server/plugins/runtime.ts:normalizePluginPath` and reused by every FileOps method. Documented in `docs/plugin-runtime.md` "Path conventions" section as the platform contract.

## Test scope

Unit tests (in `test/plugins/`):

- `test_runtime_pubsub.ts` — scoped publish prefixes pkg name; cross-plugin isolation
- `test_runtime_files.ts` — data/config separation; traversal rejection (`../`); Windows backslash repair; atomic write semantics; `exists` returns false for missing
- `test_runtime_fetch.ts` — timeout via AbortController; allowedHosts rejection; non-allowlisted host rejected
- `test_runtime_loader_factory.ts` — old shape (function under TOOL_DEFINITION.name key) still works; new shape (default export is factory) gets runtime injected
- `test_browser_runtime.ts` — useRuntime throws outside provider; openUrl uses noopener; subscribe scopes channel name

Smoke (Bookmarks):

- Install `@mulmoclaude/bookmarks-plugin` (workspace) into ledger
- LLM call: add → list (returns the added bookmark) → remove → list (empty)
- Multi-tab: open two browser tabs of the View, add via tab 1, tab 2 reflects via pubsub.subscribe

Manual (one-shot):

- `~/mulmoclaude/data/plugins/@mulmoclaude/bookmarks-plugin/bookmarks.json` exists after add
- `~/mulmoclaude/config/plugins/@mulmoclaude/bookmarks-plugin/prefs.json` exists after sort change
- Plugin source has zero `node:fs` / `node:path` / `console` references (grep)

## Documentation

Update `docs/plugin-runtime.md`:

1. Replace the existing weather walkthrough with a Bookmarks walkthrough (richer, demonstrates more API surface)
2. Add `## API reference` section with full `PluginRuntime` / `BrowserPluginRuntime` types
3. Add `## Path conventions` section (the contract above, verbatim)
4. Add `## ESLint preset` section with usage example
5. Add `## Action discriminator pattern` section with Zod recipe + `default: never throw` exhaustive
6. Keep weather as a reference link (it stays a working preset for the old shape)

## Out of scope (this PR)

- Accounting plugin migration (#1078) — separate PR series, see issue migration plan PR2〜PR5
- Per-event Zod schema validate-on-publish + publish rate limit — orthogonal additions, can land in this PR if cheap; otherwise follow-up
- Plugin process isolation — separate issue
- Bookmarks plugin extraction to its own repo — follow-up PR after this one merges
- `kv` / `scheduler` / `callPlugin` / `session.id` — not in v1

## Acceptance

- [ ] `gui-chat-protocol@0.3.0` exports `definePlugin` / `useRuntime` / `PluginRuntime` / `BrowserPluginRuntime` / `eslint-preset`
- [ ] `server/plugins/runtime.ts` constructs scoped runtime with all spec'd APIs
- [ ] Path normalization layer rejects traversal and accepts misused `node:path` results
- [ ] `packages/bookmarks-plugin/` builds, registers via runtime ledger, end-to-end works
- [ ] Plugin source has 0 references to `node:fs` / `node:path` / `console` / direct `fetch` (grep clean)
- [ ] `docs/plugin-runtime.md` updated per the section list above
- [ ] `yarn format / lint / typecheck / build / test` clean
- [ ] Existing `@gui-chat-plugin/weather` (old shape) still works as preset (backward compat smoke)

## References

- Issue: #1110
- Spec (authoritative): [latest spec comment](https://github.com/receptron/mulmoclaude/issues/1110#issuecomment-4364716681)
- Related: #1077 (runtime plugin Phase A+B+C), #1078 (manageAccounting reference plugin)
- Cross-repo: receptron/gui-chat-protocol (~/ss/llm/gui-chat-protocol/)
