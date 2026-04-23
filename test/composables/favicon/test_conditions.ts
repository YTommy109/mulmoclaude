// Pin every favicon predicate against fixed clocks. Each test
// constructs the exact moment that should fall inside / outside the
// window so a future reshuffle of the thresholds breaks the test
// loudly rather than quietly shifting the palette.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isBirthday,
  isChristmas,
  isLateNight,
  isManyUnread,
  isMorning,
  isNewYear,
  isOverloaded,
  isRunningLong,
  isWeekend,
  MANY_UNREAD_THRESHOLD,
  RUNNING_LONG_MS,
} from "../../../src/composables/favicon/conditions.js";

// Shorthand constructor. Named `makeDate` (not `at`) to satisfy the
// id-length lint rule — it means the same thing.
function makeDate(year: number, monthZeroBased: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, monthZeroBased, day, hour, minute);
}

describe("isLateNight", () => {
  it("fires at 22:00 and 04:59 (inclusive / exclusive boundaries)", () => {
    assert.equal(isLateNight(makeDate(2026, 3, 23, 22, 0)), true);
    assert.equal(isLateNight(makeDate(2026, 3, 23, 4, 59)), true);
  });

  it("skips 21:59 and 05:00 (just outside)", () => {
    assert.equal(isLateNight(makeDate(2026, 3, 23, 21, 59)), false);
    assert.equal(isLateNight(makeDate(2026, 3, 23, 5, 0)), false);
  });
});

describe("isMorning", () => {
  it("covers 05:00 through 08:59", () => {
    assert.equal(isMorning(makeDate(2026, 3, 23, 5, 0)), true);
    assert.equal(isMorning(makeDate(2026, 3, 23, 8, 59)), true);
  });

  it("skips 09:00 and 04:59 (outside the window)", () => {
    assert.equal(isMorning(makeDate(2026, 3, 23, 9, 0)), false);
    assert.equal(isMorning(makeDate(2026, 3, 23, 4, 59)), false);
  });
});

describe("isWeekend", () => {
  it("fires on Saturday and Sunday during daytime", () => {
    // 2026-04-25 is Saturday.
    assert.equal(isWeekend(makeDate(2026, 3, 25, 14, 0)), true);
    // 2026-04-26 is Sunday.
    assert.equal(isWeekend(makeDate(2026, 3, 26, 10, 0)), true);
  });

  it("skips weekend nights — late-night wins over weekend", () => {
    // Saturday 23:30: late-night territory.
    assert.equal(isWeekend(makeDate(2026, 3, 25, 23, 30)), false);
    // Saturday 03:00.
    assert.equal(isWeekend(makeDate(2026, 3, 25, 3, 0)), false);
  });

  it("skips weekdays", () => {
    // 2026-04-23 is Thursday.
    assert.equal(isWeekend(makeDate(2026, 3, 23, 14, 0)), false);
  });
});

describe("isBirthday", () => {
  it("matches when today's MM-DD equals the stored value", () => {
    assert.equal(isBirthday(makeDate(2026, 2, 15, 10, 0), "03-15"), true);
  });

  it("is false on any other day", () => {
    assert.equal(isBirthday(makeDate(2026, 2, 14, 10, 0), "03-15"), false);
  });

  it("rejects malformed input without throwing", () => {
    assert.equal(isBirthday(makeDate(2026, 2, 15), "3-15"), false); // missing zero pad
    assert.equal(isBirthday(makeDate(2026, 2, 15), "03/15"), false);
    assert.equal(isBirthday(makeDate(2026, 2, 15), ""), false);
    assert.equal(isBirthday(makeDate(2026, 2, 15), null), false);
  });
});

describe("isNewYear", () => {
  it("fires on Jan 1, 2, 3", () => {
    assert.equal(isNewYear(makeDate(2027, 0, 1)), true);
    assert.equal(isNewYear(makeDate(2027, 0, 2)), true);
    assert.equal(isNewYear(makeDate(2027, 0, 3)), true);
  });

  it("skips Dec 31 and Jan 4", () => {
    assert.equal(isNewYear(makeDate(2026, 11, 31)), false);
    assert.equal(isNewYear(makeDate(2027, 0, 4)), false);
  });
});

describe("isChristmas", () => {
  it("fires on Dec 24 and 25", () => {
    assert.equal(isChristmas(makeDate(2026, 11, 24)), true);
    assert.equal(isChristmas(makeDate(2026, 11, 25)), true);
  });

  it("skips Dec 23 and Dec 26", () => {
    assert.equal(isChristmas(makeDate(2026, 11, 23)), false);
    assert.equal(isChristmas(makeDate(2026, 11, 26)), false);
  });
});

describe("isOverloaded", () => {
  it("fires above the 0.9 threshold", () => {
    assert.equal(isOverloaded(1.2), true);
    assert.equal(isOverloaded(0.91), true);
  });

  it("stays quiet at or under 0.9", () => {
    assert.equal(isOverloaded(0.9), false);
    assert.equal(isOverloaded(0.3), false);
  });

  it("skips when load data isn't available (null / NaN / Windows zeros)", () => {
    assert.equal(isOverloaded(null), false);
    assert.equal(isOverloaded(Number.NaN), false);
    assert.equal(isOverloaded(0), false);
  });
});

describe("isManyUnread", () => {
  it(`fires at exactly MANY_UNREAD_THRESHOLD (${MANY_UNREAD_THRESHOLD})`, () => {
    assert.equal(isManyUnread(MANY_UNREAD_THRESHOLD), true);
    assert.equal(isManyUnread(MANY_UNREAD_THRESHOLD + 5), true);
  });

  it("skips below threshold", () => {
    assert.equal(isManyUnread(MANY_UNREAD_THRESHOLD - 1), false);
    assert.equal(isManyUnread(0), false);
  });

  it("handles bogus input without misfiring", () => {
    assert.equal(isManyUnread(Number.NaN), false);
  });
});

describe("isRunningLong", () => {
  it(`fires once elapsed >= RUNNING_LONG_MS (${RUNNING_LONG_MS})`, () => {
    const now = new Date(2026, 3, 23, 12, 1, 0); // 60 s later
    const runningSinceMs = new Date(2026, 3, 23, 12, 0, 0).getTime();
    assert.equal(isRunningLong(runningSinceMs, now), true);
  });

  it("stays quiet under the threshold", () => {
    const now = new Date(2026, 3, 23, 12, 0, 59);
    const runningSinceMs = new Date(2026, 3, 23, 12, 0, 0).getTime();
    assert.equal(isRunningLong(runningSinceMs, now), false);
  });

  it("skips when the session isn't running", () => {
    assert.equal(isRunningLong(null, new Date()), false);
  });
});
