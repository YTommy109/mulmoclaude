// E2E coverage for the rename-book affordance in the Book Settings
// tab. The Settings UI now surfaces the book name as an editable
// `<input>` (was: read-only `<dd>`) and pipes it through the same
// `updateBook` save path as country / fiscalYearEnd. Pins:
//   1. Saving a new name persists it — the input post-save reflects
//      the value (proves the props.bookName watcher syncs after the
//      books-changed refetch) and the BookSwitcher dropdown shows
//      the renamed book in its option text.
//   2. Server-side `validateUpdateBookInput` rejects empty / whitespace
//      names with a 400; the client mirrors that contract via the
//      Save button's disabled binding so we never fire a doomed
//      request. Two tests pin the empty + whitespace cases.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { makeAccountingToolResult, mockAccountingApi } from "../fixtures/accounting";

const SESSION_ID = "accounting-rename-session";
const BOOK_ID = "book-rename";

async function setupSession(page: Page, initialName: string): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Settings Rename",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page, {
    // withEmptyOpening keeps the gate inactive so the Settings tab
    // is reachable on the FIRST mount via initialTab — without it,
    // openingGateActive would force-route to "opening" and the
    // Settings UI would be unreachable until an opening is on file.
    books: [{ id: BOOK_ID, name: initialName, withEmptyOpening: true }],
  });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
          { type: "text", source: "user", message: "Open the book settings" },
          makeAccountingToolResult({ bookId: BOOK_ID, initialTab: "settings" }),
        ],
      }),
  );
}

test.describe("accounting — Settings: rename book", () => {
  test("renaming via the input + Save persists the new name and resyncs the input", async ({ page }) => {
    await setupSession(page, "Original Name");
    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-settings")).toBeVisible();

    const nameInput = page.getByTestId("accounting-settings-name");
    await expect(nameInput).toHaveValue("Original Name");

    await nameInput.fill("Renamed Book");
    await page.getByTestId("accounting-settings-save").click();

    // Success banner confirms the dispatch round-tripped.
    await expect(page.getByTestId("accounting-settings-update-ok")).toBeVisible();
    // Input keeps the new name post-save — the View's books-changed
    // → refetchBooks loop bumps `bookName` on the prop, and the
    // watcher in BookSettings syncs `selectedName` to it. Without the
    // watcher this would silently reset to the OLD value after save.
    await expect(nameInput).toHaveValue("Renamed Book");
    // BookSwitcher renders option text as `Name (CCY)`. Grepping the
    // dropdown for the new name confirms the rename also flows through
    // to the parent's books list, not just the local input ref.
    await expect(page.getByTestId("accounting-book-select")).toContainText("Renamed Book");
  });

  test("Save button is disabled when the name is cleared to empty", async ({ page }) => {
    await setupSession(page, "Original Name");
    await page.goto(`/chat/${SESSION_ID}`);
    const nameInput = page.getByTestId("accounting-settings-name");
    await expect(nameInput).toHaveValue("Original Name");
    await nameInput.fill("");
    // Mirrors server-side validateUpdateBookInput's "non-empty string"
    // contract — without this client gate, Save would fire a doomed
    // 400.
    await expect(page.getByTestId("accounting-settings-save")).toBeDisabled();
  });

  test("Save button is disabled when the name is whitespace-only", async ({ page }) => {
    await setupSession(page, "Original Name");
    await page.goto(`/chat/${SESSION_ID}`);
    const nameInput = page.getByTestId("accounting-settings-name");
    await nameInput.fill("   ");
    // Server trims + rejects whitespace-only names; the client mirrors
    // the trim so a single whitespace edit doesn't look like a valid
    // "pending change".
    await expect(page.getByTestId("accounting-settings-save")).toBeDisabled();
  });
});
