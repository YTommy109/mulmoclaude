# Auto-reload on dev plugin changes (PR3 of #1159)

PR1 (#1163) shipped the scaffold CLI. PR2 (#1167) made `--dev-plugin
<path>` boot-load a plugin from the author's project dir. The remaining
manual step in the dev loop is `⌘R` after every `yarn build`.

PR3 closes that loop: when the watched `dist/` changes, the browser
auto-reloads.

## Surface

No new CLI flag. `--dev-plugin <path>` automatically gets a watcher.

```bash
# Terminal A
cd my-plugin && yarn dev      # vite build --watch keeps dist/ fresh

# Terminal B
mulmoclaude --dev-plugin ./my-plugin
```

Per code change: editor save → vite rebuild → server detects change →
**browser auto-reloads** → updated plugin runs. No keyboard intervention.

## Implementation

### Server: `server/plugins/dev-watcher.ts` (new)

`watchDevPlugins(plugins, opts) → { close: () => void }` —

- For each plugin, `fs.watch(plugin.cachePath/dist, { recursive: true })`
  using `node:fs` (built-in, no new dep)
- Debounce 300 ms per plugin (vite writes 4-5 files within ~100 ms; one
  reload per burst is enough)
- On stable burst, call `opts.publish(plugin.name, { changedFiles })`
- Detect when `dist/index.js` is among the changed files and log a
  prominent hint via `opts.warnServerSideChange(plugin.name)` —
  Node ESM can't bust the cached server-side import, so the dev
  needs to restart mulmoclaude for `definePlugin` factory edits to
  take effect. The browser reload still happens (it's the cheap
  cleanup; no harm if dev only changed server code).
- Return a `close()` that closes every watcher (called from graceful
  shutdown)

The publish/warn callbacks are injected so tests can drive the watcher
without a live pubsub or mulmoclaude logger.

### Pubsub channel: `src/config/pubsubChannels.ts`

Add to `HOST_STATIC_CHANNELS`:

```ts
devPluginChanged: "dev-plugin-changed",
```

Payload shape: `{ name: string, version: string, changedFiles: string[] }`.

### Server wiring: `server/index.ts`

After `evaluateDevPluginGate(...)` succeeds, attach the watcher:

```ts
const watcher = watchDevPlugins(devGate.plugins, {
  publish: (name, payload) =>
    pubsub.publish(PUBSUB_CHANNELS.devPluginChanged, { name, ...payload }),
  warnServerSideChange: (name) =>
    log.warn("plugins/dev", `${name}: dist/index.js changed — restart mulmoclaude to pick up server-side changes`),
});
// On gracefulShutdown: watcher.close()
```

### Client: `src/composables/useDevPluginReload.ts` (new)

Subscribes to `PUBSUB_CHANNELS.devPluginChanged` once at app boot,
calls `window.location.reload()` on every event. Single-line composable
behind `usePubSub`.

Mount via `src/main.ts` immediately after `usePubSub` is wired.

## Tests

### Unit: debouncer

- Inject a fake clock + manual event emitter
- Burst 5 events within 100 ms → expect 1 publish
- Burst, wait 400 ms, burst again → expect 2 publishes
- `dist/index.js` in the burst → expect `warnServerSideChange` called once

### Integration: real fs.watch (Linux/macOS only — gated)

- `mkdtempSync` + write `dist/index.js` + `dist/vue.js`
- Start the watcher with a recording publish
- `writeFileSync(dist/vue.js, "new content")` → wait 500 ms → assert one
  publish recorded
- Skip on Windows runner because `fs.watch` recursive on Windows fires
  events differently and can flake; the unit test covers the platform-
  independent debounce logic

### Smoke: extend `tarball.mjs` (optional, defer if cost too high)

The existing `--dev-plugin` smoke boots and probes the runtime list.
PR3 could extend it to:
- Modify `dist/vue.js` after boot
- Subscribe to the WebSocket and assert a `dev-plugin-changed` arrives

Defer if the WS integration in the smoke driver costs too much. The
unit + integration tests already cover the watcher contract.

## Acknowledged limitations

- **Server-side `dist/index.js` is not hot-replaced.** Node's ESM cache
  has no public invalidation API. The watcher publishes on every
  dist/ change; the browser reload picks up View.vue / browser-side
  changes immediately, but a `definePlugin` factory edit needs a
  full mulmoclaude restart. The server log explicitly says so when
  `dist/index.js` is in the changed set.
- **No state preservation.** Full `location.reload()` discards Vue
  component state. Real HMR (state-preserving) is significant
  additional work — defer until there's demand.
- **No opt-out flag.** `--no-auto-reload` could be added if a dev
  reports auto-reload is disruptive, but starting default-on for
  the simpler dev loop.

## README updates

- `packages/create-mulmoclaude-plugin/README.md` — drop the line
  about manual ⌘R, mention auto-reload as the default behavior
- `packages/mulmoclaude/README.md` — `--dev-plugin` section gets a
  one-liner about auto-reload + the server-side restart caveat

## Out of scope (future)

- True HMR (Vue component re-mount with state)
- WebSocket-side reconnect debounce (existing reconnect logic is
  already battle-tested for sessions / notifications)
- Per-plugin reload (only the changed plugin instead of full page)
