// Notifier engine — single-process, two-file (active + history),
// single-channel.
//
// API surface: publish / clear / cancel / get / listFor / listAll /
// listHistory. Mutations queue through a writing-flag + waiter-queue
// coordinator so concurrent callers can't race on `writeFileAtomic`'s
// rename. Reads bypass the queue (rename atomicity makes half-reads
// impossible) and trade strict linearisability for simpler code: the
// contract is "after `await publish(x)` resolves, subsequent reads
// see x" — which holds because `publish` awaits the persist before
// returning.
//
// `clear` / `cancel` push to history *before* removing from active.
// History persistence is best-effort: if it fails, the active write
// still wins and the failure is logged. Active is the source of
// truth; history is an audit aid.

import { randomUUID } from "crypto";
import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.js";
import { log } from "../system/logger/index.js";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { loadActive, loadHistory, saveActive, saveHistory } from "./store.js";
import { HISTORY_CAP, type NotifierEntry, type NotifierEvent, type NotifierFile, type NotifierHistoryEntry, type PublishInput } from "./types.js";

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
    log.warn("notifier", "emit before init", { type: event.type });
    return;
  }
  deps.publish(PUBSUB_CHANNELS.notifier, event);
}

// ── Write coordinator ─────────────────────────────────────────────

/** A mutation function applied to the in-memory state object during
 *  drain. Returns either:
 *
 *    - `null` — no state change (e.g., `clear` on an unknown id).
 *      The drainer skips the disk write and the emit if every
 *      mutation in a batch returned `null`.
 *    - `{ event, historyEntry? }` — state changed. The drainer emits
 *      the event after the active write succeeds, and prepends
 *      `historyEntry` to history (best-effort) when present.
 *
 *  Mutations MUST NOT modify state when returning `null`. Violating
 *  this invariant produces a write skip with stale on-disk state. */
type MutationOutcome = { event: NotifierEvent; historyEntry?: NotifierHistoryEntry } | null;
type Mutation = (state: NotifierFile) => MutationOutcome;

interface Waiter {
  mutate: Mutation;
  resolve: () => void;
  reject: (err: unknown) => void;
}

type MutationResult = { ok: true; outcome: MutationOutcome } | { ok: false; error: unknown };

let writing = false;
let waiters: Waiter[] = [];

let activeFilePath: string = WORKSPACE_PATHS.notifierActive;
let historyFilePath: string = WORKSPACE_PATHS.notifierHistory;

/** Test-only: redirect the engine at temp files. Resets the queue too. */
export function _setFilePathsForTesting(paths: { active: string; history: string }): void {
  activeFilePath = paths.active;
  historyFilePath = paths.history;
  writing = false;
  waiters = [];
}

function applyBatchMutations(batch: Waiter[], state: NotifierFile): MutationResult[] {
  return batch.map((waiter) => {
    try {
      return { ok: true, outcome: waiter.mutate(state) };
    } catch (err) {
      return { ok: false, error: err };
    }
  });
}

function collectEvents(results: MutationResult[]): NotifierEvent[] {
  const events: NotifierEvent[] = [];
  for (const result of results) {
    if (result.ok && result.outcome !== null) events.push(result.outcome.event);
  }
  return events;
}

