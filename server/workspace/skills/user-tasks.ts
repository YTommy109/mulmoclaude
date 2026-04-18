// User-created scheduled tasks (#357 Phase 3).
//
// Users can create tasks via the API or MCP tool. Each task fires
// `startChat()` with its prompt when the schedule triggers.
//
// Tasks are persisted in `config/scheduler/tasks.json` and
// registered with the task-manager at startup. CRUD operations
// trigger a refresh that unregisters old tasks and registers new ones.

import { WORKSPACE_FILES } from "../../../src/config/workspacePaths.js";
import { workspacePath } from "../paths.js";
import { loadJsonFile } from "../../utils/files/json.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { resolvePath } from "../../utils/files/workspace-io.js";
import path from "path";
import { mkdir } from "fs/promises";
import type { MissedRunPolicy } from "@receptron/task-scheduler";
import { SCHEDULE_TYPES, MISSED_RUN_POLICIES } from "@receptron/task-scheduler";
import type { TaskSchedule as LocalTaskSchedule } from "../../events/task-manager/index.js";
import { DEFAULT_ROLE_ID } from "../../../src/config/roles.js";
import { log } from "../../system/logger/index.js";
import type { ITaskManager } from "../../events/task-manager/index.js";

// ── Types ───────────────────────────────────────────────────────

export interface PersistedUserTask {
  id: string;
  name: string;
  description: string;
  schedule: LocalTaskSchedule;
  missedRunPolicy: MissedRunPolicy;
  enabled: boolean;
  roleId: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserTaskInput {
  name: string;
  description?: string;
  schedule: LocalTaskSchedule;
  missedRunPolicy?: MissedRunPolicy;
  roleId?: string;
  prompt: string;
}

// ── I/O ─────────────────────────────────────────────────────────

const root = (r?: string) => r ?? workspacePath;

export function loadUserTasks(r?: string): PersistedUserTask[] {
  const tasks = loadJsonFile<PersistedUserTask[]>(
    resolvePath(root(r), WORKSPACE_FILES.schedulerUserTasks),
    [],
  );
  return Array.isArray(tasks) ? tasks : [];
}

export async function saveUserTasks(
  tasks: PersistedUserTask[],
  r?: string,
): Promise<void> {
  const filePath = resolvePath(root(r), WORKSPACE_FILES.schedulerUserTasks);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, JSON.stringify(tasks, null, 2));
}

// ── Validation ──────────────────────────────────────────────────

function isValidSchedule(s: unknown): s is LocalTaskSchedule {
  if (typeof s !== "object" || s === null) return false;
  const obj = s as Record<string, unknown>;
  if (obj.type === SCHEDULE_TYPES.interval) {
    return typeof obj.intervalMs === "number" && obj.intervalMs > 0;
  }
  if (obj.type === SCHEDULE_TYPES.daily) {
    return typeof obj.time === "string" && /^\d{2}:\d{2}$/.test(obj.time);
  }
  return false;
}

function isValidMissedRunPolicy(p: unknown): p is MissedRunPolicy {
  return (
    p === MISSED_RUN_POLICIES.skip ||
    p === MISSED_RUN_POLICIES.runOnce ||
    p === MISSED_RUN_POLICIES.runAll
  );
}

export type ValidateResult =
  | { kind: "ok"; task: PersistedUserTask }
  | { kind: "error"; error: string };

export function validateAndCreate(input: unknown): ValidateResult {
  if (typeof input !== "object" || input === null) {
    return { kind: "error", error: "request body required" };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    return { kind: "error", error: "name required" };
  }
  if (typeof obj.prompt !== "string" || obj.prompt.trim().length === 0) {
    return { kind: "error", error: "prompt required" };
  }
  if (!isValidSchedule(obj.schedule)) {
    return { kind: "error", error: "valid schedule required" };
  }
  const missedRunPolicy = isValidMissedRunPolicy(obj.missedRunPolicy)
    ? obj.missedRunPolicy
    : MISSED_RUN_POLICIES.runOnce;
  const roleId = typeof obj.roleId === "string" ? obj.roleId : DEFAULT_ROLE_ID;

  const now = new Date().toISOString();
  const task: PersistedUserTask = {
    id: crypto.randomUUID(),
    name: obj.name.trim(),
    description:
      typeof obj.description === "string" ? obj.description.trim() : "",
    schedule: obj.schedule,
    missedRunPolicy,
    enabled: true,
    roleId,
    prompt: obj.prompt.trim(),
    createdAt: now,
    updatedAt: now,
  };
  return { kind: "ok", task };
}

