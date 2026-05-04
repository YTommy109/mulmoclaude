// E2E coverage for the accounting plugin's row-click behaviors and
// the Balance Sheet's period shortcut dropdown.
//
// Three feature surfaces are pinned here:
//   1. Balance Sheet / Profit & Loss rows are clickable; clicking
//      routes to the Ledger tab pre-filtered to that account (mirrors
//      the existing AccountsList → Ledger handoff).
//   2. Balance Sheet's Period dropdown ("This month / Last month /
//      Last quarter / Last year") snaps the `<input type=month>` to
//      the chosen shortcut.
//   3. Journal entries open an inline detail panel with separate
//      Debit / Credit / Memo / T-number columns. Edit replaces the
//      detail content with the JournalEntryForm (in-place edit);
//      Cancel returns to the read-only detail; the close (X) button
//      collapses the panel.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAccountingApi, makeAccountingToolResult, type AccountingSeedBook, type BalanceSheetMock, type ProfitLossMock } from "../fixtures/accounting";

const SESSION_ID = "accounting-detail-session";

interface SetupOpts {
  books?: readonly AccountingSeedBook[];
  envelope: { bookId: string | null; initialTab?: string };
  reports?: { balanceSheet?: BalanceSheetMock; profitLoss?: ProfitLossMock };
}

async function setupSession(page: Page, opts: SetupOpts): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Accounting Detail Session",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page, { books: opts.books, reports: opts.reports });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
          { type: "text", source: "user", message: "Open my books" },
          makeAccountingToolResult(opts.envelope),
        ],
      }),
  );
}

test.describe("Balance Sheet — row click and period shortcuts", () => {
  test("clicking a balance-sheet row routes to the Ledger pre-filtered to that account", async ({ page }) => {
    const SEED_BOOK_ID = "book-bs-row-click";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "BS Click Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "balanceSheet" },
      reports: {
        balanceSheet: {
          asOf: "2026-04-30",
          imbalance: 0,
          sections: [
            { type: "asset", rows: [{ accountCode: "1000", accountName: "Cash", balance: 250 }], total: 250 },
            { type: "liability", rows: [{ accountCode: "2000", accountName: "Accounts payable", balance: 100 }], total: 100 },
            { type: "equity", rows: [{ accountCode: "3000", accountName: "Equity", balance: 150 }], total: 150 },
          ],
        },
      },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-balance-sheet")).toBeVisible();

    const cashRow = page.getByTestId("accounting-bs-row-1000");
    await expect(cashRow).toBeVisible();
    await expect(cashRow).toHaveAttribute("role", "button");
    await expect(cashRow).toHaveAttribute("tabindex", "0");

    await cashRow.click();
    await expect(page.getByTestId("accounting-ledger")).toBeVisible();
    await expect(page.getByTestId("accounting-ledger-account")).toHaveValue("1000");
  });

  test("the synthetic _currentEarnings B/S row is not clickable", async ({ page }) => {
    // The server appends a synthetic equity row with the sentinel
    // accountCode `_currentEarnings` so the B/S balances mid-period.
    // It has no underlying account, so the View must keep it
    // non-clickable (and out of the row testid namespace).
    const SEED_BOOK_ID = "book-bs-earnings-skip";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Earnings Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "balanceSheet" },
      reports: {
        balanceSheet: {
          asOf: "2026-04-30",
          imbalance: 0,
          sections: [
            { type: "asset", rows: [{ accountCode: "1000", accountName: "Cash", balance: 100 }], total: 100 },
            {
              type: "equity",
              rows: [{ accountCode: "_currentEarnings", accountName: "Current period earnings", balance: 100 }],
              total: 100,
            },
          ],
        },
      },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-balance-sheet")).toBeVisible();

    // The earnings row deliberately does NOT carry an `accounting-bs-row-…`
    // testid (so Playwright can't reach it the way it would a real
    // account row). Real account rows still expose the testid.
    await expect(page.getByTestId("accounting-bs-row-1000")).toBeVisible();
    await expect(page.getByTestId("accounting-bs-row-_currentEarnings")).toHaveCount(0);
  });

  test("Balance Sheet shortcut dropdown drives the Period input", async ({ page }) => {
    const SEED_BOOK_ID = "book-bs-shortcut";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Shortcut Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "balanceSheet" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-balance-sheet")).toBeVisible();

    const period = page.getByTestId("accounting-bs-period");
    const shortcut = page.getByTestId("accounting-bs-shortcut");

    // Each shortcut snaps the month input to a different YYYY-MM.
    // We don't pin specific values (the test runs against the system
    // clock), but each option must land on a distinct YYYY-MM string
    // to prove the four code paths are wired.
    await shortcut.selectOption("thisMonth");
    const thisMonth = await period.inputValue();
    expect(thisMonth).toMatch(/^\d{4}-\d{2}$/);

    await shortcut.selectOption("lastMonth");
    const lastMonth = await period.inputValue();
    expect(lastMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(lastMonth).not.toEqual(thisMonth);

    await shortcut.selectOption("lastQuarter");
    const lastQuarter = await period.inputValue();
    expect(lastQuarter).toMatch(/^\d{4}-\d{2}$/);

    await shortcut.selectOption("lastYear");
    const lastYear = await period.inputValue();
    expect(lastYear).toMatch(/^\d{4}-12$/);
    // Last year must be strictly older than this month.
    expect(lastYear < thisMonth).toBe(true);
  });
});

