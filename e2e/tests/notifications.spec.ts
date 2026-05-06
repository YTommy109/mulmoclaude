// E2E coverage for the bell after the notifier-engine migration
// (PR 4 of feat-encore).
//
// Each scenario primes the bell via the new `/api/notifier` endpoint
// (`action: "list"` returns a single canned entry whose `pluginData`
// carries the legacy `NotificationKind` + `i18n` shape, exactly the
// payload the wrapper produces server-side). The bell is expected to:
//
//   - render a row with the right testid;
//   - on body click, navigate to `entry.navigateTarget` AND remove
//     the entry (legacy entries publish with `lifecycle: "fyi"`, so
//     the bell calls `clear()` after the navigation);
//   - on `×` click, remove the entry without navigating.
//
// The previous spec asserted on a `data-unread` attribute and a
// "Mark all read" affordance — both removed in PR 4. The new bell
// has no read/unread distinction (entries are either active or
// in history), so those assertions are dropped.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

interface NotifierEntryFixture {
  id: string;
  pluginPkg: string;
  severity: "info" | "nudge" | "urgent";
  lifecycle: "fyi";
  title: string;
  body?: string;
  navigateTarget?: string;
  pluginData: {
    legacy: true;
    legacyId: string;
    kind: "todo" | "scheduler" | "agent" | "journal" | "push" | "bridge" | "system";
    priority: "normal" | "high";
    action: { type: "none" } | { type: "navigate"; target: Record<string, unknown> };
  };
  createdAt: string;
}

interface Scenario {
  description: string;
  entry: NotifierEntryFixture;
  expectedUrl: string;
}

function buildEntry(entryId: string, title: string, navigateTarget: string): NotifierEntryFixture {
  return {
    id: entryId,
    pluginPkg: "host",
    severity: "nudge",
    lifecycle: "fyi",
    title,
    body: "E2E fixture body",
    navigateTarget,
    pluginData: {
      legacy: true,
      legacyId: entryId,
      kind: "push",
      priority: "normal",
      action: { type: "navigate", target: { view: "calendar" } },
    },
    createdAt: "2026-04-25T06:00:00.000Z",
  };
}

const SCENARIOS: readonly Scenario[] = [
  {
    description: "chat target with session + result",
    entry: buildEntry("notif-chat-1", "Agent reply ready", "/chat/sess-xyz?result=uuid-abc"),
    expectedUrl: "/chat/sess-xyz?result=uuid-abc",
  },
  {
    description: "todos target with itemId",
    entry: buildEntry("notif-todo-1", "New todo assigned", "/todos/todo-42"),
    expectedUrl: "/todos/todo-42",
  },
  {
    description: "todos index when itemId is absent",
    entry: buildEntry("notif-todo-index", "Todos need review", "/todos"),
    expectedUrl: "/todos",
  },
  {
    description: "automations target with taskId",
    entry: buildEntry("notif-auto-1", "Scheduled task fired", "/automations/finance-daily-briefing"),
    expectedUrl: "/automations/finance-daily-briefing",
  },
  {
    description: "sources target with slug",
    entry: buildEntry("notif-src-1", "Interesting article", "/sources/federal-reserve"),
    expectedUrl: "/sources/federal-reserve",
  },
  {
    description: "calendar index (no identifier)",
    entry: buildEntry("notif-cal-1", "Event reminder", "/calendar"),
    expectedUrl: "/calendar",
  },
  {
    description: "files target with nested path",
    entry: buildEntry("notif-file-1", "New article ingested", "/files/sources/federal-reserve/2026-04-25.md"),
    expectedUrl: "/files/sources/federal-reserve/2026-04-25.md",
  },
  {
    description: "wiki target with slug + anchor",
    entry: buildEntry("notif-wiki-1", "Briefing published", "/wiki/pages/daily-finance-briefing-2026-04-24#front-page"),
    expectedUrl: "/wiki/pages/daily-finance-briefing-2026-04-24#front-page",
  },
];

/** Override the default `/api/notifier` mock so the bell primes with a
 *  specific list of entries instead of the empty default. Must run
 *  AFTER `mockAllApis` because Playwright matches in reverse-
 *  registration order. */
async function primeNotifierList(page: Page, entries: readonly NotifierEntryFixture[]): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/notifier",
    (route) => {
      const body = route.request().postData();
      const action = parseAction(body);
      if (action === "listHistory") return route.fulfill({ json: { history: [] } });
      if (action === "clear" || action === "cancel") return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: { entries } });
    },
  );
}

function parseAction(body: string | null): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { action?: unknown };
    return typeof parsed.action === "string" ? parsed.action : undefined;
  } catch {
    return undefined;
  }
}

test.describe("notification bell — navigation", () => {
  for (const scenario of SCENARIOS) {
    test(scenario.description, async ({ page }) => {
      // Some chat-target scenarios reference a specific sessionId;
      // pre-populate the session mock so loadSession succeeds and
      // App.vue's auto-create fallback doesn't clobber the URL.
      const target = scenario.entry.pluginData.action;
      const targetSessionId = target.type === "navigate" && typeof target.target.sessionId === "string" ? target.target.sessionId : undefined;
      const sessions = targetSessionId
        ? [
            {
              id: targetSessionId,
              title: "Notification target session",
              roleId: "general",
              startedAt: "2026-04-25T00:00:00Z",
              updatedAt: "2026-04-25T00:00:00Z",
            },
          ]
        : [];
      await mockAllApis(page, { sessions });
      await primeNotifierList(page, [scenario.entry]);

      // /todos is a quiet page — no auto-session-create races.
      await page.goto("/todos");

      // Badge appears once `apiPost(..., {action: "list"})` resolves
      // and the composable populates entries.
      await expect(page.getByTestId("notification-badge")).toBeVisible({ timeout: 5000 });

      await page.getByTestId("notification-bell").click();
      await expect(page.getByTestId("notification-panel")).toBeVisible();

      await page.getByTestId(`notification-item-${scenario.entry.id}`).click();

      await expect(page).toHaveURL((url) => url.pathname + url.search + url.hash === scenario.expectedUrl);
    });
  }
});

test.describe("notification bell — dismiss", () => {
  test("× button removes the row from Active", async ({ page }) => {
    const entry = buildEntry("notif-dismiss-1", "Will be dismissed", "/calendar");
    await mockAllApis(page, { sessions: [] });
    await primeNotifierList(page, [entry]);

    await page.goto("/todos");
    await expect(page.getByTestId("notification-badge")).toBeVisible({ timeout: 5000 });

    await page.getByTestId("notification-bell").click();
    // Click the × inside the row — the row exposes a single
    // `notification-dismiss` testid for it.
    await page.getByTestId(`notification-item-${entry.id}`).getByTestId("notification-dismiss").click();

    // Row is gone (the optimistic local update + the engine's
    // `cleared` event both remove it). The badge clears too.
    await expect(page.getByTestId(`notification-item-${entry.id}`)).toHaveCount(0);
    await expect(page.getByTestId("notification-badge")).toHaveCount(0);
  });
});
