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
    // — it only renders on lines whose account is in the 14xx /
    // 24xx tax-related band (see
    // src/plugins/accounting/components/accountNumbering.ts). On a
    // fresh form every line's accountCode is "", so the column
    // and input are hidden until the user picks a tax account.
    const taxIdInput = page.getByTestId("accounting-entry-line-tax-registration-id-0");
    await expect(taxIdInput).toHaveCount(0);
    await page.getByTestId("accounting-entry-line-account-0").selectOption("1410");

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
