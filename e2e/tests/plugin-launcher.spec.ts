// Plugin launcher buttons that sit above the canvas, to the left of
// the view-mode toggle. Each "invoke" button calls the matching
// plugin's REST endpoint locally (no LLM round-trip), pushes the
// resulting ToolResult into the current session, and switches the
// canvas to single view so the plugin's native View component takes
// the stage. The "files" button just switches to files view.
//
// First slice of issue #253.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test.describe("plugin launcher — invoke path", () => {
  test("Todos button hits POST /api/todos + surfaces the todo View", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/todos",
      (route) =>
        route.fulfill({
          json: {
            data: {
              items: [
                {
                  id: "t-1",
                  text: "Ship the plugin launcher",
                  completed: false,
                  createdAt: Date.now(),
                },
              ],
              columns: [],
            },
            title: "Todos",
            message: "1 todo",
          },
        }),
    );

    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-todos").click();

    await expect(
      page.getByText("Ship the plugin launcher").first(),
    ).toBeVisible();
  });

  test("Skills button hits GET /api/skills + surfaces the skills View", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/skills",
      (route) =>
        route.fulfill({
          json: {
            skills: [
              {
                name: "daily-plan",
                description: "Generate a daily plan",
                source: "user",
              },
            ],
          },
        }),
    );

    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-skills").click();

    // The skills View renders each skill with its own testid.
    await expect(page.getByTestId("skill-item-daily-plan")).toBeVisible();
  });

  test("Wiki button hits POST /api/wiki + surfaces page entries", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/wiki",
      (route) =>
        route.fulfill({
          json: {
            data: {
              action: "index",
              title: "Wiki",
              content: "",
              pageEntries: [
                {
                  slug: "home",
                  title: "Welcome home page",
                  description: "",
                },
              ],
            },
            title: "Wiki",
            message: "1 page",
          },
        }),
    );

    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-wiki").click();

    // The wiki View renders page entries as cards containing the title.
    await expect(page.getByText("Welcome home page").first()).toBeVisible();
  });

  test("Scheduler button hits POST /api/scheduler", async ({ page }) => {
    let schedCalled = false;
    await page.route(
      (url) => url.pathname === "/api/scheduler",
      (route) => {
        schedCalled = true;
        return route.fulfill({
          json: {
            data: { items: [] },
            title: "Schedule",
            message: "no items",
          },
        });
      },
    );

    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-scheduler").click();

    // Give the fetch a moment to land.
    await page.waitForTimeout(200);
    expect(schedCalled).toBe(true);
  });

  test("endpoint error surfaces as a text-response in the stack", async ({
    page,
  }) => {
    await page.route(
      (url) => url.pathname === "/api/todos",
      (route) =>
        route.fulfill({
          status: 500,
          json: { error: "boom" },
        }),
    );

    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-todos").click();

    await expect(
      page.getByText("manageTodoList failed: boom").first(),
    ).toBeVisible();
  });
});

test.describe("plugin launcher — files path", () => {
  test("Files button switches canvas to files view", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-files").click();

    await page.waitForURL(/view=files/);
    expect(page.url()).toContain("view=files");
    expect(page.url()).not.toContain("path=");
  });
});
