# Plan: Plugin runtime — `tasks` + `chat` (Phase 1 of Encore)

Companion to [`feat-encore-vision.md`](./feat-encore-vision.md). This PR is the **prerequisite host extension** that Encore (and any future plugin) needs. Encore itself ships in a follow-up PR.

## Goal

Extend `MulmoclaudeRuntime` (the host's superset of `gui-chat-protocol`'s `PluginRuntime`) with two new scoped capabilities:

1. **`runtime.tasks.register({ schedule, run })`** — register **one** periodic server-side callback against the host task manager (`server/events/task-manager/index.ts`).
2. **`runtime.chat.start({ initialMessage, role? })`** — open a new normal chat seeded with a plugin-supplied first message. Returns `{ chatId }`.

Validate end-to-end via the existing `packages/debug-plugin/`. **No new plugin in this PR. No `gui-chat-protocol` bump.** Encore lands in a follow-up PR; the upstream into `gui-chat-protocol@0.4.0` is Phase 3.

## Why this seam

The runtime is already the contract surface between host and plugin: `runtime.pubsub`, `runtime.files`, `runtime.log`, `runtime.fetch`, and `runtime.notifier` (host extension, see `server/notifier/runtime-api.ts`) are all scoped per plugin via that object. Both new capabilities follow the same pattern — declared in setup, namespaced to the calling plugin's pkg name, no `node:fs` / `setInterval` / direct host-API access from plugin code.

The "one master heartbeat per plugin" cap and "seed a chat with an instruction prompt" pattern are general — they're not Encore-specific. Once they exist, any plugin can use them.

## API contracts

### `runtime.tasks`

```ts
// server/plugins/runtime-tasks-api.ts (new)
export type TaskSchedule =
  | { type: "interval"; intervalMs: number }
  | { type: "daily"; time: string }; // "HH:MM" UTC

export interface TasksRuntimeApi {
  /** Register the plugin's single periodic tick. The host task manager
   *  fires `run()` on schedule. Throws on the second call within the
   *  same plugin (cap-at-1). No `unregister()` — reload-from-scratch
   *  covers the lifecycle.
   *
   *  - `schedule` is forwarded verbatim to the host task manager. No
   *    richer types layered at the runtime level — plugins build
   *    "remind 3 weeks before" / "weekly on Tuesdays" logic inside
   *    `run()` against their own files.
   *  - The registry id is `plugin:<pkg>`; the plugin does not supply
   *    one (cap-at-1 makes it redundant).
   *  - `run()` errors are caught and logged by the host task manager
   *    (existing behavior, `task-manager/index.ts:89`). They do not
   *    propagate. */
  register: (task: { schedule: TaskSchedule; run: () => Promise<void> }) => void;
}
```

Cap-at-1 falls out of the host task manager's existing duplicate-id throw (`task-manager/index.ts:138`). We wrap with a friendlier error so the plugin author sees `"Plugin <pkg> already registered a task — only one tick per plugin allowed"` rather than the raw internal id collision.

### `runtime.chat`

```ts
// server/plugins/runtime-chat-api.ts (new)
export interface ChatRuntimeApi {
  /** Open a new chat seeded with `initialMessage` as the first user
   *  turn. Claude responds to it as if the user sent it; the user sees
   *  it visually marked as plugin-originated when they open the chat
   *  (see UI section below).
   *
   *  Default `role` is `"general"`. The chat is permanent — appears in
   *  the user's chat list like any other. No cap on calls per plugin.
   *
   *  Returns the new chat session id; pair with
   *  `runtime.notifier.publish({ navigateTarget: `/chat/${chatId}`, ... })`
   *  so the user can land on it. */
  start: (input: { initialMessage: string; role?: string }) => Promise<{ chatId: string }>;
}
```

Implementation routes through the existing `startChat()` (`server/api/routes/agent.ts:134`):

