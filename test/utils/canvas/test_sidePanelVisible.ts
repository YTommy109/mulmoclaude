import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStoredSidePanelVisible, serializeSidePanelVisible, SIDE_PANEL_VISIBLE_STORAGE_KEY } from "../../../src/utils/canvas/sidePanelVisible.js";

describe("parseStoredSidePanelVisible", () => {
  it("returns true for the canonical '1' (what serialize writes)", () => {
    assert.equal(parseStoredSidePanelVisible("1"), true);
  });

  it("also accepts 'true' for humans who edited localStorage by hand", () => {
    assert.equal(parseStoredSidePanelVisible("true"), true);
  });

  it("defaults to false (feature is opt-in)", () => {
    assert.equal(parseStoredSidePanelVisible(null), false);
    assert.equal(parseStoredSidePanelVisible(""), false);
    assert.equal(parseStoredSidePanelVisible("0"), false);
    assert.equal(parseStoredSidePanelVisible("false"), false);
    assert.equal(parseStoredSidePanelVisible("yes"), false);
    assert.equal(parseStoredSidePanelVisible("<script>"), false);
  });
});

describe("serializeSidePanelVisible", () => {
  it("round-trips through parseStoredSidePanelVisible", () => {
    assert.equal(parseStoredSidePanelVisible(serializeSidePanelVisible(true)), true);
    assert.equal(parseStoredSidePanelVisible(serializeSidePanelVisible(false)), false);
  });

  it("writes the canonical '1' / '0' strings", () => {
    assert.equal(serializeSidePanelVisible(true), "1");
    assert.equal(serializeSidePanelVisible(false), "0");
  });
});

describe("storage key", () => {
  it("SIDE_PANEL_VISIBLE_STORAGE_KEY is stable for future-compat reads", () => {
    assert.equal(SIDE_PANEL_VISIBLE_STORAGE_KEY, "side_panel_visible");
  });
});
