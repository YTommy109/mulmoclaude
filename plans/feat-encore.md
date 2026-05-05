# Plan: Encore — recurring obligations with year-over-year memory

Status: design / discussion. **Document-only PR**, no code changes yet.

## Why Encore

People juggle a long tail of recurring obligations that don't fit into either todos or calendars cleanly:

- **Filing taxes** (yearly) — multi-week prep window, documents to gather, a CPA to email, last year's return as reference.
- **Real-estate tax** (every 6 months) — payment + receipt to archive.
- **Annual physical** — which tests, which results trended which way, what to ask next time.
- **Car registration / inspection** — which shop, what they flagged "watch next year".
- **Christmas cards** — who you sent to, who sent back, address changes, "skip this year because…".
- **Birthday gifts** — what you gave, reactions, ideas for next time.

Existing tools each get part of the shape but none get the whole thing:

- **Bill / subscription trackers** (Rocket Money, Bobby) — money-only, "remind me X days before" is the entire model.
- **Recurring todo apps** (Todoist, TickTick, Things) — handle repetition but treat each instance as a one-off; no carry-forward.
- **Compliance / deadline trackers** — B2B-priced, enterprise-shaped.
- **Life-admin organizers** (Cozi) — broad and shallow, no deep model of obligations.

The gap is **institutional memory across instances**. Each recurrence is not independent — it is a *diff against last time*. "Same as last year except Aunt Jane moved" is the most natural way humans think about these. Most apps force re-entry; the magnetic feature is *last year's instance pre-populates this year's, and you only edit the deltas*.

## Why MulmoClaude

This is the clearest product-fit case we have seen for the workspace-as-database thesis:

- **The data is heterogeneous and personal.** A Christmas card list, a CPA's email, a scan of last year's W-2, a note saying "the DMV line is shorter on Tuesday." Rigid schemas can't model this; a folder of plain files can.
- **"Same as last year except…" is an LLM task, not a form task.** Claude reading `data/encore/xmas-cards/2025/recipients.md` and drafting `2026/recipients.md` with a "who to review" list is trivially natural — and impossible in Todoist.
- **Recurrence already exists.** The scheduler, calendar, and todos plugins are in place. This is not a new engine — it is a new *case* abstraction sitting on top.
- **Privacy story is built in.** Tax docs, medical history, gift lists — people will not put these in a cloud SaaS. Local-first is a feature, not a constraint.

## Two-layer architecture

Encore drives requirements harder than any other plugin we have shipped, especially around reminders. The clean layering is:

1. **Host-level Notifier upgrade** — a generic notification *engine* that any plugin can consume. Calendar, Todos, Sources, Automations, and Encore all benefit.
2. **Encore plugin** — domain logic (obligation types, lead-time policies, instance lifecycle, carry-forward) that *uses* the Notifier engine. No Encore-specific reminder primitives leak into the host.

This matches the plugin-vs-host boundary in `CLAUDE.md`: host owns generic infrastructure that benefits multiple plugins; plugin owns domain.

---

## Part 1 — Notifier upgrade (host)

### Today

`server/events/notifications.ts` exposes `publishNotification()` — a single fire-and-forget call that:

- Pushes a payload to the in-memory store (last 50, used by the bell panel).
- Publishes to the `notifications` pubsub channel for every open Web tab.
- Optionally pushes to a chat-service bridge (Telegram / CLI).
- Optionally pushes to macOS Reminders (gated by env flag).

`scheduleTestNotification()` schedules a single `setTimeout` for delayed delivery. There is no:

- **Scheduling beyond a single fire** — once `setTimeout` runs, the notification is gone whether or not the user saw it.
- **Lead-time / escalation curves** — every reminder is "fire once at time T."
- **Acknowledgment state** — clicking the bell marks read; that is it. Nothing re-surfaces if ignored.
- **Snooze with intent** — "remind me when my W-2 arrives" is impossible to express.
- **Channel routing by severity** — every notification goes to every channel.
- **Persistence across restarts** — `setTimeout` dies with the process; the in-memory store is non-durable.