function collectHistoryEntries(results: MutationResult[]): NotifierHistoryEntry[] {
  const entries: NotifierHistoryEntry[] = [];
  for (const result of results) {
    if (result.ok && result.outcome !== null && result.outcome.historyEntry) {
      entries.push(result.outcome.historyEntry);
    }
  }
  return entries;
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

async function persistHistory(newEntries: NotifierHistoryEntry[]): Promise<void> {
  const existing = await loadHistory(historyFilePath);
  // Newest-first ordering: a batch contains terminations in arrival
  // order; we want the last one to land at index 0 of history.
  const merged = [...newEntries.slice().reverse(), ...existing.entries].slice(0, HISTORY_CAP);
  await saveHistory(historyFilePath, { entries: merged });
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
  const historyEntries = collectHistoryEntries(results);

  if (events.length > 0) {
    try {
      await saveActive(activeFilePath, state);
    } catch (err) {
      log.error("notifier", "active write failed", { error: String(err) });
      rejectBatch(batch, err);
      return;
    }
    if (historyEntries.length > 0) {
      // Best-effort: active is the source of truth, history is an
      // audit aid. A failed history write is logged but doesn't
      // unwind the active commit.
      try {
        await persistHistory(historyEntries);
      } catch (err) {
        log.error("notifier", "history write failed", { error: String(err) });
      }
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
    if (!writing) void drain();
  });
}

function removeEntry(state: NotifierFile, entryId: string): NotifierFile["entries"] {
  // The codebase bans dynamic delete; object-rest excludes the key
  // without invoking `delete`.
  const { [entryId]: __removed, ...remaining } = state.entries;
  return remaining;
}

function buildHistoryEntry(entry: NotifierEntry, terminalType: "cleared" | "cancelled"): NotifierHistoryEntry {
  return { ...entry, terminalType, terminalAt: new Date().toISOString() };
}

// ── Public API ────────────────────────────────────────────────────

export async function publish<TPluginData = unknown>(input: PublishInput<TPluginData>): Promise<{ id: string }> {
  // `action` lifecycle constraints. Enforced at the engine boundary
  // so both HTTP callers and plugin-runtime callers hit the same
  // wall. See `feat-notifier-ux.md` for the rationale.
  //
  //   1. `action` requires a non-empty `navigateTarget`. Without
  //      one, the bell click does nothing and the entry is a
  //      degraded fyi.
  //   2. `action` cannot use `info` severity. The two together mean
  //      "low-priority obligation," which is incoherent — if it's
  //      low-priority enough to be info, it's an fyi (just an
  //      informational ping); if it's a real obligation worth a
  //      domain landing page, it's at least `nudge`.
  if (input.lifecycle === "action") {
    if (input.severity === "info") {
      throw new Error("notifier.publish: action lifecycle is incompatible with info severity (use fyi for low-priority pings)");
    }
    if (typeof input.navigateTarget !== "string" || input.navigateTarget.length === 0) {
      throw new Error("notifier.publish: action lifecycle requires a non-empty navigateTarget");
    }
  }
  const entryId = randomUUID();
  const entry: NotifierEntry<TPluginData> = {
    id: entryId,
    pluginPkg: input.pluginPkg,
    severity: input.severity,
    lifecycle: input.lifecycle,
    title: input.title,
    body: input.body,
    navigateTarget: input.navigateTarget,
    pluginData: input.pluginData,
    createdAt: new Date().toISOString(),
  };
  await enqueue((state) => {
    state.entries[entryId] = entry as NotifierEntry;
    return { event: { type: "published", entry: entry as NotifierEntry } };
  });
  return { id: entryId };
}

export async function clear(entryId: string): Promise<void> {
  await enqueue((state) => {
    const entry = state.entries[entryId];
    if (!entry) return null;
    state.entries = removeEntry(state, entryId);
    return {
      event: { type: "cleared", id: entryId },
      historyEntry: buildHistoryEntry(entry, "cleared"),
    };
  });
}

export async function cancel(entryId: string): Promise<void> {
  await enqueue((state) => {
    const entry = state.entries[entryId];
    if (!entry) return null;
    state.entries = removeEntry(state, entryId);
    return {
      event: { type: "cancelled", id: entryId },
      historyEntry: buildHistoryEntry(entry, "cancelled"),
    };
  });
}

/** Plugin-scoped clear. Same as `clear` but no-ops if the entry's
 *  `pluginPkg` doesn't match the caller's. Used by the per-plugin
 *  `runtime.notifier.clear` so a plugin can't dismiss another
 *  plugin's notification by guessing or scraping its id. The
 *  silent no-op (rather than a throw) matches `clear(unknown id)`
 *  semantics — the plugin can't distinguish "id never existed"
 *  from "id belongs to another plugin", which is the intended
 *  isolation property. */
export async function clearForPlugin(pluginPkg: string, entryId: string): Promise<void> {
  await enqueue((state) => {
    const entry = state.entries[entryId];
    if (!entry) return null;
    if (entry.pluginPkg !== pluginPkg) return null;
    state.entries = removeEntry(state, entryId);
    return {
      event: { type: "cleared", id: entryId },
      historyEntry: buildHistoryEntry(entry, "cleared"),
    };
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

export async function listHistory(): Promise<NotifierHistoryEntry[]> {
  const state = await loadHistory(historyFilePath);
  return state.entries;
}
