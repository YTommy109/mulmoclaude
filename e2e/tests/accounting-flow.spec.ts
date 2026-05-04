// Functional flow for the accounting plugin. Mounts <AccountingApp>
// via an injected tool_result envelope and drives the canvas against
// the in-memory mock from e2e/fixtures/accounting.ts.
//
// The production LLM path is `createBook → openBook(bookId)`: openBook
// requires a non-empty, existing bookId (else 400/404). The first
// test below pins that path against a seeded book; the second pins
// the defensive first-run fallback the View still renders when the
// book list comes back empty (a stale envelope or out-of-band delete
// — not reachable from the LLM).

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAccountingApi, makeAccountingToolResult, type AccountingSeedBook } from "../fixtures/accounting";

const SESSION_ID = "accounting-session";

interface SetupOpts {
  books?: readonly AccountingSeedBook[];
  envelope: { bookId: string | null; initialTab?: string };
}

async function setupSession(page: Page, opts: SetupOpts): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Accounting Session",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page, { books: opts.books });

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

test.describe("accounting plugin — flow", () => {
  test("openBook envelope with a real bookId mounts <AccountingApp> on that book", async ({ page }) => {
    const SEED_BOOK_ID = "book-seeded-1";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Seeded Book" }],
      envelope: { bookId: SEED_BOOK_ID },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    // Production path: <AccountingApp> mounts on the seeded book and
    // shows the regular chrome (header + tabs). The first-run form
    // must NOT render — that branch is reserved for an empty book
    // list, which can't happen when openBook resolves a real id.
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-tabs")).toBeVisible();
    await expect(page.getByTestId("accounting-new-book-firstrun")).not.toBeVisible();
    await expect(page.getByTestId("accounting-no-book")).not.toBeVisible();
  });

  test("New Entry tab exposes the per-line tax-registration ID input when a 14xx account is picked", async ({ page }) => {
    const SEED_BOOK_ID = "book-tax-id-1";
    // `withEmptyOpening: true` lets us land on a book whose
    // opening-gate is already satisfied — without it, the View
    // hides every tab except `opening` and `settings` until the
    // user saves an opening, and `accounting-tab-newEntry` would
    // never render.
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Seeded Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-tabs")).toBeVisible();
    await page.getByTestId("accounting-tab-newEntry").click();

    // The tax-registration ID input is gated by `isTaxAccountCode`
    // — it only renders on lines whose account is in the 14xx
    // input-tax band (see
    // src/plugins/accounting/components/accountNumbering.ts). On a
    // fresh form every line's accountCode is "", so the column
    // and input are hidden until the user picks a 14xx account.
    const taxIdInput = page.getByTestId("accounting-entry-line-tax-registration-id-0");
    await expect(taxIdInput).toHaveCount(0);
    await page.getByTestId("accounting-entry-line-account-0").selectOption("1400");

    await expect(taxIdInput).toBeVisible();
    await taxIdInput.fill("T1234567890123");
    await expect(taxIdInput).toHaveValue("T1234567890123");

    // Switching the line back to a non-tax account must hide the
    // input again. (The "typed value is dropped on submit" guarantee
    // is enforced in `toApiLines` — gated by `isTaxLine` — but
    // verifying that requires a network round-trip that's out of
    // scope for this UI smoke test.)
    await page.getByTestId("accounting-entry-line-account-0").selectOption("1000");
    await expect(taxIdInput).toHaveCount(0);

    // Pin the negative-side rule introduced in PR #1137: 24xx
    // output-tax accounts (e.g. 2400 Sales Tax Payable) must NOT
    // surface the T-number column. Without this assertion a
    // regression that re-broadened `isTaxAccountCode` back to
    // `["14", "24"]` would slip through e2e — the existing 1000
    // check above only proves a non-tax account hides the input,
    // not that 24xx specifically does.
    await page.getByTestId("accounting-entry-line-account-0").selectOption("2400");
    await expect(taxIdInput).toHaveCount(0);
  });

  test("deleting a book with siblings shows the deleted-notice panel; tabs are disabled until the user picks another book", async ({ page }) => {
    // Issue #1126 (1): after deleting one of multiple books, the
    // canvas must NOT silently snap to books[0]. Instead it shows a
    // "<book> deleted" panel; the only path forward is the
    // BookSwitcher dropdown.
    const KEEP_ID = "book-keep";
    const DOOMED_ID = "book-doomed";
    await setupSession(page, {
      books: [
        { id: KEEP_ID, name: "Keep", withEmptyOpening: true },
        { id: DOOMED_ID, name: "Doomed", withEmptyOpening: true },
      ],
      envelope: { bookId: DOOMED_ID, initialTab: "settings" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-settings")).toBeVisible();

    // Type the doomed book's name into the confirm field, then delete.
    await page.getByTestId("accounting-settings-delete-confirm").fill("Doomed");
    await page.getByTestId("accounting-settings-delete").click();

    // The deleted-notice panel must surface the deleted book's name.
    await expect(page.getByTestId("accounting-deleted-notice")).toBeVisible();
    await expect(page.getByTestId("accounting-deleted-notice-title")).toContainText("Doomed");

    // Tab strip is rendered but disabled — clicking a tab does
    // nothing while the notice is up. Verify by clicking journal and
    // confirming the notice stays.
    await page.getByTestId("accounting-tab-journal").click({ force: true });
    await expect(page.getByTestId("accounting-deleted-notice")).toBeVisible();

    // Picking the surviving book from the dropdown clears the notice
    // and re-enables the tab strip.
    await page.getByTestId("accounting-book-select").selectOption(KEEP_ID);
    await expect(page.getByTestId("accounting-deleted-notice")).not.toBeVisible();
    await expect(page.getByTestId("accounting-tab-journal")).toBeVisible();
  });

  test("creating a new book from the BookSwitcher auto-switches the canvas to the new book", async ({ page }) => {
    // Issue #1126 (2): with one or more existing books, picking
    // "+ New book" from the dropdown and submitting must move the
    // canvas onto the freshly-created book — not leave it pointing
    // at the previously-active one.
    const EXISTING_ID = "book-existing";
    await setupSession(page, {
      books: [{ id: EXISTING_ID, name: "Existing", withEmptyOpening: true }],
      envelope: { bookId: EXISTING_ID },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-book-select")).toHaveValue(EXISTING_ID);

    // Trigger the "+ New book" sentinel option and fill the modal.
    await page.getByTestId("accounting-book-select").selectOption("__new__");
    await expect(page.getByTestId("accounting-new-book-modal")).toBeVisible();
    await page.getByTestId("accounting-new-book-name").fill("Brand New");
    await page.getByTestId("accounting-new-book-submit").click();

    // Modal closes and the dropdown's selection follows to the new
    // book. Pin both: the option text contains "Brand New", and
    // the option's underlying value is NOT the previous book's id.
    await expect(page.getByTestId("accounting-new-book-modal")).not.toBeVisible();
    const select = page.getByTestId("accounting-book-select");
    await expect(select).not.toHaveValue(EXISTING_ID);
    const selectedLabel = await select.locator("option:checked").textContent();
    expect(selectedLabel).toContain("Brand New");
  });

  test("renders full-page first-run form when the workspace is empty (defensive fallback)", async ({ page }) => {
    // openBook now 400s on a missing bookId, so this state is no
    // longer reachable from the LLM. The View still renders the
    // full-page first-run form when refetchBooks() returns an empty
    // list — defensive against a stale envelope or an out-of-band
    // delete between mount and book fetch. Pin that behavior here.
    await setupSession(page, { envelope: { bookId: null } });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-new-book-modal")).toBeVisible();
    await expect(page.getByTestId("accounting-new-book-firstrun")).toBeVisible();
    await expect(page.getByTestId("accounting-tabs")).not.toBeVisible();
    await expect(page.getByTestId("accounting-no-book")).not.toBeVisible();
  });
});