The current model is sufficient for "your scheduled task just finished" but cannot carry the weight of "you usually need 3 weeks to gather tax documents."

### Three notification types — three lifecycle shapes

Plugins fire notifications that fall into one of three shapes. The Notifier carries `kind` on every payload so the panel UI and the lifecycle close-event branch correctly.

```ts
type NotifierKind = "fyi" | "read" | "action";
```

| Kind | Example | Has body content? | Closes when… |
|---|---|---|---|
| `fyi` | "Backup completed" | No | User acknowledges (button or bulk-checkbox in panel) |
| `read` | "Daily news digest is ready" | Yes — content lives at a deep-link target | User clicks the row → navigated to target → close fires automatically |
| `action` | "Pay H2 property tax" | Yes — plugin-owned page with custom UX | Plugin calls `notifier.clear(id)` when the underlying state change happens |

Key implication for `action`: the close call belongs in the **plugin's domain logic, not the panel click handler**. If the user submits the journal entry via chat without ever opening the bell, the reminder must still clear. The deep-link click is just convenience routing; it does not by itself satisfy the notification.

### Target shape — `Notifier`

A generic engine in `server/notifier/` that any plugin can consume.

#### Core API (server-side, called by plugins)

```ts
// Schedule a notification identified by a plugin-owned ID.
// Re-calling with the same id replaces the existing entry
// (idempotent — plugins can re-derive on every state change).
notifier.schedule({
  id: "encore:taxes:2026:lead-6w",
  pluginPkg: "encore",
  kind: "fyi" | "read" | "action",
  severity: "info" | "nudge" | "urgent",
  firesAt: ISO8601,
  payload: { titleKey, bodyKey, action },
  // Re-surface policy: if not acted by `firesAt + N`,
  // bump severity and fire again. `null` disables.
  // Only meaningful for `read` and `action`; `fyi` ignores.
  resurface: { afterMs, escalateTo: "nudge" } | null,
  // Snooze-condition handle: when the plugin emits a signal
  // matching this key, the reminder un-snoozes.
  snoozeUntilSignal: string | null,
});

// Two distinct verbs — the audit trail captures the difference:
notifier.clear(id);     // "the user did the thing" → records `acted`, drops from pending
notifier.cancel(id);    // "this reminder became irrelevant" → records `cancelled`, no action implied

notifier.snooze(id, { untilTime } | { untilSignal });
notifier.signal(key);   // plugin-emitted; un-snoozes / fires reminders waiting on `key`
```

`clear` vs `cancel` is semantically meaningful for the audit trail and for any future "completion-rate" telemetry. UX-wise both reduce the badge count.

#### Lifecycle / state machine

```
                ┌→ acted   ──→ closed   (notifier.clear OR navigate-and-close for `read`)
pending → delivered → seen ─→ snoozed ─→ (re-evaluates at untilTime / untilSignal)
                ↓             ↘ dismissed → closed  (only for `fyi` via acknowledge)
                └→ resurface (delivered without acted, after re-surface delay)
```

- `seen` is "rendered to the user" (panel opened, or toast shown). Re-surface fires off `delivered` without `acted`, **not** off `seen` without `acted` — otherwise an open bell panel would suppress every escalation.
- For `fyi`: acknowledge transitions directly to `closed` without going through `acted` (no domain action exists to be acted on; acknowledge IS the close).
- For `read`: navigation triggers `clear` automatically — the panel emits the close on the same tick it routes the user.
- For `action`: only the plugin can transition to `acted` / `closed`. The panel cannot.

#### Pending count + bell badge semantics

The toolbar bell shows the count of notifications in `delivered` or `seen` state, **excluding** `snoozed`, `cancelled`, and `closed`. This is meaningfully different from today's "unread" count — the badge reflects *outstanding obligations*, not "rows you haven't clicked."

