import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAmountNumeric, formatAmount, fractionDigitsFor } from "../../../src/plugins/accounting/currencies.js";

describe("formatAmountNumeric", () => {
  it("renders 2 decimals by default", () => {
    const out = formatAmountNumeric(1234.5);
    assert.match(out, /[.,]50/);
  });

  it("accepts 0 decimals for integer-only currencies", () => {
    const out = formatAmountNumeric(1234, 0);
    // Locale-dependent grouping (`1,234` / `1.234` / `1234`); just
    // assert the fractional part is absent.
    assert.equal(out.endsWith(".00"), false);
    assert.equal(/\.\d/.test(out), false);
  });

  it("handles negative amounts", () => {
    const out = formatAmountNumeric(-99.99);
    assert.match(out, /99/);
  });

  it("handles zero", () => {
    const out = formatAmountNumeric(0);
    assert.match(out, /0/);
    assert.match(out, /00/);
  });
});

describe("formatAmount currency awareness", () => {
  it("returns a non-empty string for valid currency", () => {
    const out = formatAmount(1130, "USD");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });

  it("respects fractionDigitsFor on the fallback path", () => {
    // JPY → 0 decimals. Even on the fallback path (e.g. unknown
    // currency code), the helper should return whole numbers for JPY.
    const jpy = formatAmount(1130, "JPY");
    assert.match(jpy, /1[,.]?130|1130/);
    assert.equal(jpy.includes(".00"), false);
  });

  it("fractionDigitsFor returns 0 for JPY, 2 for USD", () => {
    assert.equal(fractionDigitsFor("JPY"), 0);
    assert.equal(fractionDigitsFor("USD"), 2);
  });
});
