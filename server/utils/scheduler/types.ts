// Scheduler type definitions. Zero dependencies on MulmoClaude —
// this module is a pure library that can be tested in isolation.

// ── Schedule ─────────────────────────────────────────────────────

/** When a task should fire. All times are UTC. */
export type TaskSchedule =
  | { type: "interval"; intervalSec: number }
  | { type: "daily"; time: string } // "HH:MM" UTC
  | { type: "weekly"; daysOfWeek: number[]; time: string } // 0=Sun..6=Sat
  | { type: "once"; at: string }; // ISO 8601 UTC

// ── Missed-run policy ────────────────────────────────────────────

/** What to do when the scheduler discovers missed windows. */
export type MissedRunPolicy =
  | "skip" // time-sensitive — discard silently
  | "run-once" // catch up with one run (latest missed window)
  | "run-all"; // catch up with min(N, MAX_CATCHUP) runs

// ── Task origin ──────────────────────────────────────────────────

export type TaskOrigin =
  | { kind: "system"; module: string }
  | { kind: "skill"; skillPath: string }
  | { kind: "user" };

// ── Execution context ────────────────────────────────────────────

/** Passed to every task executor so it knows *which window* it's
 *  running for (critical for run-all catch-up). */
export interface TaskRunContext {
  scheduledFor: string; // ISO 8601 UTC — the window this run targets
  trigger: "scheduled" | "catch-up" | "manual";
}

// ── Persisted task state ─────────────────────────────────────────

export interface TaskExecutionState {
  taskId: string;
  lastRunAt: string | null; // ISO UTC — null = never run
  lastRunResult: "success" | "error" | "skipped" | null;
  lastRunDurationMs: number | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  nextScheduledAt: string | null; // pre-computed for UI display
}

export function emptyState(taskId: string): TaskExecutionState {
  return {
    taskId,
    lastRunAt: null,
    lastRunResult: null,
    lastRunDurationMs: null,
    lastErrorMessage: null,
    consecutiveFailures: 0,
    totalRuns: 0,
    nextScheduledAt: null,
  };
}

// ── Execution log entry ──────────────────────────────────────────

export interface TaskLogEntry {
  taskId: string;
  taskName: string;
  scheduledFor: string;
  startedAt: string;
  completedAt: string;
  result: "success" | "error" | "skipped";
  durationMs: number;
  trigger: "scheduled" | "catch-up" | "manual";
  errorMessage?: string;
  chatSessionId?: string;
}
