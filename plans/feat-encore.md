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

### Target shape — `Notifier`

A generic engine in `server/notifier/` that any plugin can consume.

#### Core API (server-side, called by plugins)

```ts
// Schedule a reminder identified by a plugin-owned ID.
// Re-calling with the same id replaces the existing schedule
// (idempotent — plugins can re-derive on every state change).
notifier.schedule({
  id: "encore:taxes:2026:lead-6w",
  pluginPkg: "encore",
  severity: "info" | "nudge" | "urgent",
  firesAt: ISO8601,
  payload: { titleKey, bodyKey, action },
  // Re-surface policy: if user has not acted by `firesAt + N`,
  // bump severity and fire again. `null` disables re-surface.
  resurface: { afterMs, escalateTo: "nudge" } | null,
  // Snooze-condition handle: when the plugin emits a signal
  // matching this key, the reminder un-snoozes (replace = false)
  // or fires immediately (replace = true).
  snoozeUntilSignal: string | null,
});

notifier.cancel(id);
notifier.snooze(id, { untilTime } | { untilSignal });
notifier.signal(key);   // plugin-emitted signal — un-snoozes / fires reminders waiting on `key`
```

#### Acknowledgment state machine

```
pending → delivered → seen → { acted | snoozed | dismissed }
                          ↘ (timeout) → resurface (with severity bump)
```

`seen` (notification rendered to the user) and `acted` (user clicked through, or plugin reported task progress) are distinct. Re-surface fires off `delivered` without `acted`, not off `seen` without `acted` — otherwise an open bell panel would suppress every escalation.

#### Severity → channel mapping

Configured globally per user, with optional per-plugin override.

| Severity | Default channels |
|---|---|
| `info` | bell only |
| `nudge` | bell + toast |
| `urgent` | bell + toast + macOS push + bridge (Telegram/CLI) |

Mapping lives in `~/mulmoclaude/config/notifier.json`. Plugins may *request* a channel uplift (`requireChannel: "macos"`) but the user's config is authoritative.

#### Persistence

Schedules persist to `~/mulmoclaude/data/notifier/scheduled.jsonl` so a restart does not drop pending reminders. State machine transitions append to `~/mulmoclaude/data/notifier/state.jsonl`. Both go through `writeFileAtomic`.

#### Pub-sub events

Two new channels in `src/config/pubsubChannels.ts`:

- `notifier:fired` — a scheduled notification just fired. Plugins can subscribe to update progress UI.
- `notifier:acted` — user clicked through or dismissed. Plugins can use this to mark "done for this instance."

#### Notification center

The bell panel becomes a thin client over the new state — same UI, but each row exposes its full lifecycle (snooze button, "remind me again in 1h" picker, link to the originating instance). Existing `NotificationBell.vue` and `NotificationToast.vue` need lifecycle awareness; no testid changes.

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
      attachments/             ← scans, PDFs, screenshots
      recipients.md            ← (xmas-cards) the list itself
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

### `manageEncore` actions

Single tool with action dispatch (matches `manageAccounting` / `manageAutomations` / `manageSkills`):

```ts
manageEncore({ action: "createObligation", slug, title, recurrence, leadTime, severity })
manageEncore({ action: "updateObligation", slug, patch })
manageEncore({ action: "listObligations" })
manageEncore({ action: "openInstance", slug, year })           // creates <slug>/<year>/, copies forward
manageEncore({ action: "updateInstance", slug, year, patch })  // status, progress, notes
manageEncore({ action: "closeInstance", slug, year, status: "done" | "skipped" })
manageEncore({ action: "listUpcoming", withinDays })           // queue across all obligations
manageEncore({ action: "diffFromLast", slug, year })           // Claude reads N-1 vs N, summarizes deltas
manageEncore({ action: "snoozeReminder", slug, year, until })  // proxies to notifier.snooze
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

Three PRs, each independently shippable.

### PR 1 — Notifier upgrade (host)

Land the engine without any new consumer. Migrate existing call sites to the wrapper (`publishNotification` becomes a thin alias). Persistence, re-surface, ack state, snooze-until-time, severity-based channel routing. No snooze-until-signal yet (no consumer needs it).

Risk: regression in current notification UX. Test plan: every existing `publishNotification` caller smoke-tested via `/api/notifications/test`, plus E2E coverage of the bell.

### PR 2 — Encore plugin (read-only / no reminders)

Plugin scaffold: `meta.ts`, `definition.ts`, `index.ts`, `View.vue`, `Preview.vue`. Server: `server/encore/` with file IO + `manageEncore` actions for CRUD, `openInstance`, `diffFromLast`. Standalone `/encore` route. **No notifier integration yet** — proves the data model works in isolation.

### PR 3 — Encore × Notifier integration

Add reminder scheduling on every state change. Add snooze-until-signal to the Notifier. Wire signal emission from `updateInstance` (`"w2-received"`, `"cards-ordered"`, etc.). Progress-aware suppression. The "magnetic feature" demo: open an instance, see last year's data pre-populated, see the next-action reminder already scheduled.

---

## Open questions

To resolve before PR 1:

1. **Declarative vs imperative scheduling.** Plan above is *imperative* — plugin computes each fire time and re-registers. A declarative spec ("every Sunday until acked, escalate after 2 weeks") is more powerful but a bigger surface. Imperative matches how `task-scheduler` already works; declarative may be worth it once we see 3+ plugins repeating the same pattern. **Default: imperative for v1.**
2. **Severity → channel mapping config UI.** Hidden file (`config/notifier.json`) for v1, settings page later? Or settings page from day one? **Default: hidden file for v1, settings UI in a follow-up.**
3. **Re-surface cap.** A reminder ignored for a week should not fire 50 times. Cap at `escalateAt.length` re-surfaces? Hard ceiling of N per 24h? **Default: re-surface only at the explicit `escalateAt` points; no auto-multiplication.**
4. **Conflict with `task-scheduler`.** The existing scheduler also fires things on a schedule. Notifier is *user-facing reminders*; scheduler is *task execution*. They may share scheduling primitives internally; they should not share API surfaces. **Default: keep them separate; revisit if duplication becomes painful.**
5. **i18n surface for Encore.** All 8 locales need the obligation-type vocabulary ("taxes", "registration", "annual physical"). Are these built-in templates the user picks from, or free-form titles the user types? **Default: free-form for v1, suggested templates as a chat-side affordance.**

To resolve before PR 3:

6. **Signal namespace.** `"encore:taxes:w2-received"` is the obvious shape, but signals are global. Risk of name collision across plugins. **Likely: enforce `<pkg>:` prefix at the Notifier API boundary.**

---

## Non-goals (Encore v1)

- Sharing obligations across multiple users (gift lists with spouse, etc.). Local-first; multi-user is a separate problem.
- Importing from Google Calendar / iCal. Manual creation only.
- Auto-detecting recurring obligations from email or documents.
- Financial integration (paying the tax bill from Encore). Encore *tracks*; payment lives elsewhere.

These are all defensible v2 features; explicitly out of scope so v1 stays shippable.