test.describe("Profit & Loss — row click", () => {
  test("clicking a P&L income or expense row routes to the Ledger pre-filtered", async ({ page }) => {
    const SEED_BOOK_ID = "book-pl-row-click";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "PL Click Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "profitLoss" },
      reports: {
        profitLoss: {
          from: "2026-01-01",
          to: "2026-12-31",
          income: { rows: [{ accountCode: "4000", accountName: "Sales", amount: 500 }], total: 500 },
          expense: { rows: [{ accountCode: "5000", accountName: "Rent expense", amount: 200 }], total: 200 },
          netIncome: 300,
        },
      },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-profit-loss")).toBeVisible();

    const incomeRow = page.getByTestId("accounting-pl-row-4000");
    await expect(incomeRow).toBeVisible();
    await expect(incomeRow).toHaveAttribute("role", "button");
    await incomeRow.click();
    await expect(page.getByTestId("accounting-ledger")).toBeVisible();
    await expect(page.getByTestId("accounting-ledger-account")).toHaveValue("4000");

    // Bounce back to P&L and pin the expense-side path too — the two
    // tables share a click handler, but a regression that tied the
    // emit to only one tbody would slip through if we only tested
    // income.
    await page.getByTestId("accounting-tab-profitLoss").click();
    const expenseRow = page.getByTestId("accounting-pl-row-5000");
    await expenseRow.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("accounting-ledger")).toBeVisible();
    await expect(page.getByTestId("accounting-ledger-account")).toHaveValue("5000");
  });
});

