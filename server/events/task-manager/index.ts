import { log } from "../../system/logger/index.js";

export type TaskSchedule =
  | { type: "interval"; intervalMs: number }
  | { type: "daily"; time: string }; // time: "HH:MM" in UTC

export interface TaskRunContext {
  taskId: string;
  now: Date;
}

export interface TaskDefinition {
  id: string;
  description?: string;
  schedule: TaskSchedule;
  enabled?: boolean; // default: true
  run: (ctx: TaskRunContext) => Promise<void>;
}

export interface ITaskManager {
  registerTask(def: TaskDefinition): void;
  removeTask(taskId: string): void;
  start(): void;
  stop(): void;
  listTasks(): Array<{
    id: string;
    description?: string;
    schedule: TaskSchedule;
  }>;
}

export interface TaskManagerOptions {
  tickMs?: number; // default: 60_000
  now?: () => Date; // default: () => new Date()
}

function isDue(now: Date, schedule: TaskSchedule, tickMs: number): boolean {
  if (schedule.type === "interval") {
    const msSinceMidnight =
      now.getUTCHours() * 3600000 +
      now.getUTCMinutes() * 60000 +
      now.getUTCSeconds() * 1000;
    // Round down to tick boundary, then check if it aligns with the interval
    const rounded = Math.floor(msSinceMidnight / tickMs) * tickMs;
    return rounded % schedule.intervalMs === 0;
  }

  if (schedule.type === "daily") {
    const [hh, mm] = schedule.time.split(":").map(Number);
    const targetMs = hh * 3600000 + mm * 60000;
    const msSinceMidnight =
      now.getUTCHours() * 3600000 +
      now.getUTCMinutes() * 60000 +
      now.getUTCSeconds() * 1000;
    const rounded = Math.floor(msSinceMidnight / tickMs) * tickMs;
    return rounded === targetMs;
  }

  return false;
}

export function createTaskManager(options?: TaskManagerOptions): ITaskManager {
  const tickMs = options?.tickMs ?? 60_000;
  const now = options?.now ?? (() => new Date());
  const registry = new Map<string, TaskDefinition>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function onTick() {
    const currentTime = now();
    for (const def of registry.values()) {
      if (def.enabled === false) continue;
      if (!isDue(currentTime, def.schedule, tickMs)) continue;

      def.run({ taskId: def.id, now: currentTime }).catch((err) => {
        log.error("task-manager", "task failed", {
          id: def.id,
          error: String(err),
        });
      });
    }
  }

  return {
    registerTask(def: TaskDefinition) {
      if (registry.has(def.id)) {
        throw new Error(
          `[task-manager] Task "${def.id}" is already registered`,
        );
      }
      registry.set(def.id, def);
      log.info("task-manager", "registered", { id: def.id });
    },

    removeTask(taskId: string) {
      if (registry.delete(taskId)) {
        log.info("task-manager", "removed", { id: taskId });
      }
    },

    start() {
      if (timer) return;
      timer = setInterval(onTick, tickMs);
      log.info("task-manager", "started", { tickMs });
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        log.info("task-manager", "stopped");
      }
    },

    listTasks() {
      return [...registry.values()].map((d) => ({
        id: d.id,
        description: d.description,
        schedule: d.schedule,
      }));
    },
  };
}
