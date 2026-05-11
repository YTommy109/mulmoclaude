---
name: mc-settings
description: Configure the MulmoClaude workspace — news sources, reusable skills, scheduled automations. Edits markdown / JSON files directly under the workspace; the server's auto-refresh hook re-registers affected systems without a restart.
---

# Workspace settings assistant

A bundled MulmoClaude preset skill (`mc-` prefix = launcher-managed; do not edit
this file in the workspace, it is overwritten on every server boot).

## What this skill does

Help the user configure their MulmoClaude workspace. Three areas, each driven
by editing on-disk files directly with the **Read / Write / Edit** tools — no
special `manage*` calls. A `PostToolUse` hook (`<workspace>/.claude/hooks/config-refresh.mjs`)
fires `POST /api/config/refresh` automatically after Write/Edit on the
relevant paths, so changes activate without a server restart.

When the user wants several settings adjusted at once, group the questions into
a single `presentForm` call so they can answer cleanly; otherwise just write
the file.

Always end with a one-line confirmation of what changed (which file, which
slug / id) so the user can verify.

## Workflow 1: register / list / edit / remove information sources

**Triggers**: "register an RSS feed for X", "add the AI papers from arXiv", "show
my sources", "stop following Y".

**Files**: one markdown file per source at `<workspace>/sources/<slug>.md`.

**Read** to inspect — list the directory if the user asked "what's registered"
and read individual files to show details.

**Write** a new source as YAML frontmatter + body:

```markdown
---
slug: ai-news-rss
title: AI News (RSS)
url: https://example.com/ai/feed.xml
fetcher_kind: rss
schedule: hourly
categories:
  - tech
  - ai
max_items_per_fetch: 20
added_at: 2026-05-11T08:00:00.000Z
---

Notes about why this source is on the list — optional body.
```

Field rules:

- `slug` — lowercase, hyphen-separated; matches the filename.
- `fetcher_kind` — `rss` | `github` | `arxiv` (ask the user if you can't tell from the URL).
- `schedule` — `hourly` | `daily` | `weekly` | `on-demand`. Use `hourly` for news polling, `daily` for digest sources, `weekly` for low-traffic, `on-demand` for sources only fetched when explicitly asked.
- `categories` — free-form taxonomy; ask the user if they have a preferred set.
- `max_items_per_fetch` — number, typically 10-50.
- `added_at` — ISO timestamp now.
- For `github`: add `repo: owner/name` and `kind: releases | issues` to the frontmatter. For `arxiv`: add `query: <search query>`.

Source poller re-reads files each cycle, so no extra refresh is needed.

**Edit / Delete** — use Edit for in-place changes, or delete the file when
removing a source.

## Workflow 2: create / list / edit / remove skills

**Triggers**: "skill 化して", "save this as a skill", "what skills do I have", "remove
the foo skill".

**Files**: one SKILL.md per skill at `<workspace>/.claude/skills/<slug>/SKILL.md`.

**Important**: do NOT touch files under `~/.claude/skills/` — those are the
user-scope skills managed outside MulmoClaude. Project-scope skills live under
`<workspace>/.claude/skills/`.

**Write** shape:

```markdown
---
name: <slug>
description: One-line summary that frames when the skill should run.
schedule: daily 09:00      # optional — auto-runs the skill on schedule
roleId: general            # optional — role to use for scheduled runs
---

# <Skill name>

Body in markdown. Written in second person ("first do X, then Y"). Focused on
the reusable workflow, not one-off details.
```

`schedule` and `roleId` are optional. Schedule values: `daily HH:MM` or
`interval Ns` / `Nm` / `Nh`.

The auto-refresh hook re-registers scheduled skills on save, so a new
`schedule:` activates without a server restart.

## Workflow 3: schedule / list / edit / remove automations

**Triggers**: "毎朝 7 時に天気を", "schedule a weekly cleanup", "show my
automations", "stop the foo task".

**File**: `<workspace>/config/scheduler/tasks.json`. Single JSON array.

**Shape**:

```json
[
  {
    "id": "weather-morning",
    "name": "Morning weather",
    "description": "Check today's weather every weekday at 7am.",
    "schedule": { "type": "daily", "time": "07:00" },
    "missedRunPolicy": "runOnceImmediately",
    "enabled": true,
    "roleId": "general",
    "prompt": "What's the weather today?",
    "createdAt": "2026-05-11T08:00:00.000Z",
    "updatedAt": "2026-05-11T08:00:00.000Z"
  }
]
```

Schedule kinds:

- `{ "type": "daily", "time": "HH:MM" }` — daily at the given local time.
- `{ "type": "interval", "intervalMs": <ms> }` — every N ms (60000 = 1 min;
  for "every hour" use 3600000).

`missedRunPolicy` values: `runOnceImmediately` | `skip`. Use `skip` for
news polls (no point catching up), `runOnceImmediately` for status checks.

When suggesting cadences, prefer **hourly** for news polling, **daily** for
digests, **weekly** for cleanup, **every 4 hours** for calendar sync etc.

**Edit** the JSON in place with Edit; the auto-refresh hook re-registers
tasks after the file changes, so cron updates take effect immediately.

## Tone

Friendly, practical. Don't lecture about file paths or JSON shape — show the
result and move on. When the user asks "what's registered?", read the relevant
directory / file and summarise in human language (don't dump the raw JSON
unless they ask).

If a request needs several decisions (e.g. "register an RSS feed and schedule
a daily digest"), use `presentForm` once to collect them all rather than
ping-ponging.
