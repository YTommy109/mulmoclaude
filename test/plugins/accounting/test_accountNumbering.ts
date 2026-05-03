// Boundary tests for the account-code numbering helpers in
// src/plugins/accounting/components/accountNumbering.ts. Pure
// functions — no Vue / DOM. The `isTaxAccountCode` helper drives
// Ledger column visibility and the JournalEntryForm per-line
// taxRegistrationId input, so a regression here would silently
// flip both surfaces.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTaxAccountCode } from "../../../src/plugins/accounting/components/accountNumbering.ts";

describe("isTaxAccountCode", () => {
  it("recognizes 14xx asset codes (tax-related current assets)", () => {
    assert.equal(isTaxAccountCode("1410"), true);
    assert.equal(isTaxAccountCode("1400"), true);
    assert.equal(isTaxAccountCode("1499"), true);
  });

  it("recognizes 24xx liability codes (tax-related current liabilities)", () => {
    assert.equal(isTaxAccountCode("2400"), true);
    assert.equal(isTaxAccountCode("2410"), true);
    assert.equal(isTaxAccountCode("2499"), true);
  });

  it("rejects neighboring asset / liability bands", () => {
    // Right next to the tax bands but explicitly out of scope —
    // these must not surface the T-number column.
    assert.equal(isTaxAccountCode("1310"), false); // legacy Sales Tax Receivable code
    assert.equal(isTaxAccountCode("1500"), false);
    assert.equal(isTaxAccountCode("2300"), false);
    assert.equal(isTaxAccountCode("2500"), false);
  });

  it("rejects equity / income / expense bands entirely", () => {
    assert.equal(isTaxAccountCode("3400"), false);
    assert.equal(isTaxAccountCode("4400"), false);
    assert.equal(isTaxAccountCode("5400"), false);
  });

  it("rejects empty / non-numeric / malformed strings", () => {
    assert.equal(isTaxAccountCode(""), false);
    assert.equal(isTaxAccountCode("14"), true); // a 2-char prefix-only code still matches; documented behaviour
    assert.equal(isTaxAccountCode("not-a-code"), false);
  });
});
