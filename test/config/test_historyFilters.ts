import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HISTORY_FILTERS, HISTORY_FILTER_ORDER } from "../../src/config/historyFilters.js";
import { SESSION_ORIGINS } from "../../src/types/session.js";

describe("HISTORY_FILTERS", () => {
  it("reuses SESSION_ORIGINS for the four origin filter values", () => {
    assert.equal(HISTORY_FILTERS.human, SESSION_ORIGINS.human);
    assert.equal(HISTORY_FILTERS.scheduler, SESSION_ORIGINS.scheduler);
    assert.equal(HISTORY_FILTERS.skill, SESSION_ORIGINS.skill);
    assert.equal(HISTORY_FILTERS.bridge, SESSION_ORIGINS.bridge);
  });

  it("defines `all` and `unread` as UI-only filters", () => {
    assert.equal(HISTORY_FILTERS.all, "all");
    assert.equal(HISTORY_FILTERS.unread, "unread");
  });
});

describe("HISTORY_FILTER_ORDER", () => {
  it("contains every value in HISTORY_FILTERS exactly once", () => {
    const expected = Object.values(HISTORY_FILTERS).sort();
    const actual = [...HISTORY_FILTER_ORDER].sort();
    assert.deepEqual(actual, expected);
  });

  it("starts with `all` so the pill row renders it first", () => {
    assert.equal(HISTORY_FILTER_ORDER[0], HISTORY_FILTERS.all);
  });
});