```ts
// inside makeScopedChat(pkgName)
async start({ initialMessage, role = "general" }) {
  const chatSessionId = randomUUID();
  const result = await startChat({
    message: initialMessage,
    roleId: role,
    chatSessionId,
    origin: `plugin:${pkgName}`,        // tags the session as plugin-seeded
  });
  if (result.kind === "error") {
    throw new Error(`runtime.chat.start failed: ${result.error}`);
  }
  return { chatId: chatSessionId };
}
```

`origin: "plugin:<pkg>"` already exists on `StartChatParams` (`agent.ts:116`) — we just start populating it from this code path so the UI can key off it.

### `MulmoclaudeRuntime`

```ts
// server/notifier/runtime-api.ts — extend the existing type
export type MulmoclaudeRuntime = PluginRuntime & {
  notifier: NotifierRuntimeApi;
  tasks: TasksRuntimeApi;   // NEW
  chat: ChatRuntimeApi;     // NEW
};
```

Plugin authors continue casting (`runtime as MulmoclaudeRuntime`) until Phase 3 upstreams the shape.

## File-by-file changes

### Host (server)

| # | File | Change |
|---|---|---|
| 1 | `server/plugins/runtime-tasks-api.ts` (new) | Define `TaskSchedule`, `TasksRuntimeApi` types |
| 2 | `server/plugins/runtime-chat-api.ts` (new) | Define `ChatRuntimeApi` types |
| 3 | `server/notifier/runtime-api.ts` | Extend `MulmoclaudeRuntime` to include `tasks` + `chat`; re-export the new APIs |
| 4 | `server/plugins/runtime.ts` | Add `makeScopedTasks(pkgName, taskManager)` + `makeScopedChat(pkgName)` factories. Pass `taskManager` into `MakePluginRuntimeDeps`; wire both into the returned object alongside the existing `notifier` |
| 5 | `server/plugins/runtime-loader.ts` | On plugin unload (dev-watcher path), call `taskManager.removeTask("plugin:<pkg>")` so a hot-reload doesn't trip the duplicate-id throw |
| 6 | `server/index.ts` | Plumb the existing `taskManager` instance into `makePluginRuntime` deps |

### Smoke test (debug-plugin)

| # | File | Change |
|---|---|---|
| 7 | `packages/debug-plugin/src/index.ts` | (a) During `setup()`, call `tasks.register({ schedule: { type: "interval", intervalMs: 60_000 }, run })` — the `run` logs a tick and (when toggled) publishes a notification. (b) Add two new arg variants to the discriminated union: `{ kind: "chat-start", initialMessage, role? }` and `{ kind: "tick-toggle", on: boolean }` for runtime control. |
| 8 | `packages/debug-plugin/src/definition.ts` | Add the new arg shapes to the JSON schema |
| 9 | `packages/debug-plugin/package.json` | Bump version |

The debug-plugin file already declares itself as the "integration bed for upcoming host features" (`debug-plugin/src/index.ts:2-4`) — this is the natural place.

### Frontend (Vue) — plugin-seeded message marker

When a chat session has `origin === "plugin:<pkg>"`, the **first user turn** is rendered with a distinct visual treatment so the user can tell it came from a plugin, not from them.

| # | File | Change |
|---|---|---|
| 10 | `src/components/chat/Message.vue` (or equivalent) | Read `origin` from session meta; when first user turn matches plugin origin, render a small chip (`from <pkg>`) above the bubble + a muted background variant. Reuse existing severity-color token language; do **not** invent a new color scale. |
| 11 | `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` | Add `chat.pluginSeededFromTag` ("from {pkg}") in all 8 locales |

Treatment is intentionally minimal — chip + background tweak, not a separate message kind. The message is still a normal user turn in the jsonl; only the rendering changes.

## Out of scope (explicitly)