- **Color encodes worst-severity in the queue.** Gray for `info`-only, amber if any `nudge`, red if any `urgent`. One glance answers "is anything on fire?" without opening the panel.
- **Cap visual at `99+`.** Above 99 the actual number stops mattering — it's a backlog problem, not a counting problem.
- **Snoozed items don't count.** They were explicitly deferred. They re-enter the count when their snooze expires or their signal fires.
- **Aggregate, not per-plugin.** One badge on one bell. Per-plugin badges splinter the chrome without saving the user a click.

#### Panel UX per kind

The bell panel stays the surface for all three kinds. Each row's affordance differs by `kind`:

- **`fyi`** — leading checkbox + "Acknowledge selected" button at the panel footer. Click anywhere on the row toggles the checkbox; explicit close-button on the row also acknowledges that single item. Bulk acknowledge is the headline ergonomic — for catch-up sessions where 12 "build finished" rows pile up.
- **`read`** — row is a hyperlink. Click → close panel → route to `payload.action.target` → close transition fires. Same as today's `NotificationAction.navigate`, just with the auto-close hooked up.
- **`action`** — row is also a hyperlink and routes to a plugin-owned page; *but* the close is driven by the plugin (`notifier.clear(id)`), not by the click. The deep-link target carries `notificationId` so the plugin page can highlight the relevant item and know which ID to clear when the user completes the action. If the user navigates away without acting, the notification stays pending and re-surfaces on schedule.

`NotificationBell.vue` and `NotificationToast.vue` gain `kind`-aware rendering. New testids: `[notification-row-fyi]`, `[notification-row-read]`, `[notification-row-action]`, `[notification-acknowledge-bulk]`.

#### Severity → channel mapping

Configured globally per user, with optional per-plugin override.

| Severity | Default channels |
|---|---|
| `info` | bell only |
| `nudge` | bell + toast |
| `urgent` | bell + toast + macOS push + bridge (Telegram/CLI) |

Mapping lives in `~/mulmoclaude/config/notifier.json`. Plugins may *request* a channel uplift (`requireChannel: "macos"`) but the user's config is authoritative.

#### Persistence

Schedules persist to `~/mulmoclaude/data/notifier/scheduled.jsonl` so a restart does not drop pending entries. State-machine transitions append to `~/mulmoclaude/data/notifier/state.jsonl` (audit log). Both go through `writeFileAtomic`.

#### Pub-sub events

New channels in `src/config/pubsubChannels.ts`:

- `notifier:fired` — a scheduled notification just fired. Subscribers update progress UI.
- `notifier:closed` — closed via any path (`acted` / `acknowledged` / `dismissed` / `cancelled`); payload includes which path. Plugins use this to mark "done for this instance" or update item status.

#### Notification center

The bell panel becomes a thin client over the new state — same surface, but each row renders per its `kind` (above) and exposes its full lifecycle (snooze button, "remind me again in 1h" picker, link to the originating item). `NotificationBell.vue` and `NotificationToast.vue` need lifecycle + kind awareness; the existing `[notification-badge]` testid stays.

### What stays

The existing `publishNotification()` call site — nothing immediate, no schedule, no re-surface — remains as the simplest entry point for "fire one toast right now." It becomes a thin wrapper over `notifier.schedule({ firesAt: now, resurface: null })`. All current callers keep working unchanged.

### Out of scope for Notifier v1

- Cross-device delivery (sync between Mac and phone).
- iOS / Android push.
- "Smart" timing ("when the user is at the desk on Sunday morning").
- Aggregation / digest ("3 reminders today, here is the summary").

These can layer on later without re-shaping the core.

---

## Part 2 — Encore plugin

### Identity (built-in plugin)

```ts
// src/plugins/encore/meta.ts
export const META = definePluginMeta({
  toolName: "manageEncore",
  apiNamespace: "encore",
  apiRoutes: { dispatch: { method: "POST", path: "" } },
  mcpDispatch: "dispatch",
  workspaceDirs: {
    encore: "data/encore",
    encoreObligations: "data/encore",   // each obligation = a sub-folder
  },
  staticChannels: {
    encore: "encore",
  },
});
```

Standard built-in plugin layout under `src/plugins/encore/` — `definition.ts` / `index.ts` / `View.vue` / `Preview.vue` — with server endpoints in `server/api/routes/encore.ts` and domain code in `server/encore/`.

