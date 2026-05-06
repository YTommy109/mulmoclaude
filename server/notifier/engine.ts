// Notifier engine — single-process, single-file, single-channel.
//
// API surface: publish / clear / cancel / get / listFor / listAll.
// Mutations queue through a writing-flag + waiter-queue coordinator
// so concurrent callers can't race on the underlying `writeFileAtomic`
// rename. Reads bypass the queue (`writeFileAtomic`'s rename
// atomicity makes half-reads impossible) and trade strict
// linearisability for simpler code: the contract is "after `await
// publish(x)` resolves, subsequent reads see x" — which holds because
// `publish` awaits the persist before returning.

import { randomUUID } from "crypto";
import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.js";
import { log } from "../system/logger/index.js";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { loadActive, saveActive } from "./store.js";
import type { NotifierEntry, NotifierEvent, NotifierFile, PublishInput } from "./types.js";

// ── Dependency injection (matches server/events/notifications.ts) ──

export interface NotifierDeps {
  publish: (channel: string, payload: unknown) => void;
}

let deps: NotifierDeps | null = null;

export function initNotifier(injected: NotifierDeps): void {
  deps = injected;
}

function emit(event: NotifierEvent): void {
  if (!deps) {
    // Calling a mutation API before `initNotifier` runs would mean
    // emitting into the void. We log and continue (state still
    // persists) so the engine remains usable if startup ordering
    // ever changes — but in practice `initNotifier` is wired in
    // `startRuntimeServices`, before any HTTP request can arrive.
    log.warn("notifier", "emit before init", { type: event.type });
    return;
  }
  deps.publish(PUBSUB_CHANNELS.notifier, event);
}

// ── Write coordinator ─────────────────────────────────────────────

/** A mutation function applied to the in-memory state object during
 *  drain. Returns the event to emit, or `null` to indicate "no
 *  state change" — the drainer skips the disk write and the emit
 *  when every mutation in a batch returned `null`.
 *
 *  Mutations MUST NOT modify state when returning `null` (see
 *  `clear` / `cancel` for the unknown-id case). Violating this
 *  invariant produces a write skip with stale on-disk state. */
type Mutation = (state: NotifierFile) => NotifierEvent | null;

interface Waiter {
  mutate: Mutation;
  resolve: () => void;
  reject: (err: unknown) => void;
}

type MutationResult = { ok: true; event: NotifierEvent | null } | { ok: false; error: unknown };

let writing = false;
let waiters: Waiter[] = [];

let activeFilePath: string = WORKSPACE_PATHS.notifierActive;

/** Test-only: redirect the engine at a temp file. Kept off the public
 *  API surface (the underscore prefix + the `_setActiveFilePathForTesting`
 *  name) so production code can't accidentally rebind. Resets the queue
 *  too — a leftover write in flight from a previous test would
 *  otherwise persist into the next test's tmp dir. */
export function _setActiveFilePathForTesting(filePath: string): void {
  activeFilePath = filePath;
  writing = false;
  waiters = [];
}

function applyBatchMutations(batch: Waiter[], state: NotifierFile): MutationResult[] {
  return batch.map((waiter) => {
    try {
      return { ok: true, event: waiter.mutate(state) };
    } catch (err) {
      return { ok: false, error: err };
    }
  });
}

function collectEvents(results: MutationResult[]): NotifierEvent[] {
  const events: NotifierEvent[] = [];
  for (const result of results) {
    if (result.ok && result.event !== null) events.push(result.event);
  }
  return events;
}

function settleBatch(batch: Waiter[], results: MutationResult[]): void {
  // Resolves come AFTER any emits so subscribers see the event
  // before the caller's `await` returns.
  for (let index = 0; index < batch.length; index += 1) {
    const result = results[index];
    if (result.ok) batch[index].resolve();
    else batch[index].reject(result.error);
  }
}

function rejectBatch(batch: Waiter[], err: unknown): void {
  for (const waiter of batch) waiter.reject(err);
}

async function processBatch(batch: Waiter[]): Promise<void> {
  let state: NotifierFile;
  try {
    state = await loadActive(activeFilePath);
  } catch (err) {
    log.error("notifier", "load failed", { error: String(err) });
    rejectBatch(batch, err);
    return;
  }
  const results = applyBatchMutations(batch, state);
  const events = collectEvents(results);
  if (events.length > 0) {
    try {
      await saveActive(activeFilePath, state);
    } catch (err) {
      log.error("notifier", "write failed", { error: String(err) });
      // A failing write means none of this batch's state changes are
      // durable. Reject every waiter — including any whose mutation
      // returned `null` — because the batch as a whole failed to
      // commit. Resolving the no-ops while rejecting the contributors
      // would let a sibling caller observe a "succeeded" no-op clear
      // alongside a publish that didn't actually persist.
      rejectBatch(batch, err);
      return;
    }
    for (const event of events) emit(event);
  }
  settleBatch(batch, results);
}

async function drain(): Promise<void> {
  writing = true;
  try {
    while (waiters.length > 0) {
      const batch = waiters;
      waiters = [];
      await processBatch(batch);
    }
  } finally {
    writing = false;
  }
}

function enqueue(mutate: Mutation): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    waiters.push({ mutate, resolve, reject });
    // First caller while idle kicks off the drain; subsequent callers
    // just leave their resolver in the queue. `void` because drain is
    // fire-and-forget — the per-waiter promise is the resolution
    // path the caller awaits.
    if (!writing) void drain();
  });
}

function removeEntry(state: NotifierFile, entryId: string): NotifierFile["entries"] {
  // `delete state.entries[id]` is the obvious form, but the codebase
  // bans dynamic delete (`@typescript-eslint/no-dynamic-delete`).
  // Object-rest excludes the key without invoking `delete`.
  const { [entryId]: __removed, ...remaining } = state.entries;
  return remaining;
}

// ── Public API ────────────────────────────────────────────────────

export async function publish<TPluginData = unknown>(input: PublishInput<TPluginData>): Promise<{ id: string }> {
  const entryId = randomUUID();
  const entry: NotifierEntry<TPluginData> = {
    id: entryId,
    pluginPkg: input.pluginPkg,
    severity: input.severity,
    lifecycle: input.lifecycle,
    title: input.title,
    body: input.body,
    pluginData: input.pluginData,
    createdAt: new Date().toISOString(),
  };
  await enqueue((state) => {
    state.entries[entryId] = entry as NotifierEntry;
    return { type: "published", entry: entry as NotifierEntry };
  });
  return { id: entryId };
}

export async function clear(entryId: string): Promise<void> {
  await enqueue((state) => {
    if (!(entryId in state.entries)) return null;
    state.entries = removeEntry(state, entryId);
    return { type: "cleared", id: entryId };
  });
}

export async function cancel(entryId: string): Promise<void> {
  await enqueue((state) => {
    if (!(entryId in state.entries)) return null;
    state.entries = removeEntry(state, entryId);
    return { type: "cancelled", id: entryId };
  });
}

export async function get(entryId: string): Promise<NotifierEntry | undefined> {
  const state = await loadActive(activeFilePath);
  return state.entries[entryId];
}

export async function listFor(pluginPkg: string): Promise<NotifierEntry[]> {
  const state = await loadActive(activeFilePath);
  return Object.values(state.entries).filter((entry) => entry.pluginPkg === pluginPkg);
}

export async function listAll(): Promise<NotifierEntry[]> {
  const state = await loadActive(activeFilePath);
  return Object.values(state.entries);
}
