// E2E coverage for the "Advanced…" gate that hides the destructive
// Delete book section in the Book Settings tab. Pins:
//   1. The Delete book UI is hidden by initial mount — only the
//      Advanced button is visible. Prevents an accidental click on
//      the most destructive control on the page.
//   2. Clicking Advanced reveals the Delete book section and hides
//      the Advanced button itself (one-shot reveal — there's no need
//      to keep showing the toggle once expanded).
//   3. Switching to a different book via the dropdown collapses the
//      Advanced section back. Without the bookId-watcher reset, the
//      Delete UI would stay open across book switches and the typed
//      confirmName would carry over to the wrong book.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { makeAccountingToolResult, mockAccountingApi } from "../fixtures/accounting";

const SESSION_ID = "accounting-advanced-session";
const BOOK_ID_A = "book-advanced-a";
const BOOK_ID_B = "book-advanced-b";

async function setupSession(page: Page): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Settings Advanced",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page, {
    // Two books so we can verify the bookId-watcher resets the
    // showAdvanced flag on switch. withEmptyOpening keeps the
    // settings tab reachable on first mount (otherwise the opening
    // gate would force-route to "opening").
    books: [
      { id: BOOK_ID_A, name: "Book A", withEmptyOpening: true },
      { id: BOOK_ID_B, name: "Book B", withEmptyOpening: true },
    ],
  });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
          { type: "text", source: "user", message: "Open the book settings" },
          makeAccountingToolResult({ bookId: BOOK_ID_A, initialTab: "settings" }),
        ],
      }),
  );
}

test.describe("accounting — Settings: Advanced gate for Delete book", () => {
  test("Delete book section is hidden until Advanced is pressed", async ({ page }) => {
    await setupSession(page);
    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-settings")).toBeVisible();

    // Initial mount: Advanced button visible, Delete UI hidden.
    await expect(page.getByTestId("accounting-settings-advanced")).toBeVisible();
    await expect(page.getByTestId("accounting-settings-delete")).toBeHidden();
    await expect(page.getByTestId("accounting-settings-delete-confirm")).toBeHidden();

    await page.getByTestId("accounting-settings-advanced").click();

    // After click: Delete UI revealed, Advanced button collapsed away.
    await expect(page.getByTestId("accounting-settings-delete")).toBeVisible();
    await expect(page.getByTestId("accounting-settings-delete-confirm")).toBeVisible();
    await expect(page.getByTestId("accounting-settings-advanced")).toBeHidden();
  });

  test("switching to a different book collapses the Advanced section", async ({ page }) => {
    await setupSession(page);
    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-settings")).toBeVisible();

    // Open Advanced on book A.
    await page.getByTestId("accounting-settings-advanced").click();
    await expect(page.getByTestId("accounting-settings-delete")).toBeVisible();

    // Switch to book B via the BookSwitcher dropdown — the bookId
    // watcher should reset showAdvanced back to false.
    await page.getByTestId("accounting-book-select").selectOption(BOOK_ID_B);

    await expect(page.getByTestId("accounting-settings-advanced")).toBeVisible();
    await expect(page.getByTestId("accounting-settings-delete")).toBeHidden();
  });
});
