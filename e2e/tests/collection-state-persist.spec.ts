// E2E for the shared per-collection state stores in localStorage:
//
//   - `collection_sorts`     → active column sort (field + direction)
//   - `collection_view_modes` → last-used view mode (table / calendar / custom)
//
// Both stores are keyed by collection slug and consumed by BOTH the
// standalone `/collections/:slug` route AND the embedded
// `presentCollection` card — they're a single shared preference, so
// the two surfaces must read and write the same key. The tests here
// pin both halves of that contract (standalone reload-survives + the
// embedded card reads/writes the same store).
//
// Embedded-card crash regressions, edit/add flows, and save-returns-
// to-detail behaviour stay in present-collection.spec.ts; calendar-
// specific view tests (day view, undated tray, colouring, etc.) stay
// in collection-calendar.spec.ts.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SESSION_PATH = "/chat/watchlist-session";

const SCORES = {
  collection: {
    slug: "scores",
    title: "Scores",
    icon: "leaderboard",
    source: "user",
    schema: {
      title: "Scores",
      icon: "leaderboard",
      dataPath: "data/scores/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
        points: { type: "number", label: "Points" },
      },
    },
  },
  // File order is a(30), b(10), c(20) — deliberately NOT sorted by points.
  items: [
    { id: "a", name: "Alpha", points: 30 },
    { id: "b", name: "Bravo", points: 10 },
    { id: "c", name: "Charlie", points: 20 },
  ],
};

// A date-bearing collection used by the standalone view-mode reload
// test. The 15th of the current month keeps records on the default-
// visible calendar grid without mocking the clock.
const today = new Date();
const MID = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;

const EVENTS = {
  collection: {
    slug: "events",
    title: "Events",
    icon: "event",
    source: "user",
    schema: {
      title: "Events",
      icon: "event",
      dataPath: "data/events/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        on: { type: "date", label: "Date" },
      },
      displayField: "name",
      calendarField: "on",
    },
  },
  items: [
    { id: "launch", name: "Launch party", on: MID },
    { id: "someday", name: "Someday item", on: "" },
  ],
};

// A date-bearing collection for the embedded-card view-mode test:
// the stored "calendar" preference must seed a fresh card that has no
// own `viewState` (the "no own state → consult shared store" path).
const DATED_EVENTS_DETAIL = {
  collection: {
    slug: "dated-events",
    title: "Events",
    icon: "event",
    source: "user",
    schema: {
      title: "Events",
      icon: "event",
      dataPath: "data/dated-events/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        on: { type: "date", label: "Date" },
      },
      displayField: "name",
      calendarField: "on",
    },
  },
  items: [{ id: "launch", name: "Launch party", on: "" }],
};

const WATCHLIST_DETAIL = {
  collection: {
    slug: "watchlist",
    title: "Watchlist",
    icon: "movie",
    source: "user",
    schema: {
      title: "Watchlist",
      icon: "movie",
      dataPath: "data/watchlist/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true },
        title: { type: "string", label: "Title", required: true },
        type: { type: "string", label: "Type" },
        mainActor: { type: "string", label: "Main Actor" },
        genre: { type: "string", label: "Genre" },
        platform: { type: "string", label: "Platform" },
        synopsis: { type: "markdown", label: "Synopsis" },
        watched: { type: "boolean", label: "Watched" },
      },
    },
  },
  items: [
    { id: "avatar", title: "アバター", type: "映画", mainActor: "Sam Worthington", genre: "SF", platform: "Disney+", synopsis: "...", watched: false },
    { id: "jack-ryan", title: "Jack Ryan", type: "TV", genre: "Thriller", platform: "Prime", watched: true },
  ],
};

async function mockScores(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/scores",
    (route) => route.fulfill({ json: SCORES }),
  );
}

async function mockEvents(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/events",
    (route) => route.fulfill({ json: EVENTS }),
  );
}

/** Assert the table rows render top-to-bottom in `order` (by primary key). */
async function expectRowOrder(page: Page, order: string[]): Promise<void> {
  const rows = page.locator('[data-testid^="collections-row-"]');
  await expect(rows).toHaveCount(order.length);
  for (let index = 0; index < order.length; index++) {
    await expect(rows.nth(index)).toHaveAttribute("data-testid", `collections-row-${order[index]}`);
  }
}

test.describe("standalone /collections/:slug — shared state stores", () => {
  test("standalone table sort persists across a reload", async ({ page }) => {
    await mockAllApis(page);
    await mockScores(page);

    await page.goto("/collections/scores");
    await expectRowOrder(page, ["a", "b", "c"]); // file order, unsorted

    // One click on the Points header → ascending: b(10), c(20), a(30).
    await page.getByTestId("collections-sort-points").click();
    await expectRowOrder(page, ["b", "c", "a"]);

    // Reload: the ascending Points sort must survive (localStorage), so the
    // table reopens in the same order — not the file order.
    await page.reload();
    await expectRowOrder(page, ["b", "c", "a"]);
    const sortedHeader = page.locator('th[aria-sort="ascending"]');
    await expect(sortedHeader).toHaveCount(1);
    await expect(sortedHeader).toContainText("Points");
  });

  test("clearing the sort is also persisted", async ({ page }) => {
    await mockAllApis(page);
    await mockScores(page);

    await page.goto("/collections/scores");
    // Cycle Points none → asc → desc → none, then reload: back to file order.
    const sortButton = page.getByTestId("collections-sort-points");
    await sortButton.click(); // asc
    await sortButton.click(); // desc
    await sortButton.click(); // none
    await expectRowOrder(page, ["a", "b", "c"]);

    await page.reload();
    await expectRowOrder(page, ["a", "b", "c"]);
    await expect(page.locator("th[aria-sort=ascending], th[aria-sort=descending]")).toHaveCount(0);
  });

  test("restores the last-used view mode after a reload", async ({ page }) => {
    // The standalone route persists the last-used view mode per collection in
    // localStorage, so reopening restores the prior view instead of the table.
    await mockAllApis(page);
    await mockEvents(page);

    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    await expect(page.getByTestId("collection-calendar")).toBeVisible();

    await page.reload();

    // Reopens on the calendar, not the default table.
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    await expect(page.getByTestId("collection-calendar-chip-launch")).toBeVisible();
  });
});

