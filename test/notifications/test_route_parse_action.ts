// Coverage for `parseAction`'s per-view runtime validation.
//
// The PoC `/api/notifications/test` route accepts user-supplied JSON
// with a `NotificationAction` shape; the URL builders downstream
// assume each per-view field is `string | undefined`. Without strict
// validation here, malformed inputs (`path: 123`, `slug: null`, …)
// reach the URL builder inside `setTimeout` — after the 202 response
// — and crash as uncaught exceptions. These tests pin the boundary.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAction } from "../../server/api/routes/notifications.ts";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_VIEWS } from "../../src/types/notification.ts";

describe("parseAction — top-level shape", () => {
  it("returns undefined for non-objects", () => {
    assert.equal(parseAction(undefined), undefined);
    assert.equal(parseAction(null), undefined);
    assert.equal(parseAction("nav"), undefined);
    assert.equal(parseAction(42), undefined);
  });

  it("returns the canonical `none` action when type is none", () => {
    assert.deepEqual(parseAction({ type: NOTIFICATION_ACTION_TYPES.none }), {
      type: NOTIFICATION_ACTION_TYPES.none,
    });
  });

  it("returns undefined for unknown action types", () => {
    assert.equal(parseAction({ type: "weird" }), undefined);
  });

  it("returns undefined when navigate.target is missing or not an object", () => {
    assert.equal(parseAction({ type: "navigate" }), undefined);
    assert.equal(parseAction({ type: "navigate", target: "x" }), undefined);
    assert.equal(parseAction({ type: "navigate", target: null }), undefined);
  });

  it("returns undefined when target.view is unknown", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: "weather" } }), undefined);
  });
});

describe("parseAction — chat target", () => {
  it("requires a non-empty sessionId", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.chat } }), undefined);
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.chat, sessionId: "" } }), undefined);
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.chat, sessionId: 42 } }), undefined);
  });

  it("rejects non-string resultUuid", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.chat, sessionId: "s", resultUuid: 1 } }), undefined);
  });

  it("accepts a well-formed chat target", () => {
    assert.deepEqual(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.chat, sessionId: "s", resultUuid: "u" } }), {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.chat, sessionId: "s", resultUuid: "u" },
    });
  });
});

describe("parseAction — files target (the codex-flagged crash)", () => {
  it("rejects path: number — would have crashed in setTimeout via path.split", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.files, path: 123 } }), undefined);
  });

  it("rejects path: object", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.files, path: { foo: "bar" } } }), undefined);
  });

  it("accepts files target without a path", () => {
    assert.deepEqual(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.files } }), {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: undefined },
    });
  });

  it("accepts files target with a string path", () => {
    assert.deepEqual(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.files, path: "a/b.md" } }), {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "a/b.md" },
    });
  });
});

describe("parseAction — todos / automations / sources / wiki", () => {
  it("rejects todos.itemId: non-string", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.todos, itemId: 1 } }), undefined);
  });

  it("rejects automations.taskId: non-string", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.automations, taskId: false } }), undefined);
  });

  it("rejects sources.slug: non-string", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.sources, slug: null } }), undefined);
  });

  it("rejects wiki.slug: non-string", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.wiki, slug: 7 } }), undefined);
  });

  it("rejects wiki.anchor: non-string", () => {
    assert.equal(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.wiki, anchor: [] } }), undefined);
  });

  it("accepts calendar (no fields beyond view)", () => {
    assert.deepEqual(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.calendar } }), {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.calendar },
    });
  });

  it("accepts wiki with both string fields", () => {
    assert.deepEqual(parseAction({ type: "navigate", target: { view: NOTIFICATION_VIEWS.wiki, slug: "p", anchor: "a" } }), {
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "p", anchor: "a" },
    });
  });
});