- **Encore plugin itself** — separate PR
- **`gui-chat-protocol@0.4.0` upstream** — Phase 3, after Encore validates the API in production
- **Notifier changes** — current API (`publish`/`clear`, action lifecycle) is sufficient per design discussion
- **Top-level workspace data folders** — not needed; plugins use `runtime.files.data` (`~/mulmoclaude/data/plugins/<pkg>/`), per `docs/plugin-runtime.md:345`
- **Multiple tasks per plugin** — capped at 1 by design; revisit when a real consumer needs more
- **`unregister()`** — skip; plugin reload covers the lifecycle
- **Conditional-trigger UI for Encore** — that's Encore's plugin code, not host

## Test plan

### Unit

- `server/plugins/runtime.test.ts`
  - `tasks.register()` registers with host task manager under `plugin:<pkg>`
  - Second `tasks.register()` from same plugin throws with friendly error
  - `chat.start()` creates a new session, returns `{ chatId }`, calls `startChat` with `origin: "plugin:<pkg>"` and the supplied role (default `"general"`)
  - `chat.start()` propagates `startChat` errors as thrown exceptions

### Integration (manual via debug-plugin)

| Scenario | Steps | Expected |
|---|---|---|
| Tick fires | Start dev server, watch debug-plugin logs | One log line per minute: `plugin/debug-plugin tick` |
| Cap-at-1 | Edit debug-plugin to call `tasks.register` twice; restart | Plugin load fails with friendly error in plugin diagnostics bell |
| Hot-reload doesn't double-register | Touch debug-plugin source while server is running | Old task removed, new task registered, no duplicate-id throw |
| Plugin-seeded chat | Invoke `manageDebug({ kind: "chat-start", initialMessage: "Ask me what day it is." })` | New chat appears in chat list; opening it shows the initial message marked `from debug-plugin`; Claude has already responded asking what day it is |
| Plugin-seeded chat with role | Same, with `role: "developer"` | Chat starts in developer role |

### Lint / typecheck / build

- `yarn format && yarn lint && yarn typecheck && yarn build`
- `yarn test` — covers the new unit tests
- `yarn test:e2e` — confirm chat UI changes don't regress existing tests; add one new E2E that verifies the chip renders for plugin-origin sessions

## Risks / open questions

1. **Hot-reload cleanup path.** If `runtime-loader.ts` doesn't currently have a clean "unload" hook, item #5 above is non-trivial. If we have to add one, the PR grows. **Mitigation:** if the hook isn't there, ship without hot-reload cleanup; document that dev-watcher reloads require a server restart for plugins that use `tasks.register`. This is a dev-only annoyance.
2. **Initial-message phrasing is the plugin author's responsibility.** A poorly-written initial prompt produces a confusing first chat turn. We document the pattern in `docs/plugin-runtime.md` (see follow-up section below) but otherwise trust plugin authors.
3. **Visual treatment language.** The chip + muted-background design needs a quick pass with the cheatsheet (`docs/ui-cheatsheet.md`). If a designer disagrees, we adjust before merge — not a blocker.
4. **Test debug-plugin's tick across restarts.** If the smoke-test tick is enabled by default, every dev server fires a notification every minute. **Mitigation:** debug-plugin's tick is OFF by default and toggled via the new `tick-toggle` action; only fires log lines until enabled.

## Follow-ups (out of this PR's scope)

- **Phase 2 — `packages/encore-plugin/`.** The Encore plugin itself: data model under `~/mulmoclaude/data/plugins/encore-plugin/`, MCP tool for chat-driven setup (`presentForm`-pattern), tick handler scanning obligations + posting action notifications, `chat.start` for conditional triggers, `View.vue` / `Preview.vue`, all 8 locales.
- **Phase 3 — `gui-chat-protocol@0.4.0` upstream.** Move `tasks`, `chat`, and `notifier` into the protocol's `PluginRuntime`; drop the cast across all consumers (`bookmarks-plugin`, `debug-plugin`, `recipe-book-plugin`, `spotify-plugin`, `todo-plugin`, `encore-plugin`).
- **`docs/plugin-runtime.md` update.** Add a "Tick + chat-seeding" section after the existing notifier section, with one worked example each.
