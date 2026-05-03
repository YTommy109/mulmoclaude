// Pins the seeded chart's tax-suspense flags. The Ledger view's
// T-number column is gated by `Account.tracksTaxRegistration`, so a
// regression that strips the flag from `1310` or `2400` would
// silently break the column for every fresh book.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ACCOUNTS } from "../../server/accounting/defaultAccounts.js";

describe("DEFAULT_ACCOUNTS", () => {
  it("seeds 1310 Sales Tax Receivable as an active tax-suspense account", () => {
    const account = DEFAULT_ACCOUNTS.find((entry) => entry.code === "1310");
    assert.ok(account, "1310 missing from default chart");
    assert.equal(account?.name, "Sales Tax Receivable");
    assert.equal(account?.type, "asset");
    assert.equal(account?.active, undefined, "1310 should be active by default (active flag omitted)");
    assert.equal(account?.tracksTaxRegistration, true);
  });

  it("seeds 2400 Sales Tax Payable as an active tax-suspense account", () => {
    const account = DEFAULT_ACCOUNTS.find((entry) => entry.code === "2400");
    assert.ok(account, "2400 missing from default chart");
    assert.equal(account?.name, "Sales Tax Payable");
    assert.equal(account?.type, "liability");
    assert.equal(account?.active, undefined, "2400 should be active by default (active flag omitted)");
    assert.equal(account?.tracksTaxRegistration, true);
  });

  it("does not tag any non-tax-suspense default with tracksTaxRegistration", () => {
    // The flag is reserved for accounts whose journal lines are
    // expected to carry a counterparty tax-registration ID. Cross-
    // contaminating the seed (e.g. tagging 1000 Cash) would surface
    // an empty T-number column on every Ledger view of that account.
    const tagged = DEFAULT_ACCOUNTS.filter((entry) => entry.tracksTaxRegistration === true).map((entry) => entry.code);
    assert.deepEqual(tagged.sort(), ["1310", "2400"]);
  });
});