### Data model — the workspace is the database

```text
~/mulmoclaude/data/encore/
  <obligation-slug>/
    obligation.md              ← config: title, recurrence, lead-time, channels
    notes.md                   ← free-form user annotation (Claude reads for context)
    <YYYY>/                    ← one folder per instance
      instance.md              ← status, milestones, resolution
      items.md                 ← optional: parallel/sequential sub-items (see below)
      attachments/             ← scans, PDFs, screenshots
      diff-from-last.md        ← Claude-generated on instance creation
```

Example: `data/encore/xmas-cards/obligation.md`

```markdown
---
slug: xmas-cards
title: Christmas cards
recurrence:
  kind: yearly
  anchor: "12-15"            # send by this date
leadTime:
  prepDays: 14               # 2 weeks of prep needed
  escalateAt: [21, 7, 1]     # days before anchor to fire reminders
severity:
  default: info
  finalDays: urgent          # last entry in escalateAt uses this
created: 2026-05-05
---

# Notes

International cards need 3 weeks. Prefer photo cards from Shutterfly.
Last year I forgot the Tanaka family — make sure they are on the list.
```

Example: `data/encore/xmas-cards/2026/instance.md`

```markdown
---
year: 2026
status: in-progress       # planned | in-progress | done | skipped
opened: 2026-11-10
progress:
  - { step: "draft list",  done: true,  at: 2026-11-12 }
  - { step: "order cards", done: false }
  - { step: "address",     done: false }
  - { step: "mail",        done: false }
---

# This year

Skipping the Watson family (moved, no forwarding address yet).
Adding the new neighbours (Lee).
```

Why per-file over a single `obligations.json`:

- Matches the wiki / sources convention. Claude can edit one obligation without touching a global registry.
- Grep-friendly, git-diff-friendly.
- Carry-forward is "read last year's folder, draft this year's" — a perfect Claude task.

### Multi-item instances

A single instance often involves *multiple sub-items* in two distinct shapes:

- **Fan-out / independent** — Christmas cards to 50 recipients. Each is its own thing; some can be done while others remain. The instance is "done" when (most/all) items are done.
- **Sequential / pipelined** — a property-tax bill flows through `received → paid → confirmed`. Each item walks the same small pipeline; the *next undone step* is what the user (and the reminder) cares about.

Both are supported by one lightweight construct: an `items` array, where each item has an optional `steps` array. No items, items-without-steps, items-with-steps — pick the shape that fits.

```ts
type Item = {
  id: string;          // stable, plugin-owned
  label: string;       // user-facing
  status: "pending" | "in-progress" | "done" | "skipped";
  note?: string;       // free-form
  steps?: Step[];      // optional sub-pipeline
};

type Step = {
  name: string;
  done: boolean;
  at?: string;         // ISO date when marked done
};
```

For long lists (Christmas-card recipients, large invoice batches) items live in a separate `items.md` to keep `instance.md` readable. For 1–10 items they can sit in the instance frontmatter directly. Either layout is read by the same parser.

#### Example — fan-out: `data/encore/xmas-cards/2026/items.md`

```markdown
---
items:
  - { id: tanaka,  label: "Tanaka family",  status: done,    at: 2026-12-05 }
  - { id: watson,  label: "Watson family",  status: skipped, note: "moved, no forwarding address" }
  - { id: lee,     label: "Lee family",     status: pending, note: "new neighbours — get address" }
  - { id: kimura,  label: "Kimura family",  status: pending }
---
```

#### Example — sequential: `data/encore/property-tax/2026/items.md`

```markdown
---
items:
  - id: prop-tax-h1
    label: "First-half property tax"
    status: done
    steps:
      - { name: received,  done: true, at: 2026-04-10 }
      - { name: paid,      done: true, at: 2026-04-15 }
      - { name: confirmed, done: true, at: 2026-04-20 }
  - id: prop-tax-h2
    label: "Second-half property tax"
    status: in-progress
    steps:
      - { name: received,  done: true,  at: 2026-10-08 }
      - { name: paid,      done: false }
      - { name: confirmed, done: false }
---
```

