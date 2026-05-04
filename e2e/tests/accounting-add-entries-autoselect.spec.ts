// E2E coverage for the `addEntries` tool-result auto-selection in
// the accounting plugin. When the LLM posts journal entries, the
// route handler stamps `data: { action: "addEntries", bookId,
// entries }` onto the tool-result envelope (see
// server/api/routes/accounting.ts). The View reads the LAST entry's
// id off `selectedResult.data.entries` and surfaces it to JournalList,
// which auto-expands the matching row's detail panel and scrolls it
// into view.
//
// These specs assert the visible outcome:
//   1. Single entry → that entry's detail panel renders on first paint.
//   2. Batch of entries → only the LAST entry's detail panel renders.
//   3. The auto-expanded row carries the `.row-selected` class so the
//      blue selection frame is applied.
//
// We pre-seed the accounting mock with the same entry ids that appear
// in the envelope so getJournalEntries returns them — the View's
// JournalList watcher only consumes the preselect once the row
// actually exists in the fetched list.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { makeAccountingAddEntriesToolResult, mockAccountingApi, type SeedJournalEntry } from "../fixtures/accounting";

const SESSION_ID = "accounting-autoselect-session";
const BOOK_ID = "book-autoselect";

interface SetupOpts {
  entries: readonly SeedJournalEntry[];
}

async function setupSession(page: Page, opts: SetupOpts): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Accounting Auto-Select",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page, {
    books: [
      {
        id: BOOK_ID,
        name: "Auto-Select Book",
        // withEmptyOpening unlocks the journal tab so the row is
        // reachable; the addEntries flow doesn't seed an opening on
        // its own.
        withEmptyOpening: true,
        entries: opts.entries,
      },
    ],
  });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
          { type: "text", source: "user", message: "Post journal entries" },
          makeAccountingAddEntriesToolResult({
            bookId: BOOK_ID,
            entries: opts.entries.map((entry) => ({ id: entry.id, date: entry.date })),
          }),
        ],
      }),
  );
}

test.describe("accounting — addEntries auto-selection", () => {
  test("single-entry result auto-expands that entry's detail panel", async ({ page }) => {
    const ENTRY_ID = "entry-auto-single";
    await setupSession(page, {
      entries: [
        {
          id: ENTRY_ID,
          date: "2026-04-15",
          lines: [
            { accountCode: "1000", debit: 100 },
            { accountCode: "4000", credit: 100 },
          ],
          memo: "LLM-posted entry",
        },
      ],
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    // Row renders…
    await expect(page.getByTestId(`accounting-journal-row-${ENTRY_ID}`)).toBeVisible();
    // …and its detail panel is auto-expanded without any user click.
    await expect(page.getByTestId(`accounting-journal-detail-${ENTRY_ID}`)).toBeVisible();
  });

  test("multi-entry batch auto-expands only the LAST entry", async ({ page }) => {
    const FIRST_ID = "entry-auto-first";
    const MIDDLE_ID = "entry-auto-middle";
    const LAST_ID = "entry-auto-last";
    await setupSession(page, {
      entries: [
        {
          id: FIRST_ID,
          date: "2026-04-10",
          lines: [
            { accountCode: "1000", debit: 50 },
            { accountCode: "4000", credit: 50 },
          ],
          memo: "First",
        },
        {
          id: MIDDLE_ID,
          date: "2026-04-12",
          lines: [
            { accountCode: "1000", debit: 60 },
            { accountCode: "4000", credit: 60 },
          ],
          memo: "Middle",
        },
        {
          id: LAST_ID,
          date: "2026-04-20",
          lines: [
            { accountCode: "1000", debit: 75 },
            { accountCode: "4000", credit: 75 },
          ],
          memo: "Last",
        },
      ],
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();

    // All three rows render.
    await expect(page.getByTestId(`accounting-journal-row-${FIRST_ID}`)).toBeVisible();
    await expect(page.getByTestId(`accounting-journal-row-${MIDDLE_ID}`)).toBeVisible();
    await expect(page.getByTestId(`accounting-journal-row-${LAST_ID}`)).toBeVisible();

    // Only the LAST entry's detail panel is open.
    await expect(page.getByTestId(`accounting-journal-detail-${LAST_ID}`)).toBeVisible();
    await expect(page.getByTestId(`accounting-journal-detail-${FIRST_ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`accounting-journal-detail-${MIDDLE_ID}`)).toHaveCount(0);
  });

  test("auto-selected row carries the row-selected class for the blue frame", async ({ page }) => {
    const ENTRY_ID = "entry-auto-frame";
    await setupSession(page, {
      entries: [
        {
          id: ENTRY_ID,
          date: "2026-04-18",
          lines: [
            { accountCode: "1000", debit: 200 },
            { accountCode: "4000", credit: 200 },
          ],
          memo: "Framed",
        },
      ],
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId(`accounting-journal-row-${ENTRY_ID}`)).toBeVisible();
    // The .row-selected class drives the scoped-CSS selection frame.
    // Pinning it here keeps the visual treatment from silently
    // regressing alongside the auto-expand behavior.
    await expect(page.getByTestId(`accounting-journal-row-${ENTRY_ID}`)).toHaveClass(/row-selected/);
  });
});
