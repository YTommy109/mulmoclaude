// Throttle concurrency invariant — the SEC's 10 req/s cap is
// non-negotiable, so the throttle MUST serialise concurrent
// callers (no overlapping work, ≥ MIN_INTERVAL_MS gap between
// release timestamps). The earlier Date.now()-based gate let N
// parallel callers all read the same `lastReleaseAt`, sleep
// together, and burst — this test pins the fix in place.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MIN_INTERVAL_MS, throttledSlot } from "../../server/edgar/client.js";

describe("edgar throttledSlot — concurrency safety", () => {
  it("serialises N parallel callers (no overlap, gaps ≥ MIN_INTERVAL_MS)", async () => {
    const intervals: { start: number; end: number }[] = [];
    const startedAt = Date.now();

    const work = async (): Promise<void> => {
      const start = Date.now() - startedAt;
      // Each unit of work takes ~10ms — well under MIN_INTERVAL_MS
      // (~111ms) so the throttle's gap, not the work duration, is
      // what spaces calls. If the throttle were broken, all five
      // would start near-simultaneously and finish near-together.
      await new Promise((resolve) => setTimeout(resolve, 10));
      intervals.push({ start, end: Date.now() - startedAt });
    };

    await Promise.all([throttledSlot(work), throttledSlot(work), throttledSlot(work), throttledSlot(work), throttledSlot(work)]);

    // No two work intervals should overlap.
    for (let i = 1; i < intervals.length; i++) {
      assert.ok(
        intervals[i].start >= intervals[i - 1].end,
        `interval ${i} (${intervals[i].start}–${intervals[i].end}) overlaps interval ${i - 1} (${intervals[i - 1].start}–${intervals[i - 1].end})`,
      );
    }

    // Successive starts must be at least MIN_INTERVAL_MS apart.
    // Allow 5ms of clock-jitter slack so a slightly slow CI
    // scheduler doesn't spurious-fail.
    const slack = 5;
    for (let i = 1; i < intervals.length; i++) {
      const gap = intervals[i].start - intervals[i - 1].start;
      assert.ok(gap >= MIN_INTERVAL_MS - slack, `gap ${gap}ms between starts ${i - 1}→${i} is below MIN_INTERVAL_MS (${MIN_INTERVAL_MS}ms)`);
    }
  });

  it("a thrown handler does not poison the chain", async () => {
    const calls: string[] = [];

    const ok = async (label: string): Promise<string> => {
      calls.push(label);
      return label;
    };

    const failing = throttledSlot(async () => {
      throw new Error("boom");
    });
    const after = throttledSlot(() => ok("after"));

    await assert.rejects(failing, /boom/);
    const result = await after;
    assert.equal(result, "after");
    assert.deepEqual(calls, ["after"]);
  });
});