The two existing `instance.md` fields play together cleanly:

- `progress` = milestones for the instance *as a whole* ("draft list," "order cards"). Optional.
- `items` = the parallel/sequential entities the instance acts on. Optional.

A trivially simple instance (annual physical: just a date and some notes) uses neither. Christmas cards uses both. Property tax uses only `items`.

#### Reminder implications

Item-level granularity makes reminders sharper without complicating the Notifier core:

- **Fan-out**: aggregate signal — "5 of 25 recipients still pending, 7 days to anchor." Encore composes the reminder body; Notifier just delivers it.
- **Sequential**: per-item reminder targeting the *next undone step* — "property-tax H2 received but not paid; due in 3 days." Each item with a stuck step is its own re-surfacing reminder.
- Progress-aware suppression extends naturally: percentage-done across items, or "no item has advanced in N days."

### `manageEncore` actions

Single tool with action dispatch (matches `manageAccounting` / `manageAutomations` / `manageSkills`):

```ts
manageEncore({ action: "createObligation", slug, title, recurrence, leadTime, severity })
manageEncore({ action: "updateObligation", slug, patch })
manageEncore({ action: "listObligations" })
manageEncore({ action: "openInstance", slug, year })           // creates <slug>/<year>/, copies forward
manageEncore({ action: "updateInstance", slug, year, patch })  // status, progress, notes
manageEncore({ action: "closeInstance", slug, year, status: "done" | "skipped" })
manageEncore({ action: "addItem", slug, year, item })          // append to items[]
manageEncore({ action: "updateItem", slug, year, itemId, patch })  // status, note, step done/at
manageEncore({ action: "removeItem", slug, year, itemId })
manageEncore({ action: "listUpcoming", withinDays })           // queue across all obligations + per-item pending counts
manageEncore({ action: "diffFromLast", slug, year })           // Claude reads N-1 vs N, summarizes deltas
manageEncore({ action: "snoozeReminder", slug, year, itemId?, until })  // proxies to notifier.snooze; itemId scopes to a single item
```

`openInstance` is the carry-forward seam: copies last year's `instance.md`, `recipients.md`, etc. into the new year's folder *and* asks Claude to write `diff-from-last.md` highlighting "what to review." This is the magnetic feature.

### Reminder integration

Encore translates obligation state into `notifier.schedule()` calls:

- On `createObligation` — schedule reminders for the upcoming instance based on `leadTime.escalateAt` and `severity`.
- On `openInstance` — re-derive schedule from the actual progress state (suppress the "start prep" reminder if the user already opened the instance early).
- On `updateInstance` — progress-aware suppression. If the user has marked 60% of milestones done, suppress the generic nudge; if no progress for `escalateAt[i]` days, escalate.
- On `closeInstance` — cancel all pending reminders for this year, schedule the *next* year.

Snooze-until-signal is how Encore expresses domain conditions:

```ts
// "Remind me after my W-2 arrives" — Encore registers the reminder
// with snoozeUntilSignal: "encore:taxes:w2-received".
// When the user marks "W-2 received" in the instance UI, Encore
// calls notifier.signal("encore:taxes:w2-received") and the
// reminder un-snoozes.
```

The host does not need to understand "W-2"; it just routes signals.

### View

Two surfaces:

- **Chat view** (`View.vue`) — when invoked by Claude, shows the current instance: progress checklist, attachments, "diff from last year" panel, snooze controls.
- **Standalone route** (`/encore`) — index of all obligations grouped by next-fire-time. Same UI building blocks as `/todos` and `/calendar`.

The standalone route follows the existing pattern: route registered in `src/router/index.ts`, page component wraps `<PluginScopedRoot pkg-name :endpoints>`.

---

## Phasing

**Order of operations**: Dev-mode scaffolding ships first (PR 1), so the Notifier engine (PR 2) can ship with a real test plugin behind a Debug role rather than an HTTP-only harness or a test plugin that pollutes production roles. Encore (PRs 3 + 4) follows once the engine is proven.

