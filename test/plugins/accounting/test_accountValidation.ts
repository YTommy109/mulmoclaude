// Boundary tests for the AccountsModal client-side validator. Pure
// function — no Vue / i18n / network. Mirrors the server's
// `_`-prefix rule and the duplicate-code guard so the user sees the
// localized message instead of round-tripping for an obvious
// failure.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAccountDraft } from "../../../src/plugins/accounting/components/accountValidation.ts";
import type { Account } from "../../../src/plugins/accounting/api.ts";
import type { AccountDraft } from "../../../src/plugins/accounting/components/accountDraft.ts";

const EXISTING: readonly Account[] = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "5100", name: "Rent", type: "expense" },
];

function draft(overrides: Partial<AccountDraft> = {}): AccountDraft {
  return { code: "5500", name: "Marketing", type: "expense", note: "", ...overrides };
}

describe("validateAccountDraft", () => {
  describe("happy path", () => {
    it("accepts a brand-new code that doesn't collide", () => {
      assert.equal(validateAccountDraft(draft(), EXISTING, true), null);
    });

    it("accepts an edit of an existing account (same code is allowed when !isNew)", () => {
      assert.equal(validateAccountDraft(draft({ code: "1000", name: "Petty Cash" }), EXISTING, false), null);
    });

    it("trims surrounding whitespace before validating", () => {
      assert.equal(validateAccountDraft(draft({ code: "  6000  ", name: "  Travel  " }), EXISTING, true), null);
    });
  });

  describe("emptyCode", () => {
    it("rejects an empty code", () => {
      assert.equal(validateAccountDraft(draft({ code: "" }), EXISTING, true), "emptyCode");
    });

    it("rejects whitespace-only code (treated as empty after trim)", () => {
      assert.equal(validateAccountDraft(draft({ code: "   " }), EXISTING, true), "emptyCode");
    });
  });

  describe("reservedCode", () => {
    it("rejects a code starting with the reserved `_` prefix", () => {
      assert.equal(validateAccountDraft(draft({ code: "_synthetic" }), EXISTING, true), "reservedCode");
    });

    it("rejects on edit too — server would also reject", () => {
      assert.equal(validateAccountDraft(draft({ code: "_synthetic" }), EXISTING, false), "reservedCode");
    });

    it("only the leading `_` is reserved, not embedded ones", () => {
      // The server's check is `startsWith("_")`, not "contains". A
      // user-supplied code like "5_100" is fine — encoded here so a
      // future tightening of the rule fires this test instead of
      // surprising the user.
      assert.equal(validateAccountDraft(draft({ code: "5_100" }), EXISTING, true), null);
    });
  });

  describe("emptyName", () => {
    it("rejects an empty name", () => {
      assert.equal(validateAccountDraft(draft({ name: "" }), EXISTING, true), "emptyName");
    });

    it("rejects whitespace-only name", () => {
      assert.equal(validateAccountDraft(draft({ name: "   " }), EXISTING, true), "emptyName");
    });

    it("checks code before name (emptyCode wins when both are empty)", () => {
      // Stable error precedence so the user fixes one issue at a
      // time instead of seeing the message change as they type.
      assert.equal(validateAccountDraft(draft({ code: "", name: "" }), EXISTING, true), "emptyCode");
    });
  });

  describe("duplicateCode", () => {
    it("rejects a new entry with a code that already exists", () => {
      assert.equal(validateAccountDraft(draft({ code: "1000" }), EXISTING, true), "duplicateCode");
    });

    it("does NOT flag duplicate when editing (isNew=false) — that's the upsert path", () => {
      // Editing an existing account naturally re-submits its own
      // code; the duplicate check would otherwise block every
      // legitimate edit.
      assert.equal(validateAccountDraft(draft({ code: "1000", name: "Cash on Hand" }), EXISTING, false), null);
    });

    it("matches duplicate against the trimmed code", () => {
      assert.equal(validateAccountDraft(draft({ code: "  1000  " }), EXISTING, true), "duplicateCode");
    });

    it("checks reservedCode before duplicateCode (reserved wins)", () => {
      // If a synthetic-prefix code somehow already exists (stale
      // data, hand-edited file, etc.), the reserved-prefix message
      // is more actionable than "already exists".
      const withSynthetic: readonly Account[] = [...EXISTING, { code: "_synthetic", name: "X", type: "asset" }];
      assert.equal(validateAccountDraft(draft({ code: "_synthetic" }), withSynthetic, true), "reservedCode");
    });
  });
});