export type UpdateResult =
  | { kind: "ok"; tasks: PersistedUserTask[] }
  | { kind: "error"; error: string };

export function applyUpdate(
  tasks: PersistedUserTask[],
  id: string,
  patch: Record<string, unknown>,
): UpdateResult {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) {
    return { kind: "error", error: `task not found: ${id}` };
  }
  const existing = tasks[idx];
  const updated: PersistedUserTask = { ...existing };

  if (typeof patch.name === "string" && patch.name.trim().length > 0) {
    updated.name = patch.name.trim();
  }
  if (typeof patch.description === "string") {
    updated.description = patch.description.trim();
  }
  if (isValidSchedule(patch.schedule)) {
    updated.schedule = patch.schedule;
  }
  if (isValidMissedRunPolicy(patch.missedRunPolicy)) {
    updated.missedRunPolicy = patch.missedRunPolicy;
  }
  if (typeof patch.enabled === "boolean") {
    updated.enabled = patch.enabled;
  }
  if (typeof patch.roleId === "string") {
    updated.roleId = patch.roleId;
  }
  if (typeof patch.prompt === "string" && patch.prompt.trim().length > 0) {
    updated.prompt = patch.prompt.trim();
  }
  updated.updatedAt = new Date().toISOString();

  const next = [...tasks];
  next[idx] = updated;
  return { kind: "ok", tasks: next };
}

// ── Task registration ───────────────────────────────────────────

const USER_TASK_PREFIX = "user.";
let registeredUserTaskIds = new Set<string>();
let cachedUserTaskDeps: UserTaskDeps | null = null;
let userTaskMutex: Promise<number> = Promise.resolve(0);

export interface UserTaskDeps {
  taskManager: ITaskManager;
  startChat: (params: {
    message: string;
    roleId: string;
    chatSessionId: string;
  }) => Promise<{ kind: string; error?: string }>;
}

export async function registerUserTasks(deps: UserTaskDeps): Promise<number> {
  cachedUserTaskDeps = deps;
  return serializedRefreshUserTasks(deps);
}

export async function refreshUserTasks(): Promise<number> {
  if (!cachedUserTaskDeps) {
    log.warn("user-tasks", "refreshUserTasks called before initial register");
    return 0;
  }
  return serializedRefreshUserTasks(cachedUserTaskDeps);
}

function serializedRefreshUserTasks(deps: UserTaskDeps): Promise<number> {
  userTaskMutex = userTaskMutex.then(
    () => doRegisterUserTasks(deps),
    () => doRegisterUserTasks(deps),
  );
  return userTaskMutex;
}

async function doRegisterUserTasks(deps: UserTaskDeps): Promise<number> {
  const { taskManager, startChat } = deps;

  for (const taskId of registeredUserTaskIds) {
    taskManager.removeTask(taskId);
  }
  const previousCount = registeredUserTaskIds.size;
  registeredUserTaskIds = new Set<string>();

  const tasks = loadUserTasks();
  let registered = 0;

  for (const task of tasks) {
    if (!task.enabled) continue;

    const taskId = `${USER_TASK_PREFIX}${task.id}`;
    taskManager.registerTask({
      id: taskId,
      description: `User task: ${task.name}`,
      schedule: task.schedule,
      run: async () => {
        const chatSessionId = crypto.randomUUID();
        log.info("user-tasks", "running user task", {
          name: task.name,
          roleId: task.roleId,
          chatSessionId,
        });
        const result = await startChat({
          message: task.prompt,
          roleId: task.roleId,
          chatSessionId,
        });
        if (result.kind === "error") {
          throw new Error(`user task failed: ${result.error ?? "unknown"}`);
        }
        log.info("user-tasks", "user task completed", {
          name: task.name,
          kind: result.kind,
        });
      },
    });

    registeredUserTaskIds.add(taskId);
    registered++;
  }

  if (previousCount > 0 || registered > 0) {
    log.info("user-tasks", "user tasks refreshed", {
      previous: previousCount,
      current: registered,
    });
  }

  return registered;
}