### PR 1 — Dev mode + Debug role (host only, no Notifier, no Encore)

A general-purpose dev-only role gate that any future test plugin can sit behind. Encore needs it; the Notifier test plugin in PR 2 is the first consumer; later infrastructure work (mock LLM provider, fake source fetcher, etc.) can reuse it.

**`DEV_MODE` env flag**:

- New `.env` entry `DEV_MODE=1` (defaults `0`). Off in production.
- Server-side: `server/system/env.ts` adds `devMode: asFlag(process.env.DEV_MODE)`.
- Client-side: mirrored as `VITE_DEV_MODE` so test-plugin module imports tree-shake out of production bundles.

**Debug role**:

- New entry in `src/config/roles.ts` (id `debug`, name `Debug`, icon `code`). Same prompt and same `availablePlugins` as `general`, plus any test-plugin tool names.
- `RoleSelector.vue` filters the dropdown — Debug only renders when devMode is true. A new `useSystemConfig()` composable fetches a new lightweight `/api/system/config` endpoint (returning `{ devMode }`) once on boot.

**Test-plugin convention**:

- Live under `src/plugins/_<name>/` — underscore prefix mirrors the existing `_extras.ts` / `_generated/` "non-user-facing" marker.
- Tool names also underscore-prefixed: `_notifierTest`, `_<other>` later.
- Registration in `src/plugins/metas.ts` wrapped in a `VITE_DEV_MODE`-guarded conditional so production builds don't ship them.

**Test coverage**:

- Unit: `useSystemConfig` returns `{ devMode: false }` when the endpoint reports false; role-list filter excludes Debug accordingly.
- E2E: with `DEV_MODE=0`, Debug role absent from dropdown; with `DEV_MODE=1`, Debug appears with the General plugin set.

**Acceptance bar**: Debug role appears (when enabled) with the same plugin set as General, no test plugins yet — those land in PR 2 against this scaffold.

### PR 2 — Notifier engine + `_notifierTest` plugin (host only, no Encore)

The engine in `server/notifier/`:

- Three notification kinds (`fyi` / `read` / `action`) with kind-aware lifecycle.
- `schedule` / `clear` / `cancel` / `snooze` / `signal` API.
- State machine + persistence (`scheduled.jsonl` + `state.jsonl`).
- Severity-based channel routing.
- Snooze-until-time **and** snooze-until-signal (both — needed for the action-kind end-to-end test).
- Bell badge with pending-count semantics, color-encoded severity, `99+` cap.
- Panel UX per kind: bulk-acknowledge for `fyi`, click-to-clear for `read`, plugin-owned pages with `notificationId` deep-link param for `action`.
- Migration: existing `publishNotification()` becomes a thin wrapper over `notifier.schedule({ kind: "fyi", firesAt: now })`. All current callers keep working unchanged.

The exercise harness is `_notifierTest` — a dev-only plugin under `src/plugins/_notifierTest/`, surfaced via the Debug role from PR 1. It's the realistic integration bed: a View with buttons to fire each kind at chosen severity, advance through the lifecycle (mark seen, `clear`, `snooze`, emit `signal`), and inspect persisted state. Because it's a real plugin going through the real registration and dispatch paths, it exercises everything Encore will hit in PR 4.

Test coverage:

- **Unit**: state machine transitions, persistence round-trip, severity → channel mapping, snooze re-evaluation, re-surface timing.
- **Integration / E2E (Playwright)**: with `DEV_MODE=1`, switch to Debug role, drive each lifecycle from `_notifierTest`'s View and assert against the bell badge + panel. Verify badge count + color updates per kind, panel rendering per kind (`[notification-row-fyi]` checkbox bulk-acknowledge, `[notification-row-read]` click-and-close, `[notification-row-action]` deep-link with notificationId param), restart-survives-pending verified by killing and restarting the dev server mid-test.

Acceptance bar: every state transition reachable from `_notifierTest`, no Encore code in the diff.

