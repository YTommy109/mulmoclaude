import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStoredShowSessionHistory, serializeShowSessionHistory, SHOW_SESSION_HISTORY_STORAGE_KEY } from "../../../src/utils/canvas/showSessionHistory.js";

describe("parseStoredShowSessionHistory", () => {
  it("returns true for the canonical '1' (what serialize writes)", () => {
    assert.equal(parseStoredShowSessionHistory("1"), true);
  });

  it("also accepts 'true' for humans who edited localStorage by hand", () => {
    assert.equal(parseStoredShowSessionHistory("true"), true);
  });

  it("defaults to false (feature is opt-in)", () => {
    assert.equal(parseStoredShowSessionHistory(null), false);
    assert.equal(parseStoredShowSessionHistory(""), false);
    assert.equal(parseStoredShowSessionHistory("0"), false);
    assert.equal(parseStoredShowSessionHistory("false"), false);
    assert.equal(parseStoredShowSessionHistory("yes"), false);
    assert.equal(parseStoredShowSessionHistory("<script>"), false);
  });
});

describe("serializeShowSessionHistory", () => {
  it("round-trips through parseStoredShowSessionHistory", () => {
    assert.equal(parseStoredShowSessionHistory(serializeShowSessionHistory(true)), true);
    assert.equal(parseStoredShowSessionHistory(serializeShowSessionHistory(false)), false);
  });

  it("writes the canonical '1' / '0' strings", () => {
    assert.equal(serializeShowSessionHistory(true), "1");
    assert.equal(serializeShowSessionHistory(false), "0");
  });
});

describe("storage key", () => {
  it("SHOW_SESSION_HISTORY_STORAGE_KEY is stable for future-compat reads", () => {
    assert.equal(SHOW_SESSION_HISTORY_STORAGE_KEY, "chat_show_session_history");
  });
});
