# Plan: Encore plugin (Phase 2)

> **Status: design draft.** Phase 1 (`plans/done/feat-plugin-runtime-tasks-chat.md`, merged in PR #1237) shipped the host primitives Encore depends on. This doc extracts what's available, frames the Encore-specific design surface, and flags open decisions for direction before implementation starts.

Companion to:

- [`feat-encore-vision.md`](./feat-encore-vision.md) — the UX-and-why doc. The shape of the experience we're building.
- [`done/feat-plugin-runtime-tasks-chat.md`](./done/feat-plugin-runtime-tasks-chat.md) — the runtime APIs Encore consumes.

## Goal

Ship `packages/encore-plugin/` (`@mulmoclaude/encore-plugin`) — a runtime plugin that turns Encore's vision into a working surface inside MulmoClaude. By the end of Phase 2 a user can:

- Describe an obligation in chat ("I need to pay property tax for my second home twice a year"), have Claude open a small form via `presentForm`, fill three or four fields, and walk away.
- Get a notification at the right cadence (state-aware, not just date-aware) — the plugin's tick fires `runtime.notifier.publish` action notifications.
- Click the notification → land in a Claude-seeded chat that asks the right question, with last year's instance already on the page.
- Tell Claude "yes, paid it" → Claude calls the plugin's MCP tool → the obligation's instance is marked done, the notification clears, next year's instance is silently provisioned.
- Open the Encore page directly to browse obligations and review past years.

## What Phase 1 gives us

All of these are available on `MulmoclaudeRuntime` today and can be cast-imported into the plugin (`runtime as MulmoclaudeRuntime`):

| Primitive | Use in Encore |
|---|---|
| `runtime.tasks.register({ schedule, run })` | One master heartbeat. Scans every obligation, decides what reminders to fire, what new instances to provision |
| `runtime.chat.start({ initialMessage, role? })` | Open Claude-seeded chats for the conditional-trigger and reminder flows ("did you receive your W-2?", "did you pay property tax?"). Returns `{ chatId }` |
| `runtime.notifier.publish({ severity, lifecycle, title, body, navigateTarget })` | Bell notifications. `lifecycle: "action"` + `navigateTarget: "/chat/<chatId>"` lands the user in the seeded chat |
| `runtime.notifier.clear(id)` | Plugin-scoped clear. Called from the MCP tool handler when the obligation advances |
| `runtime.files.data.read/write/...` | Plugin-scoped FS at `~/mulmoclaude/data/plugins/@mulmoclaude/encore-plugin/`. Where every obligation file lives |
| **LLM-driven clear pattern** (pending-clear ticket on disk) | When the plugin posts a notification + seeds a chat, it stores `pending-clear/<pendingId>.json = { notificationId }` and embeds the pendingId in the seed prompt. Claude calls Encore's MCP tool with the pendingId; the tool reads the ticket, clears the notification, advances state. Survives reboot |
| Plugin-seeded chat marker (chip + muted bg) | The first user turn of a `chat.start`-seeded session renders with `from @mulmoclaude/encore-plugin` chip — no extra plumbing in Encore |
| `presentForm` plugin (existing) | The setup-by-saying surface — Claude calls `presentForm` to render the obligation form inline in chat |

Encore does NOT need any new host extensions. Phase 3 (gui-chat-protocol upstream) is independent and can land in parallel without blocking Encore.

## Encore-specific design

### Data model

**One folder per obligation, multiple files inside it.** This matches the vision doc's "files in folders" / "memory across instances" framing: the obligation has a long-lived identity, each year is the next page of the story.

Proposed layout under `~/mulmoclaude/data/plugins/@mulmoclaude/encore-plugin/`:

```text
obligations/
  property-tax-second-home/
    index.md                 ← obligation definition (frontmatter + free-form description)
    2025.md                  ← last year's instance (closed)
    2026-h1.md               ← current open instance
    2026-h2.md               ← (provisioned automatically when 2026-h1 closes)
  christmas-cards/
    index.md
    2024.md                  ← per-recipient list lives in the body as a checkable markdown list
    2025.md
    2026.md                  ← current
  annual-physical/
    index.md
    2024.md
    2025.md
pending-clear/               ← ticket files for the LLM-clear pattern (Phase 1)
  <pendingId>.json
```

`index.md` frontmatter holds the structured fields a form would gather (cadence, deadlines, reminder lead-time, conditional-trigger flag, etc.). Free-form notes go in the body. Per-instance files (`<year>.md` or `<year>-<half>.md`) carry instance-specific frontmatter (status, due date, paid-on date, recipients-list state) and the free-form notes Claude wrote when summarising last year.

**Why markdown-with-frontmatter, not JSON:**
- Matches `data/wiki/`, `data/todos/`, the journal — already the in-tree convention for "files are the database"
- Free-form notes go in the body where the user can read / edit them outside the app (the local-first promise)
- Diff between years is markdown-line diff, easily summarisable by Claude

### MCP tool surface

One MCP tool, `manageEncore`, with a discriminated `kind` (matches debug-plugin / bookmarks-plugin convention). LLM-callable actions only — internal browser dispatch actions (used by the Encore page UI) are NOT exposed in `TOOL_DEFINITION`.

Proposed actions (LLM-visible):

| `kind` | Purpose |
|---|---|
| `setup` | Create a new obligation from `presentForm` field values. Args: `{ id, displayName, schedule, reminderLeadDays, conditionalTrigger?, fields }` |
| `markInstanceState` | Advance an instance ("paid", "skipped", "received", "done"). Optional notes. Calls `notifier.clear()` for the source notification via the LLM-clear pending ticket |
| `recordResponse` | Generic structured-response handler for conditional-trigger flows (e.g. W-2). Accepts a JSON payload Claude built from the conversation; the plugin merges it into the instance's frontmatter |
| `query` | Read-side. List obligations, get an instance, "what changed from last year". Lazy diff — Claude calls this to draft the carry-forward summary on demand |
| `snooze` | Push a reminder out by N days (or to a specific date). Updates the instance's frontmatter |

Each action takes `pendingId` when it's the resolution of a notification-seeded chat — the handler reads `pending-clear/<pendingId>.json` and calls `notifier.clear()` as a side effect.

### Tick logic

Single hourly heartbeat (`runtime.tasks.register({ schedule: { type: "interval", intervalMs: 60 * 60 * 1000 }, run })`). Each tick:

1. List `obligations/*/index.md` — for each obligation:
2. Compute the current open instance (or create one if the cadence says it's time)
3. Evaluate reminder rules against the instance's state:
   - "X days before deadline AND no progress" → fire a `nudge` action notification
   - "Y days after the conditional-trigger window opened AND not yet confirmed" → fire a `nudge` action notification with a seeded chat
   - "deadline passed AND not closed" → fire an `urgent` action notification
4. For each notification, decide whether it's already pending (notification-id stored in instance frontmatter, e.g. `currentNudgeId: <uuid>`) — skip if so to avoid duplicates
5. For freshly-fired notifications that need a chat (the conditional-trigger and "did-you" reminders): also call `runtime.chat.start` with a seed prompt that references the instance + a fresh `pendingId`, write the pending-clear ticket, set `navigateTarget: /chat/<chatId>`

The tick is **idempotent and crash-safe**: every state transition is a write to disk; a tick that crashes mid-loop loses nothing because the next tick re-evaluates from current disk state.

### Setup flow (chat-driven)

1. User says "I need to pay real estate tax for my second home, twice a year" in any chat
2. Claude (the agent itself, no Encore code) decides this is an Encore-shaped statement and calls `presentForm` with a schema that asks for: address, months, reminder-lead, free-form notes
3. User fills the form
4. Claude reads the form values and calls `manageEncore({ kind: "setup", ... })`
5. The handler writes `obligations/<slugified-id>/index.md` with the frontmatter + body
6. Claude tells the user "set up — next reminder ~3 weeks before March 15"

The `presentForm` schema is owned by Encore (returned from a `manageEncore({ kind: "describe-form" })` query? Or hardcoded in the plugin's `prompt` field on `TOOL_DEFINITION`?). **Open decision** — see below.

### Closing / carry-forward flow

When an instance closes (Claude calls `markInstanceState` with terminal state, or user marks it on the page):

1. Update `<year>.md` frontmatter with closed status + closed-at timestamp
2. Append closing notes (Claude can write a one-paragraph summary of how this year went)
3. **Provision next year's instance file** — `<next-year>.md` is created from the obligation's cadence rules, with frontmatter pre-populated from carry-forward defaults (recipient list copied, address copied, last year's CPA email retained, etc.)
4. Anything marked "skip until X" or "remove" in this year's frontmatter is honoured in next year's
5. The next reminder is scheduled relative to the new instance's deadline

**Carry-forward is plugin code, not LLM logic.** The vision doc's "the Tanakas are already on this year's list" is straightforward file-copy with state-aware filtering; the LLM only writes the human-readable summary, not the structured carryover.

### View.vue / Preview.vue

- **`View.vue`** — the Encore page. Two surfaces:
  - List view: every obligation, its current open instance, a glanceable status (next reminder, days until deadline)
  - Detail view: clicked obligation. Last year's instance side-by-side with this year's. Free-form notes inline, structured frontmatter as a small sidebar.
- **`Preview.vue`** — when Claude returns a tool result Encore renders the plugin card. e.g. `setup` → "Obligation X created, next reminder Y", `markInstanceState` → "Instance closed, next year's open".

UI strings via i18n in all 8 locales. Plugin-seeded chat chip already handled by Phase 1 (no Encore code).

## Open design decisions

These need direction before implementation starts. Each one is small enough to talk through individually.

1. **Per-instance file granularity.** One file per year (e.g. `2026.md`), or one per natural cycle (`2026-h1.md` for property-tax twice-a-year)? My lean: per-cycle, with a deterministic ID derived from the obligation's cadence rule. Simple cases collapse to per-year.
2. **`presentForm` schema source.** Hardcoded per-obligation-type (Encore knows about "annual-tax-filing" / "recurring-card-list" / "annual-checkpoint" shapes), or one generic schema with optional fields? My lean: a small set of named templates owned by Encore — Claude picks the closest match when invoking `presentForm`.
3. **Diff timing.** Eager (write a `diff.md` alongside `<year>.md` at provisioning time) or lazy (`manageEncore({ kind: "query", ... })` returns last-year + this-year and Claude composes the diff inline when the user opens it). My lean: lazy. Eager is wasteful if the user never opens it; lazy fits "Claude is the intelligent interface."
4. **Conditional-trigger UI.** The "remind me when W-2 arrives" path needs the user to mark the trigger satisfied. Options: chat-only (Claude asks via the seeded chat from Phase 1's `chat.start`) or also a button on the Encore page. My lean: both — chat is primary, the page is an escape hatch for users who'd rather click than say.
5. **Notification dedup strategy.** Track `currentNudgeId` on the instance's frontmatter and skip re-firing while it's still active in the bell? Or rely on the LLM-clear ticket as the dedup token? My lean: track per-instance `activeNotificationId` in frontmatter; the tick skips firing if the id is still present in `notifier`'s active list.
6. **Tick cadence.** Hourly is fine for "remind 3 weeks before" reminders, but if we want notifications to land at a specific local time-of-day (so a morning reminder doesn't show up at 3 AM) we either (a) use `daily` schedule + per-obligation hour preference, or (b) keep hourly + filter inside `run()` based on user's preferred hour. My lean: hourly + filter — gives finer control, no schedule explosion.
7. **Storage of pending-clear tickets.** Phase 1's debug-plugin uses `pending-clear/<pendingId>.json` directly under `data/plugins/<pkg>/`. For Encore, group under `obligations/<id>/pending/<pendingId>.json` so a deleted obligation cleans up its tickets? Or keep flat? My lean: flat under `pending-clear/` — keeps the tick scan simple; orphan tickets are pruned on a separate sweep.
8. **`prompt` field on `TOOL_DEFINITION`.** This is what the host injects into the system prompt to teach Claude when to invoke Encore vs other tools. The vision doc's "Claude — powered by Claude Code beneath MulmoClaude — recognizes the shape of what you said" depends on a sharp prompt. Worth iterating on with real test conversations once the rest is shipped.

## Sub-phases (suggested implementation order within Phase 2)

To keep the PRs reviewable, suggest splitting Phase 2 into three landings:

| Sub-phase | Scope | Reviewable size |
|---|---|---|
| 2.1 — Skeleton + setup | Plugin scaffolding (`packages/encore-plugin/`, `package.json`, build). `manageEncore({ kind: "setup" })` + obligation file write. `View.vue` list-only. Tick handler that does NOTHING but exist (no reminders yet). i18n strings | Small, lands the plugin |
| 2.2 — Reminders + LLM-clear flow | Tick reminder logic. Action notifications. `chat.start` seed prompts. LLM-clear via `manageEncore({ kind: "markInstanceState" / "recordResponse", pendingId })` | Medium |
| 2.3 — Per-instance pages + carry-forward + diff | `View.vue` detail surface. Closing flow → next-instance provisioning. Lazy diff via `query` action. `Preview.vue` cards | Medium |

Each sub-phase is independently shippable: 2.1 alone gives the user "I can describe an obligation in chat and it gets stored"; 2.2 adds "I get reminded at the right time"; 2.3 adds "the page is genuinely useful for browsing."

## Out of scope (for all of Phase 2)

- **Multi-user / sync.** Local-only. The carry-forward across MulmoClaude instances is solved by the workspace already being on the user's filesystem.
- **External calendar integration.** No iCal export, no Google Calendar push. The reminders ride MulmoClaude's notification surface only.
- **Image OCR / document parsing.** When Claude asks the user for a W-2 photo and gets one, the photo's path is recorded in the instance — no auto-extraction. Future enhancement.
- **Encrypted obligations.** Tax docs / medical history sit in the workspace as plain markdown, same as everything else. Filesystem-level encryption is the user's concern.
- **`gui-chat-protocol@0.4.0` upstream.** Phase 3, can land in parallel with or after Phase 2.

## Test plan (anticipated)

- **Unit tests** for: obligation file read/write, instance creation rules, reminder evaluation logic, carry-forward defaults
- **Integration tests** that exercise the full tick → notify → seeded chat → tool call → clear flow against a tmpdir workspace (similar pattern to `test/plugins/test_bookmarks_integration.ts`)
- **Manual scenarios** matching the vision doc's three scenes: Christmas cards (fan-out), property tax (multi-step pipeline), W-2 (conditional trigger)
- **i18n coverage** for all new strings in 8 locales

## Follow-ups (out of Phase 2)

- **Phase 3 — `gui-chat-protocol@0.4.0` upstream.** Move `tasks`, `chat`, `notifier` into the protocol; drop the cast across all consumers including encore-plugin.
- **Encore docs.** Once Phase 2 ships, write `docs/encore.md` (user-facing) and a section in `docs/plugin-runtime.md` (the LLM-clear pattern as the canonical example for plugin authors).
- **Voice setup.** "I need to pay property tax twice a year" by voice → presentForm with values pre-populated by transcription.