test.describe("embedded presentCollection card — shared state stores", () => {
  test("embedded card honours the shared localStorage view-mode store", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

    // Seed the shared store with "calendar" for this slug BEFORE the app boots.
    await page.addInitScript(() => {
      localStorage.setItem("collection_view_modes", JSON.stringify({ "dated-events": "calendar" }));
    });

    await mockAllApis(page, {
      sessions: [{ id: "watchlist-session", title: "Events", roleId: "general", startedAt: "2026-05-29T10:00:00Z", updatedAt: "2026-05-29T10:05:00Z" }],
    });
    await page.route(
      (url) => url.pathname === "/api/collections/dated-events",
      (route) => route.fulfill({ json: DATED_EVENTS_DETAIL }),
    );
    await page.route(
      (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
      (route) =>
        route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: "watchlist-session" },
            { type: "text", source: "user", message: "show me the events" },
            {
              type: "tool_result",
              source: "tool",
              // No `viewState` → embedded `initialView` is undefined.
              result: {
                uuid: "pc-result-2",
                toolName: "presentCollection",
                title: "Events",
                message: "Presented collection dated-events",
                data: { collectionSlug: "dated-events" },
              },
            },
          ],
        }),
    );

    await page.goto(SESSION_PATH);
    await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });
    // The date field means the calendar toggle IS offered, and a fresh card
    // (no own `viewState`) now seeds from the shared store: it opens on the
    // stored "calendar" — the grid mounts and the table is not shown.
    await expect(page.getByTestId("collection-view-toggle-calendar")).toBeVisible();
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    await expect(page.getByTestId("collections-row-launch")).toHaveCount(0);

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });

  test("embedded card honours the shared localStorage table sort", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

    // The table sort is a single shared per-collection preference; seed it in the
    // store (as the standalone page would) BEFORE the app boots, then assert a
    // freshly-rendered card opens in that sort — proving the two surfaces share it.
    await page.addInitScript(() => {
      localStorage.setItem("collection_sorts", JSON.stringify({ watchlist: { field: "platform", direction: "desc" } }));
    });

    await mockAllApis(page, {
      sessions: [{ id: "watchlist-session", title: "Watchlist", roleId: "general", startedAt: "2026-05-29T10:00:00Z", updatedAt: "2026-05-29T10:05:00Z" }],
    });
    await page.route(
      (url) => url.pathname === "/api/collections/watchlist",
      (route) => route.fulfill({ json: WATCHLIST_DETAIL }),
    );
    await page.route(
      (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
      (route) =>
        route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: "watchlist-session" },
            { type: "text", source: "user", message: "show me the watchlist" },
            {
              type: "tool_result",
              source: "tool",
              // No itemId → the table renders (not the detail modal).
              result: {
                uuid: "pc-result-3",
                toolName: "presentCollection",
                title: "Watchlist",
                message: "Presented collection watchlist",
                data: { collectionSlug: "watchlist" },
              },
            },
          ],
        }),
    );

    await page.goto(SESSION_PATH);
    await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });
    // Fixture order is [avatar (Disney+), jack-ryan (Prime)]; the shared
    // desc-by-platform sort flips it to [jack-ryan, avatar] on mount.
    const rows = page.locator('[data-testid^="collections-row-"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-testid", "collections-row-jack-ryan");
    await expect(rows.nth(1)).toHaveAttribute("data-testid", "collections-row-avatar");
    // The header reflects the shared descending sort on the Platform column.
    const sortedHeader = page.locator('th[aria-sort="descending"]');
    await expect(sortedHeader).toHaveCount(1);
    await expect(sortedHeader).toContainText("Platform");

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });

  test("sorting in an embedded card writes the shared store (so the standalone view shares it)", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

    await mockAllApis(page, {
      sessions: [{ id: "watchlist-session", title: "Watchlist", roleId: "general", startedAt: "2026-05-29T10:00:00Z", updatedAt: "2026-05-29T10:05:00Z" }],
    });
    await page.route(
      (url) => url.pathname === "/api/collections/watchlist",
      (route) => route.fulfill({ json: WATCHLIST_DETAIL }),
    );
    await page.route(
      (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
      (route) =>
        route.fulfill({
          json: [
            { type: "session_meta", roleId: "general", sessionId: "watchlist-session" },
            { type: "text", source: "user", message: "show me the watchlist" },
            {
              type: "tool_result",
              source: "tool",
              result: {
                uuid: "pc-result-4",
                toolName: "presentCollection",
                title: "Watchlist",
                message: "Presented collection watchlist",
                data: { collectionSlug: "watchlist" },
              },
            },
          ],
        }),
    );

    await page.goto(SESSION_PATH);
    await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });
    // Sort the Platform column inside the card → one click = ascending.
    await page.getByTestId("collections-sort-platform").click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText("Platform");

    // The card wrote the SHARED store — the standalone view would read the same.
    const stored = await page.evaluate(() => localStorage.getItem("collection_sorts"));
    expect(stored && JSON.parse(stored)).toEqual({ watchlist: { field: "platform", direction: "asc" } });

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });
});