Risk: regression in current notification UX. Mitigated by the migration path keeping `publishNotification()` semantics identical.

### PR 3 — Encore plugin (CRUD only, no reminders)

Plugin scaffold: `meta.ts`, `definition.ts`, `index.ts`, `View.vue`, `Preview.vue`. Server: `server/encore/` with file IO + `manageEncore` actions for obligation CRUD, `openInstance`, `addItem` / `updateItem` / `removeItem`, `diffFromLast`. Standalone `/encore` route. **No notifier integration yet** — proves the data model (including multi-item instances) works in isolation.

### PR 4 — Encore × Notifier integration

Encore translates obligation + item state into `notifier.schedule()` calls. All three kinds get exercised: `fyi` for "instance opened" confirmations, `read` for "diff-from-last is ready," `action` for "pay H2 property tax." Wire `notifier.clear()` on `closeInstance` / `updateItem(status: done)`. Wire `notifier.signal()` for domain conditions (`"encore:taxes:w2-received"`). Progress-aware suppression based on item-completion percentage. The "magnetic feature" demo: open an instance, see last year's data pre-populated, see the next-action reminder already scheduled.

---

## Open questions

To resolve before PR 1 (Dev mode):

1. **`VITE_DEV_MODE` synchronization with `DEV_MODE`.** Single source of truth in `.env` is preferable. Vite reads `.env` natively but only exposes `VITE_`-prefixed vars to the client. Either (a) require both `DEV_MODE=1` and `VITE_DEV_MODE=1`, (b) re-export at vite-config time, or (c) read server-side and surface only via `/api/system/config`. **Default: (b) — vite-config mirrors `DEV_MODE` to `VITE_DEV_MODE` so a single `.env` line drives both.**

To resolve before PR 2 (Notifier):

2. **Declarative vs imperative scheduling.** Plan above is *imperative* — plugin computes each fire time and re-registers. A declarative spec ("every Sunday until acked, escalate after 2 weeks") is more powerful but a bigger surface. Imperative matches how `task-scheduler` already works; declarative may be worth it once we see 3+ plugins repeating the same pattern. **Default: imperative for v1.**
3. **Type-1 panel affordance: button or checkbox?** Per-row close-button is simplest; leading checkbox + bulk "Acknowledge selected" wins for catch-up sessions where many `fyi` rows pile up. **Default: leading checkbox (covers both — single-row click still works via the row's own close-`×`).**
4. **Severity → channel mapping config UI.** Hidden file (`config/notifier.json`) for v1, settings page later? Or settings page from day one? **Default: hidden file for v1, settings UI in a follow-up.**
5. **Re-surface cap.** A reminder ignored for a week should not fire 50 times. Cap at `escalateAt.length` re-surfaces? Hard ceiling of N per 24h? **Default: re-surface only at the explicit `escalateAt` points; no auto-multiplication.**
6. **Signal namespace.** `"encore:taxes:w2-received"` is the obvious shape, but signals are global. Risk of name collision across plugins. **Default: enforce `<pluginPkg>:` prefix at the Notifier API boundary.**
7. **Conflict with `task-scheduler`.** The existing scheduler also fires things on a schedule. Notifier is *user-facing reminders*; scheduler is *task execution*. They may share scheduling primitives internally; they should not share API surfaces. **Default: keep them separate; revisit if duplication becomes painful.**

To resolve before PR 3 (Encore CRUD):

8. **i18n surface for Encore.** All 8 locales need the obligation-type vocabulary ("taxes", "registration", "annual physical"). Are these built-in templates the user picks from, or free-form titles the user types? **Default: free-form for v1, suggested templates as a chat-side affordance.**

---

## Non-goals (Encore v1)

- Sharing obligations across multiple users (gift lists with spouse, etc.). Local-first; multi-user is a separate problem.
- Importing from Google Calendar / iCal. Manual creation only.
- Auto-detecting recurring obligations from email or documents.
- Financial integration (paying the tax bill from Encore). Encore *tracks*; payment lives elsewhere.

These are all defensible v2 features; explicitly out of scope so v1 stays shippable.
