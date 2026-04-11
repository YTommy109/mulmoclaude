# Routines — Design Document

## 1) Overview

A **Routine** is a user-defined recurring job that invokes the LLM agent on a schedule. Examples:

- "Search X on topic related to OpenAI, and write the summary article on Office role at 4am Pacific time everyday"
- "Summarize my calendar events for today at 8am"
- "Check my todos and send a digest every Monday at 9am"

Routines sit on top of the Task Manager. Each routine is a persistent record stored in `{workspace}/tasks/tasks.json`. On server boot, routines are loaded from this file and registered with the Task Manager. The Task Manager handles the scheduling; Routines handles persistence and LLM invocation.

---

## 2) Design Goals and Non-Goals

### Goals
1. **Persistent** — routines survive server restarts via `tasks.json`.
2. **LLM-driven** — each routine invokes `runAgent()` with a role and prompt.
3. **Simple storage** — one JSON file, no database.
4. **Registerable by user or LLM** — via REST API or tool call.

### Non-Goals
1. Complex scheduling (weekly, cron) — only `daily` and `interval` for now, matching the Task Manager.
2. Output routing (email, notification, etc.) — output goes to a chat session file in `workspace/chat/`.
3. Editing routines in a UI — users can view/edit `tasks.json` directly or via FilesView.

---

## 3) Data Model

```ts
interface Routine {
  id: string;                    // unique, stable across restarts (e.g., UUID)
  name: string;                  // human-readable label
  roleId: string;                // which role to invoke (e.g., "office", "general")
  prompt: string;                // the message sent to the agent
  schedule: TaskSchedule;        // reuses TaskSchedule from task-manager
  enabled: boolean;              // can be toggled without deleting
  createdAt: string;             // ISO timestamp
}
```

### `tasks.json` format

```json
{
  "routines": [
    {
      "id": "a1b2c3",
      "name": "Daily OpenAI summary",
      "roleId": "office",
      "prompt": "Search X on topic related to OpenAI, and write the summary article.",
      "schedule": { "type": "daily", "time": "11:00" },
      "enabled": true,
      "createdAt": "2026-04-11T00:00:00Z"
    }
  ]
}
```

Note: `schedule.time` for daily is in UTC. The API layer converts user-specified local time (e.g., "4am Pacific") to UTC before storing.

---

## 4) Architecture

```text
tasks.json (persistence)
    ↕ load/save
Routines module
    ↕ registerTask / removeTask
Task Manager (scheduling)
    ↕ tick fires run()
runAgent() (LLM invocation)
    ↕ output
workspace/chat/{sessionId}.jsonl
```

### Boot sequence

1. Server starts, creates Task Manager.
2. Routines module loads `tasks.json`.
3. For each enabled routine, registers a task with the Task Manager whose `run()` calls `runAgent()`.
4. Task Manager `start()` begins ticking.

### Runtime changes

When a routine is created/updated/deleted via API:
1. Update the in-memory list.
2. Write `tasks.json` to disk.
3. Call `removeTask()` / `registerTask()` on the Task Manager to sync.

---

## 5) Server API

```ts
// POST /api/routines         — create a routine
// GET  /api/routines         — list all routines
// PUT  /api/routines/:id     — update a routine
// DELETE /api/routines/:id   — delete a routine
```

### Create

```ts
interface CreateRoutineBody {
  name: string;
  roleId: string;
  prompt: string;
  schedule: TaskSchedule;
  enabled?: boolean;             // default: true
}
```

Returns the created `Routine` with generated `id` and `createdAt`.

### Update

Accepts partial fields. If `schedule` or `enabled` changes, the corresponding Task Manager registration is updated (remove + re-register).

### Delete

Removes from `tasks.json` and calls `removeTask()` on the Task Manager.

---

## 6) LLM Execution

When the Task Manager fires a routine's task:

```ts
async function executeRoutine(routine: Routine): Promise<void> {
  const role = getRole(routine.roleId);
  const sessionId = uuidv4();

  for await (const event of runAgent(
    routine.prompt,
    role,
    workspacePath,
    sessionId,
    PORT,
  )) {
    // Events are written to workspace/chat/{sessionId}.jsonl
    // by the agent infrastructure automatically.
    // We just need to drain the generator.
  }
}
```

The output ends up in `workspace/chat/` as a normal chat session. Users can review routine results alongside regular conversations.

---

## 7) File/Module Plan

```text
server/
  routines/
    index.ts                // loadRoutines, createRoutine, deleteRoutine, etc.
    types.ts                // Routine interface
  routes/
    routines.ts             // REST endpoints

workspace/
  tasks/
    tasks.json              // persisted routines
```

The `tasks` subdirectory needs to be added to `SUBDIRS` in `server/workspace.ts`.

---

## 8) Required Changes to Task Manager

The current Task Manager works as-is for Routines. No changes to its API or scheduling logic are needed.

One consideration: the Task Manager currently throws if a task ID is already registered. On boot, if `tasks.json` has routines and they are registered before `start()`, this is fine. But if the Routines module tries to re-register after a hot reload (e.g., during development), it would throw. Two options:

- **Option A**: Add an `upsertTask()` method to the Task Manager that replaces if exists.
- **Option B**: Always call `removeTask()` before `registerTask()` in the Routines module.

Option B requires no Task Manager changes. Prefer Option B for now.

---

## 9) Timezone Handling

Users specify times in local time (e.g., "4am Pacific"). The Routines API converts to UTC before storing in `tasks.json`. The Task Manager only deals with UTC.

Conversion happens in the API layer using standard `Intl.DateTimeFormat` or a helper function. The stored `schedule.time` is always UTC `"HH:MM"`.

The original user-specified time and timezone could optionally be stored as metadata for display purposes, but the scheduling logic only sees UTC.

---

## 10) Decision Summary

Routines is a thin persistence and LLM-invocation layer on top of the Task Manager. It owns `tasks.json` for storage, converts user schedules to UTC, and registers tasks whose `run()` calls `runAgent()`. The Task Manager is unchanged — it just sees normal task definitions. Output goes to `workspace/chat/` as regular sessions.
