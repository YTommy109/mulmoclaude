// Coverage for the wrapper's `legacyActionToNavigateTarget` helper —
// the migrated server-side equivalent of the deleted client-side
// `resolveNotificationTarget`. Each `NotificationAction` shape that
// the legacy callers emit must flatten to a relative URL the engine
// will accept (`navigateTarget` validation requires a single leading
// `/`, no scheme, no `//`).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { legacyActionToNavigateTarget } from "../../server/events/notifications.ts";
import { NOTIFICATION_ACTION_TYPES, NOTIFICATION_VIEWS } from "../../src/types/notification.ts";

describe("legacyActionToNavigateTarget — non-navigate actions", () => {
  it("returns undefined for `none`", () => {
    assert.equal(legacyActionToNavigateTarget({ type: NOTIFICATION_ACTION_TYPES.none }), undefined);
  });
  it("returns undefined when action is missing", () => {
    assert.equal(legacyActionToNavigateTarget(undefined), undefined);
  });
});

describe("legacyActionToNavigateTarget — chat target", () => {
  it("returns /chat/:sessionId for sessionId only", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.chat, sessionId: "sess-1" },
    });
    assert.equal(result, "/chat/sess-1");
  });
  it("appends ?result=<uuid> when resultUuid is present", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.chat, sessionId: "sess-1", resultUuid: "uuid-abc" },
    });
    assert.equal(result, "/chat/sess-1?result=uuid-abc");
  });
  it("returns undefined when sessionId is missing", () => {
    // The chat route requires :sessionId — without it the user would
    // bounce off the catch-all redirect.
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      // @ts-expect-error intentionally invalid — testing runtime guard
      target: { view: NOTIFICATION_VIEWS.chat },
    });
    assert.equal(result, undefined);
  });
});

describe("legacyActionToNavigateTarget — todos / automations / sources", () => {
  it("/todos with optional itemId", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.todos, itemId: "todo-42" },
      }),
      "/todos/todo-42",
    );
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.todos },
      }),
      "/todos",
    );
  });
  it("/automations with optional taskId", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.automations, taskId: "task-1" },
      }),
      "/automations/task-1",
    );
  });
  it("/sources with optional slug", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.sources, slug: "fed" },
      }),
      "/sources/fed",
    );
  });
  it("/calendar (no identifier)", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.calendar },
      }),
      "/calendar",
    );
  });
});

describe("legacyActionToNavigateTarget — files", () => {
  it("encodes nested path segments individually", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "sources/fed/2026-04-25.md" },
    });
    assert.equal(result, "/files/sources/fed/2026-04-25.md");
  });
  it("encodes spaces / special characters per segment", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.files, path: "with space/file?.md" },
    });
    assert.equal(result, "/files/with%20space/file%3F.md");
  });
  it("falls back to /files when path is missing", () => {
    assert.equal(
      legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        target: { view: NOTIFICATION_VIEWS.files },
      }),
      "/files",
    );
  });
});

describe("legacyActionToNavigateTarget — wiki", () => {
  it("includes /pages/:slug and the optional anchor", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, slug: "daily-briefing", anchor: "front-page" },
    });
    assert.equal(result, "/wiki/pages/daily-briefing#front-page");
  });
  it("anchor without slug lands on /wiki", () => {
    const result = legacyActionToNavigateTarget({
      type: NOTIFICATION_ACTION_TYPES.navigate,
      target: { view: NOTIFICATION_VIEWS.wiki, anchor: "intro" },
    });
    assert.equal(result, "/wiki#intro");
  });
});

describe("legacyActionToNavigateTarget — engine constraints", () => {
  it("every emitted target starts with a single '/' (no scheme, no '//')", () => {
    const targets: { view: string; expected: string }[] = [
      { view: "chat", expected: "/chat" },
      { view: "todos", expected: "/todos" },
      { view: "calendar", expected: "/calendar" },
      { view: "automations", expected: "/automations" },
      { view: "sources", expected: "/sources" },
      { view: "files", expected: "/files" },
      { view: "wiki", expected: "/wiki" },
    ];
    for (const { view, expected } of targets) {
      // Build a minimal action per view, with no optional identifiers.
      const result = legacyActionToNavigateTarget({
        type: NOTIFICATION_ACTION_TYPES.navigate,
        // For chat, sessionId is required so we expect undefined here —
        // the others all return their index path.
        target: view === "chat" ? { view: "chat", sessionId: "s" } : { view },
      } as Parameters<typeof legacyActionToNavigateTarget>[0]);
      const expectedStart = view === "chat" ? "/chat/s" : expected;
      assert.equal(result, expectedStart);
      assert.ok(result?.startsWith("/"));
      assert.ok(!result?.startsWith("//"));
    }
  });
});
