// Pins the seeded chart's tax-related accounts. The Ledger view's
// T-number column and the JournalEntryForm's per-line
// taxRegistrationId input both key off `isTaxAccountCode` (14xx
// asset / 24xx liability — see
// src/plugins/accounting/components/accountNumbering.ts), so a
// regression that moves `1400` or `2400` out of those bands would
// silently break both surfaces for every fresh book.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ACCOUNTS } from "../../server/accounting/defaultAccounts.js";

describe("DEFAULT_ACCOUNTS", () => {
  it("seeds 1400 Input Tax Receivable as an active current asset", () => {
    const account = DEFAULT_ACCOUNTS.find((entry) => entry.code === "1400");
    assert.ok(account, "1400 missing from default chart");
    assert.equal(account?.name, "Input Tax Receivable");
    assert.equal(account?.type, "asset");
    assert.equal(account?.active, undefined, "1400 should be active by default (active flag omitted)");
  });

  it("seeds 2400 Sales Tax Payable as an active current liability", () => {
    const account = DEFAULT_ACCOUNTS.find((entry) => entry.code === "2400");
    assert.ok(account, "2400 missing from default chart");
    assert.equal(account?.name, "Sales Tax Payable");
    assert.equal(account?.type, "liability");
    assert.equal(account?.active, undefined, "2400 should be active by default (active flag omitted)");
  });

  it("does not carry the now-removed tracksTaxRegistration flag on any default", () => {
    // The convention `isTaxAccountCode` replaced the per-account
    // flag. If a future revert accidentally re-introduces the field
    // on a default, this test will catch it.
    const tagged = DEFAULT_ACCOUNTS.filter((entry) => (entry as unknown as { tracksTaxRegistration?: boolean }).tracksTaxRegistration === true).map(
      (entry) => entry.code,
    );
    assert.deepEqual(tagged, []);
  });

  it("does not seed any account with the legacy 1310 code", () => {
    // 1310 was the original Sales Tax Receivable code before the
    // 14xx tax-related band was reserved. The seed should no
    // longer use it; existing books that still hold 1310 are not
    // migrated (per the design call), but new books must land on
    // 1400.
    const legacy = DEFAULT_ACCOUNTS.find((entry) => entry.code === "1310");
    assert.equal(legacy, undefined);
  });
});
