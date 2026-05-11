# Plan: Plugin runtime — `tasks` + `chat` (Phase 1 of Encore)

Companion to [`feat-encore-vision.md`](./feat-encore-vision.md). Phase 1 is the **prerequisite host extension** that Encore (and any future plugin) needs. Encore itself ships in Phase 2.

> **Status: shipped (PR #1237, merged 2026-05-08).** This document is the spec of what's available in `MulmoclaudeRuntime` today, kept as the natural reference for Phase 2 (Encore) and Phase 3 (gui-chat-protocol upstream). Updated post-merge to reflect what actually shipped, including the LLM-driven notification-clear pattern that wasn't in the original plan.

## Goal

Extend `MulmoclaudeRuntime` (the host's superset of `gui-chat-protocol`'s `PluginRuntime`) with two new scoped capabilities:

1. **`runtime.tasks.register({ schedule, run })`** — register **one** periodic server-side callback against the host task manager (`server/events/task-manager/index.ts`).
2. **`runtime.chat.start({ initialMessage, role? })`** — open a new normal chat seeded with a plugin-supplied first message. Returns `{ chatId }`.

Validated end-to-end via `packages/debug-plugin/`. **No `gui-chat-protocol` bump.** The cast pattern (`runtime as MulmoclaudeRuntime`) is the contract until Phase 3 upstreams the shape into the protocol's `PluginRuntime`.

## Why this seam

The runtime is already the contract surface between host and plugin: `runtime.pubsub`, `runtime.files`, `runtime.log`, `runtime.fetch`, and `runtime.notifier` (host extension, see `server/notifier/runtime-api.ts`) are all scoped per plugin via that object. Both new capabilities follow the same pattern — declared in setup, namespaced to the calling plugin's pkg name, no `node:fs` / `setInterval` / direct host-API access from plugin code.

The "one master heartbeat per plugin" cap and "seed a chat with an instruction prompt" pattern are general — they're not Encore-specific. Once they exist, any plugin can use them.

## API contracts

### `runtime.tasks`

```ts
// server/plugins/runtime-tasks-api.ts
export type PluginTaskSchedule =
  | { type: "interval"; intervalMs: number }
  | { type: "daily"; time: string }; // "HH:MM" UTC

export interface TasksRuntimeApi {
  /** Register the plugin's single periodic tick. The host task manager
   *  fires `run()` on schedule. Throws on the second call within the
   *  same plugin (cap-at-1). No `unregister()` — server-side plugin
   *  code does not hot-reload, so reload-from-scratch covers the
   *  lifecycle (see "Hot-reload" under Resolved risks).
   *
   *  - `schedule` is forwarded verbatim to the host task manager. No
   *    richer types layered at the runtime level — plugins build
   *    "remind 3 weeks before" / "weekly on Tuesdays" logic inside
   *    `run()` against their own files.
   *  - The registry id is `plugin:<pkg>`; the plugin does not supply
   *    one (cap-at-1 makes it redundant).
   *  - `run()` errors are caught and logged by the host task manager
   *    (`task-manager/index.ts:89`). They do not propagate. */
  register: (task: { schedule: PluginTaskSchedule; run: () => Promise<void> }) => void;
}
```

Cap-at-1 enforced in `makeScopedTasks` via a closure flag (`server/plugins/runtime.ts`) — fires before the host task manager's generic duplicate-id throw so the plugin author sees `"Plugin <pkg> already registered a task — only one tick per plugin is allowed"`.

### `runtime.chat`

```ts
// server/plugins/runtime-chat-api.ts
export interface ChatRuntimeApi {
  /** Open a new chat seeded with `initialMessage` as the first user
   *  turn. Claude responds to it as if the user sent it; the user sees
   *  it visually marked as plugin-originated when they open the chat
   *  (see "Plugin-seeded message marker" below).
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

Implementation routes through the existing `startChat()` (`server/api/routes/agent.ts`) with `origin: "plugin:<pkg>"` so the UI can key off it. Default role `"general"`.

### `MulmoclaudeRuntime`

```ts
// server/notifier/runtime-api.ts
export type MulmoclaudeRuntime = PluginRuntime & {
  notifier: NotifierRuntimeApi;
  tasks: TasksRuntimeApi;
  chat: ChatRuntimeApi;
};
```

Plugin authors continue casting (`runtime as MulmoclaudeRuntime`) until Phase 3 upstreams the shape into `gui-chat-protocol`.

## LLM-driven notification clearing (the pattern Encore uses)

**Not in the original plan but landed in this PR.** The most important runtime-side primitive Encore depends on. Documented here because the technique is non-obvious and the plan is the natural spec for Phase 2 to reference.

### Problem

A plugin posts an action notification ("Did you receive your W-2?"), the user clicks it, lands in a Claude-seeded chat, has a conversation, and at some point Claude needs to **mark the obligation complete and clear the notification**. The host's notifier API is plugin-scoped (`runtime.notifier.clear(id)` only clears notifications the plugin published), and there's no generic LLM-facing notification-clear surface — and there shouldn't be, because that would let the LLM clear unrelated notifications by guessing ids.

### Solution: pending-clear ticket on disk

The plugin **owns the clear via its own MCP tool**. When the plugin creates the chat, it also writes a tiny on-disk ticket keyed by an opaque `pendingId`, and embeds that id in the seed prompt. The LLM passes the id back when calling the plugin's tool; the tool reads the ticket, clears the notification, and unlinks the ticket.

```
flow:
  1. Plugin button click / tick → notifier.publish(action, navigateTarget="/some-page?notificationId=...")
  2. User clicks notification → page mounts in "ask-user-store" mode with notificationId in URL
  3. Page calls plugin's `chat-start-and-store` dispatch:
       - plugin generates pendingId = randomUUID()
       - plugin writes data/plugins/<pkg>/pending-clear/<pendingId>.json = { notificationId }
       - plugin builds seed prompt embedding pendingId as a literal string
       - plugin calls runtime.chat.start({ initialMessage, role })
       - returns { chatId, pendingId } to the page
  4. Page redirects to /chat/<chatId>
  5. Claude reads seed prompt: "Ask me whether I received the notification.
       When I confirm yes, call manageDebug({ kind: 'confirm-and-clear', pendingId: '<UUID>' })."
  6. User answers yes
  7. Claude calls the tool → handler reads ticket, calls notifier.clear(notificationId), unlinks ticket
```

### Components

- **Opaque `pendingId`** — a UUID generated server-side. Not a `chatId`, so the plugin owns the abstraction; the LLM only knows what's in the seed prompt.
- **Ticket file** at `data/plugins/<pkg>/pending-clear/<pendingId>.json`, payload `{ notificationId: string }`. JSON file under the plugin's normal `runtime.files.data` scope. **Survives reboot** — important for the case where a notification was posted before the user closed MulmoClaude and resumed the conversation later.
- **Plugin's `TOOL_DEFINITION` exposes a clear action to the LLM.** In debug-plugin: `manageDebug` action `confirm-and-clear` (alongside `echo`). Encore will expose its own domain-shaped tool (`encore.recordResponse`, `encore.markPaid`, etc.) that calls `notifier.clear()` as a side effect of recording the actual obligation update.
- **Idempotent clear** — a second call with the same pendingId silently succeeds (`{ ok: true, cleared: false, reason: "ticket not found" }`) so a retried tool call doesn't surface a misleading error to Claude.

### Why not pass the chatId?

The chatId is a host concept. Using an opaque plugin-owned token keeps Encore's domain semantics independent of the chat-session id — useful when one obligation might span multiple chats over time, or when the plugin wants to disambiguate (a pendingId could correspond to a specific obligation/instance pair, not just "the chat that's open right now").

### Why visible in the chat history?

The seed prompt — including the pendingId UUID — is stored as the first "user" turn in jsonl, so the human will see it (with the "from `<pkg>`" chip + muted background marking it as plugin-seeded). That's awkward but acceptable for this PR's debug-plugin demo; Encore will refine the phrasing. A future enhancement could route the seed instruction as a hidden system-style turn rather than a visible user turn.

## Other shipped extensions

### `SessionOrigin` extended to `plugin:${string}`

`src/types/session.ts` — added `PLUGIN_SESSION_ORIGIN_PREFIX = "plugin:"`, a new `pluginPkgFromOrigin()` parser, and the `SessionOrigin` union now admits `` `plugin:${string}` `` strings. `isSessionOrigin()` validates both fixed origins and well-formed plugin tags. `SessionMeta.origin` in `server/utils/files/session-io.ts` was widened to `SessionOrigin` to match.

### Stub runtime updated for definition-only loads

`server/plugins/runtime-loader.ts` — the stub runtime (used by the MCP child process and tests that load factory plugins without a real runtime) gained:

- `notifier.publish` / `notifier.clear` — throw with a clear "definition-only load" message
- `tasks.register` — **silent no-op** (tick registration is parent-only by design; the child has no task manager to register against, but a plugin that calls `tasks.register` at setup time shouldn't crash the definition-only load)
- `chat.start` — throws (matches the `fetch` / `files` pattern; starting a chat is a parent-only side effect a plugin should never trigger at setup time)

Without this, debug-plugin's setup-time `tasks.register` call crashed the preset loader test (`test_preset_loader.ts`).

### `parseSessionEntries` meta-row fallback

`src/utils/session/sessionEntries.ts` — the chat-loading path is `loadSession(urlSessionId)` running BEFORE `fetchSessions()` resolves on first mount of `/chat/<id>`, so `serverSummary.origin` is undefined when `parseSessionEntries` fires. The detail payload's `session_meta` row carries the origin though, so we read it from there as a fallback. Codex review caught this on PR #1237.

`parseSessionEntries(entries, sessionOrigin?)` now uses `sessionOrigin ?? extractMetaOrigin(entries)`. The explicit `sessionOrigin` still wins when both are present (summary is the canonical source); meta only fills the gap.

## Plugin-seeded message marker

When a chat session has `origin === "plugin:<pkg>"`, the **first user turn** is rendered with:

- A small chip `from <pkg>` next to the speaker label
- A muted gray background variant (instead of the standard "user" green)
- `data-testid="text-response-seeded-by-plugin"` for E2E selection
- i18n key: `pluginTextResponse.seededByPlugin` (chip text) + `pluginTextResponse.seededByPluginTooltip` (hover) — added in all 8 locales

Implementation lives in `src/plugins/textResponse/View.vue` (the textResponse plugin renders all text turns) and `src/plugins/textResponse/types.ts` (the `seededByPlugin` field on `TextResponseData`). The seeded turn is still a normal user turn in jsonl; only the rendering changes.

## File-by-file (as shipped)

### Host (server)

| # | File | Change |
|---|---|---|
| 1 | `server/plugins/runtime-tasks-api.ts` (new) | Define `PluginTaskSchedule`, `TasksRuntimeApi` types |
| 2 | `server/plugins/runtime-chat-api.ts` (new) | Define `ChatRuntimeApi` types |
| 3 | `server/notifier/runtime-api.ts` | Extend `MulmoclaudeRuntime` to include `tasks` + `chat`; re-export the new APIs |
| 4 | `server/plugins/runtime.ts` | Add `makeScopedTasks(pkgName, taskManager)` + `makeScopedChat(pkgName)` factories. Add `taskManager` to `MakePluginRuntimeDeps` |
| 5 | `server/plugins/runtime-loader.ts` | Stub runtime gains `notifier` (throws), `tasks.register` (silent no-op), `chat.start` (throws) so factory-plugin loads in MCP child don't crash on setup-time calls |
| 6 | `server/index.ts` | Move Task Manager block above Runtime plugins block (lint: `no-use-before-define`); plumb `taskManager` into `makePluginRuntime` deps |
| 7 | `server/utils/files/session-io.ts` | Widen `SessionMeta.origin` to `SessionOrigin` so `plugin:<pkg>` strings round-trip through the meta sidecar |

### Frontend (Vue)

| # | File | Change |
|---|---|---|
| 8 | `src/types/session.ts` | Add `PLUGIN_SESSION_ORIGIN_PREFIX` + `pluginPkgFromOrigin()`; widen `SessionOrigin` to admit `` `plugin:${string}` ``; `isSessionOrigin()` validates plugin tags |
| 9 | `src/utils/tools/result.ts` | `makeTextResult(text, role, attachments?, seededByPlugin?)` propagates the marker into `data.seededByPlugin` |
| 10 | `src/utils/session/sessionEntries.ts` | `parseSessionEntries(entries, sessionOrigin?)` marks the first user turn with `seededByPlugin`; falls back to `session_meta.origin` when summary is missing (Codex review fix) |
| 11 | `src/App.vue` | `refreshSessionTranscript` passes the session summary's origin to `parseSessionEntries` |
| 12 | `src/plugins/textResponse/types.ts` | Add `seededByPlugin?: string` to `TextResponseData` |
| 13 | `src/plugins/textResponse/View.vue` | Render `from <pkg>` chip + muted gray background on the first user turn when `data.seededByPlugin` is set |
| 14 | `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` | `pluginTextResponse.seededByPlugin` + `pluginTextResponse.seededByPluginTooltip` in all 8 locales |

### Smoke test (debug-plugin → 0.2.0)

| # | File | Change |
|---|---|---|
| 15 | `packages/debug-plugin/src/index.ts` | Register a 1-min tick (off by default; posts a `fyi` notification when enabled). New dispatch actions: `chat-start`, `tick-toggle`, `chat-start-and-store` (writes pending-clear ticket), `confirm-and-clear` (LLM-callable: reads ticket, clears notification) |
| 16 | `packages/debug-plugin/src/definition.ts` | Expose `confirm-and-clear` to the LLM alongside `echo` (other dispatch actions stay browser-only) |
| 17 | `packages/debug-plugin/src/View.vue` | Tick toggle, free-form `chat-start` form, two action-notification scenarios (auto-clear-on-navigate + LLM-clear), `ask-user` and `ask-user-store` modes |
| 18 | `packages/debug-plugin/package.json` | 0.1.0 → 0.2.0 |

### Tests

| # | File | Change |
|---|---|---|
| 19 | `test/plugins/test_plugin_runtime.ts` | 5 new tests for `tasks.register`: contracted `plugin:<pkg>` id, schedule pass-through, cap-at-1 throw, isolation, run-callback round-trip |
| 20 | `test/utils/session/test_sessionEntries.ts` | 9 new tests for the seededByPlugin marker (5 for the basic logic + 4 for the meta-row fallback) |
| 21 | `test/plugins/test_{bookmarks,recipe_book,runtime_loader_factory,todo_plugin}_integration.ts` | Pass `taskManager: createTaskManager()` into `makePluginRuntime` |

## Resolved risks

| # | Risk in original plan | Resolution |
|---|---|---|
| 1 | Hot-reload cleanup path — would need `taskManager.removeTask("plugin:<pkg>")` on plugin unload | **Resolved by investigation.** Server-side plugin code does NOT hot-reload — `server/index.ts:777` explicitly logs "restart mulmoclaude to pick up server-side changes." Plugins load once at boot via `loadPresetPlugins` / `loadRuntimePlugins` / `loadDevPlugins`. The cap-at-1 throw cannot fire from a reload because reloads require a server restart |
| 2 | Initial-message phrasing is the plugin author's responsibility | Stands. debug-plugin's seed prompt is the working reference |
| 3 | Visual treatment language | Shipped: chip + muted gray, reusing existing Tailwind tokens |
| 4 | Tick fires every minute on a fresh checkout | debug-plugin's tick is OFF by default; toggled via the `tick-toggle` dispatch action from the Debug page |

## Test plan (as shipped)

### Unit (4342 tests, 0 fail)

- `test/plugins/test_plugin_runtime.ts` — `tasks.register` (5 cases)
- `test/utils/session/test_sessionEntries.ts` — seededByPlugin marker + meta-row fallback (9 cases)

### Integration (manual via debug-plugin's `/debug` page)

| Scenario | Expected |
|---|---|
| Tick ON → wait ~60s | A `fyi` "Debug tick" notification per minute (heartbeat at `<ISO>`) |
| Tick OFF → wait | No notifications |
| **Free-form Seeded chat** form (initialMessage + optional role) | New chat appears; first user turn rendered with `from @mulmoclaude/debug-plugin` chip + muted background; Claude has already responded |
| Action / nudge — opens a Claude question (auto-clear on navigate) | Click bell → land in seeded chat; bell notification cleared by the navigation |
| **Action / nudge — opens a Claude question (LLM clears via stored id)** | Click bell → land in seeded chat → answer "yes" → Claude calls `manageDebug({ kind: "confirm-and-clear", pendingId })` → bell notification disappears |
| Server kill mid-flow (after pending-clear ticket written, before LLM call) | Restart server; resume chat; user answers yes; tool call still works (ticket survived on disk) |

### E2E (407 tests, 0 fail)

Existing e2e suite passes unchanged. No new e2e was added in this PR; future PRs adding a chip-rendering E2E should target `data-testid="text-response-seeded-by-plugin"`.

### Lint / typecheck / build

- `yarn format` / `yarn lint` / `yarn typecheck` (~42s) / `yarn build` — all green

## Follow-ups (out of this PR's scope)

- **Phase 2 — `packages/encore-plugin/`.** The Encore plugin itself: data model under `~/mulmoclaude/data/plugins/encore-plugin/`, MCP tool for chat-driven setup (`presentForm`-pattern), tick handler scanning obligations + posting action notifications, `chat.start` for conditional triggers using the LLM-clear pattern documented above, `View.vue` / `Preview.vue`, all 8 locales.
- **Phase 3 — `gui-chat-protocol@0.4.0` upstream.** Move `tasks`, `chat`, and `notifier` into the protocol's `PluginRuntime`; drop the cast across all consumers (`bookmarks-plugin`, `debug-plugin`, `recipe-book-plugin`, `spotify-plugin`, `todo-plugin`, `encore-plugin`).
- **`docs/plugin-runtime.md` update.** Add a "Tick + chat-seeding" section after the existing notifier section, with one worked example each — and document the LLM-clear pattern (pending-clear ticket on disk + LLM-callable tool action).