test.describe("Journal — clickable rows and inline detail panel", () => {
  // The fixture's withEmptyOpening already seeds an opening row, but
  // the inline detail flow only triggers on `kind: 'normal'` rows
  // (Edit/Void show only there). Each test posts one balanced normal
  // entry via the inline form before driving the detail behavior —
  // matches the existing accounting-flow shape.
  async function postNormalEntry(page: Page, opts: { debit?: string; credit?: string } = {}): Promise<void> {
    await page.getByTestId("accounting-journal-new-entry").click();
    await page.getByTestId("accounting-entry-line-account-0").selectOption("1000");
    await page.getByTestId("accounting-entry-line-debit-0").fill(opts.debit ?? "100");
    await page.getByTestId("accounting-entry-line-account-1").selectOption("4000");
    await page.getByTestId("accounting-entry-line-credit-1").fill(opts.credit ?? "100");
    await page.getByTestId("accounting-entry-submit").click();
    await expect(page.getByTestId("accounting-journal-inline-form")).toHaveCount(0);
  }

  async function findNormalRow(page: Page) {
    // The fixture's `withEmptyOpening: true` seeds an opening row
    // first; postNormalEntry then appends a normal entry, so the
    // last `accounting-journal-row-…` (excluding voided ones) closes
    // over the normal entry we just posted. The View renders entries
    // in the order the API returns them, which is append order.
    const lastRow = page.locator("[data-testid^='accounting-journal-row-']:not([data-testid*='accounting-journal-row-voided-'])").last();
    await expect(lastRow).toBeVisible();
    const rowTestId = await lastRow.getAttribute("data-testid");
    expect(rowTestId).toMatch(/^accounting-journal-row-/);
    return page.getByTestId(rowTestId as string);
  }

  test("clicking a journal row toggles the detail panel and renders Debit / Credit columns", async ({ page }) => {
    const SEED_BOOK_ID = "book-journal-detail";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Detail Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await postNormalEntry(page);

    const row = await findNormalRow(page);
    await expect(row).toHaveAttribute("role", "button");
    await expect(row).toHaveAttribute("tabindex", "0");

    // Initially collapsed.
    await expect(page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])")).toHaveCount(0);

    // Click expands. Detail panel uses a dedicated testid family.
    await row.click();
    const detailPanel = page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])");
    await expect(detailPanel).toHaveCount(1);

    // Detail header surfaces Edit / Void / Close.
    await expect(page.locator("[data-testid^='accounting-edit-']:not([data-testid*='accounting-edit-opening-'])").first()).toBeVisible();
    await expect(page.locator("[data-testid^='accounting-void-']").first()).toBeVisible();
    await expect(page.locator("[data-testid^='accounting-journal-detail-close-']").first()).toBeVisible();

    // Detail body has dedicated Debit / Credit columns — the inner
    // table headers spell them out. We rely on the (locale-stable)
    // English column headers since the test runs against the default
    // locale build; if a future test fixture switches locales, swap
    // these for `accounting-` testids on the inner table.
    await expect(detailPanel.first()).toContainText("Debit");
    await expect(detailPanel.first()).toContainText("Credit");
  });

  test("clicking the detail close button collapses the panel", async ({ page }) => {
    const SEED_BOOK_ID = "book-journal-close";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Close Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await postNormalEntry(page);

    const row = await findNormalRow(page);
    await row.click();

    const closeButton = page.locator("[data-testid^='accounting-journal-detail-close-']").first();
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    // After close, the detail panel is gone but the row stays.
    await expect(page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])")).toHaveCount(0);
    await expect(row).toBeVisible();
  });

  test("expanding a row swaps its lines cell for createdAt + Close, and the detail panel skips the duplicate metadata header", async ({ page }) => {
    // Pins the "no info shown twice" invariant after the journal row /
    // detail-panel cleanup. Specifically:
    //   1. The collapsed row's lines cell shows DR/CR amounts (e.g.
    //      "DR ¥123") — same surface the user sees today.
    //   2. Selecting that row swaps the cell's content for the
    //      createdAt timestamp and the Close (✕) button — DR/CR
    //      strings disappear from the row because the detail panel
    //      below already breaks them out into their own columns.
    //   3. The detail panel's first child is the Edit / Void action
    //      row directly (not a duplicated date / memo / createdAt
    //      strip above the action row).
    const SEED_BOOK_ID = "book-journal-dedup";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Dedup Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    // Use a non-default amount so "DR 123" / "CR 123" is uniquely
    // identifiable in the row's text content (vs. the seeded opening
    // entry's amounts).
    await postNormalEntry(page, { debit: "123", credit: "123" });

    const row = await findNormalRow(page);
    // Collapsed: lines cell carries DR/CR amounts.
    await expect(row).toContainText("DR");
    await expect(row).toContainText("CR");

    await row.click();

    // Expanded: the row's lines cell drops DR/CR text. We assert on
    // the row's own .innerText (not the page-wide text) so the inner
    // detail-panel table — which still has Debit/Credit columns and
    // the amount itself — doesn't trigger a false positive. The
    // detail-panel is in a SEPARATE <tr> below, not inside `row`.
    await expect(row).not.toContainText("DR");
    await expect(row).not.toContainText("CR");

    // The Close button now lives in the row's lines cell.
    await expect(page.locator("[data-testid^='accounting-journal-detail-close-']").first()).toBeVisible();

    // The detail panel header dropped its date / memo / createdAt
    // strip. The first interactive control inside the panel is now
    // Edit (or Void) — not a metadata line.
    const detailPanel = page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])");
    await expect(detailPanel).toHaveCount(1);
    // The Edit button must still be in the panel; the timestamp from
    // the row's cell (in `(YYYY-MM-DD HH:MM)` form) must NOT also
    // appear inside the panel — that's the duplication we removed.
    await expect(detailPanel).not.toContainText(/\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)/);
  });

  test("clicking Edit in the detail panel replaces it with the in-place form; Cancel returns to read-only", async ({ page }) => {
    const SEED_BOOK_ID = "book-journal-edit-inplace";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Edit-in-place Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await postNormalEntry(page);

    const row = await findNormalRow(page);
    await row.click();

    // Edit lives inside the detail panel (no longer in the row's
    // action cell). Click it; the read-only detail collapses and the
    // JournalEntryForm mounts in its place inside the same row's
    // expanded slot, NOT at the top of the page.
    const editButton = page.locator("[data-testid^='accounting-edit-']:not([data-testid*='accounting-edit-opening-'])").first();
    await editButton.click();

    // Top-bar form must NOT open — that path is reserved for "+ New
    // entry". The in-place form has its own dedicated testid prefix.
    await expect(page.getByTestId("accounting-journal-inline-form")).toHaveCount(0);
    const inPlaceForm = page.locator("[data-testid^='accounting-journal-detail-edit-']");
    await expect(inPlaceForm).toHaveCount(1);

    // Cancel from the in-place edit returns to the read-only detail
    // for the same row (panel stays expanded; edit form unmounts).
    await page.getByTestId("accounting-entry-cancel-edit").click();
    await expect(inPlaceForm).toHaveCount(0);
    const detailPanel = page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])");
    await expect(detailPanel).toHaveCount(1);
    // Edit/Void/Close are back in the read-only header.
    await expect(page.locator("[data-testid^='accounting-edit-']:not([data-testid*='accounting-edit-opening-'])").first()).toBeVisible();
    await expect(page.locator("[data-testid^='accounting-journal-detail-close-']").first()).toBeVisible();
  });
});
