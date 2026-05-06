// Coverage for `scheduleTestNotification` after PR 4 of feat-encore.
//
// `scheduleTestNotification` no longer takes injected deps — it just
// queues a `setTimeout` that fires `publishNotification`, which in
// turn forwards to the notifier engine. The test runs the engine
// against tmp files and asserts the entry shows up in `listAll()`
// after the timer ticks. Bridge / macOS push are tested via
// `legacy-adapters` separately.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import {
  DEFAULT_NOTIFICATION_MESSAGE,
  DEFAULT_NOTIFICATION_TRANSPORT_ID,
  isLegacyNotifierPluginData,
  scheduleTestNotification,
} from "../../server/events/notifications.ts";
import { _setFilePathsForTesting, initNotifier, listAll } from "../../server/notifier/engine.ts";

let tmpDir: string;

async function flushAsync(): Promise<void> {
  // Two awaits: first lets the wrapper's `notifier.publish().catch()`
  // microtask schedule, second gives the engine drain (loadActive →
  // saveActive → emit → settle) a tick to complete. The fs ops are
  // real, so this isn't deterministic across all platforms — use a
  // bounded retry on the assertion in the test bodies.
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForActiveCount(expected: number, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    const entries = await listAll();
    if (entries.length === expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const final = await listAll();
  assert.equal(final.length, expected, `expected ${expected} active entries, got ${final.length}`);
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "notifier-scheduler-test-"));
  _setFilePathsForTesting({
    active: path.join(tmpDir, "active.json"),
    history: path.join(tmpDir, "history.json"),
  });
  initNotifier({ publish: () => undefined });
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
});

afterEach(async () => {
  mock.timers.reset();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("scheduleTestNotification — fires once after the delay", () => {
  it("publishes a notifier entry when the timer elapses", async () => {
    const scheduled = scheduleTestNotification({ message: "hello", delaySeconds: 5 });
    assert.equal((await listAll()).length, 0);

    mock.timers.tick(4_999);
    await flushAsync();
    assert.equal((await listAll()).length, 0);

    mock.timers.tick(1);
    await waitForActiveCount(1);
    const entries = await listAll();
    const [entry] = entries;
    assert.equal(entry.title, "hello");
    assert.equal(entry.lifecycle, "fyi");
    const legacy = isLegacyNotifierPluginData(entry.pluginData) ? entry.pluginData : null;
    assert.ok(legacy, "expected legacy pluginData marker");
    assert.equal(legacy.transportId, DEFAULT_NOTIFICATION_TRANSPORT_ID);
    assert.equal(scheduled.delaySeconds, 5);
    assert.match(scheduled.firesAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("does not fire twice — single setTimeout only", async () => {
    scheduleTestNotification({ delaySeconds: 1 });
    mock.timers.tick(5_000);
    await waitForActiveCount(1);
  });
});

describe("scheduleTestNotification — defaults", () => {
  it("uses default message / delay / transport when omitted", async () => {
    const scheduled = scheduleTestNotification({});
    assert.equal(scheduled.delaySeconds, 60);
    mock.timers.tick(60_000);
    await waitForActiveCount(1);
    const [entry] = await listAll();
    assert.equal(entry.title, DEFAULT_NOTIFICATION_MESSAGE);
    const legacy = isLegacyNotifierPluginData(entry.pluginData) ? entry.pluginData : null;
    assert.equal(legacy?.transportId, DEFAULT_NOTIFICATION_TRANSPORT_ID);
  });
});

describe("scheduleTestNotification — delay clamping", () => {
  it("caps delays above the 1-hour ceiling at 3600s", () => {
    const scheduled = scheduleTestNotification({ delaySeconds: 99999 });
    assert.equal(scheduled.delaySeconds, 3600);
  });

  it("clamps non-finite delays (Infinity) to the default", () => {
    const scheduled = scheduleTestNotification({ delaySeconds: Infinity });
    assert.equal(scheduled.delaySeconds, 60);
  });

  it("clamps negative delays to 0 and fires on the next tick", async () => {
    const scheduled = scheduleTestNotification({ delaySeconds: -10 });
    assert.equal(scheduled.delaySeconds, 0);
    mock.timers.tick(0);
    await waitForActiveCount(1);
  });

  it("floors fractional delays (1.9 → 1)", () => {
    const scheduled = scheduleTestNotification({ delaySeconds: 1.9 });
    assert.equal(scheduled.delaySeconds, 1);
  });

  it("cancel() prevents the entry from being published", async () => {
    const scheduled = scheduleTestNotification({ delaySeconds: 10 });
    scheduled.cancel();
    mock.timers.tick(20_000);
    await flushAsync();
    assert.equal((await listAll()).length, 0);
  });
});
