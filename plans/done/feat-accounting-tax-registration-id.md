# Plan: Accounting plugin — input-tax tracking + `taxRegistrationId` on journal lines

Support proper booking of input tax (the consumption / sales / VAT tax a business pays on purchases) so it can be offset against output tax at filing time. Driven by the Japanese インボイス制度 (Qualified Invoice System, effective 2023-10-01), which requires recording the supplier's registration number for every input-tax-credit-eligible purchase. Designed jurisdiction-agnostically so it covers EU VAT IDs, UK VAT registration numbers, GSTIN, ABN, and similar tax-authority-issued counterparty identifiers.

Scope: one PR. Three pieces — a new default account, a new optional field on `JournalLine`, and a small UI affordance in the journal entry form.

## 1. New default account: `1310 Sales Tax Receivable`

Pairs with the existing `2400 Sales Tax Payable`. Added to `server/accounting/defaultAccounts.ts` as `active: false` (same as Sales Tax Payable — only businesses subject to consumption / sales tax need it).

```ts
{ code: "1310", name: "Sales Tax Receivable", type: "asset", active: false },
```

Placement rationale: 13xx is the "other current assets" band in the seeded chart (currently `1300 Prepaid Expenses` is the only entry). Code 1310 sits next to it without colliding with the 12xx Inventory or 15xx Fixed Assets bands.

### Why a separate asset account, not netting against `2400` directly

The two suspense balances (input vs. output tax) must stay independently visible across the period:

- The 確定申告 (consumption tax return) requires both gross totals, not just the net
- An audit trail showing how much tax was paid vs. collected is what the tax authority verifies against
- If input tax exceeds output (export-heavy or capex-heavy periods), the receivable carries a real debit balance — that's a refund due, which is genuinely an asset, not a "negative liability"

The standard Japanese convention is the **税抜経理方式** (tax-excluded method) with two parallel suspense accounts. The smaller-business alternative (税込経理方式 — book everything gross, true up once a year as `5810 Taxes`) is already supported by the existing chart and needs no changes.

### Worked example

Buy ¥1,000 inventory + ¥100 input tax; sell for ¥2,000 + ¥200 output tax.

Purchase:

| Account | Debit | Credit |
|---|---|---|
| 1200 Inventory | 1,000 | |
| 1310 Sales Tax Receivable | 100 | |
| 1000 Cash | | 1,100 |

Sale:

| Account | Debit | Credit |
|---|---|---|
| 1000 Cash | 2,200 | |
| 4000 Sales | | 2,000 |
| 2400 Sales Tax Payable | | 200 |

Period close — net the two and remit the difference:

| Account | Debit | Credit |
|---|---|---|
| 2400 Sales Tax Payable | 200 | |
| 1310 Sales Tax Receivable | | 100 |
| 1000 Cash | | 100 |

Both suspense accounts return to zero.

## 2. `taxRegistrationId` on `JournalLine`

Add an optional field to `server/accounting/types.ts`:

```ts
export interface JournalLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  memo?: string;
  /** Counterparty's tax-authority-issued registration ID for this
   *  line — Japanese T-number, EU VAT identification number, UK VAT
   *  registration number, India GSTIN, Australia ABN, etc. Required
   *  for input-tax-credit eligibility under the Japanese インボイス
   *  制度 and equivalent regimes elsewhere. Free-form string; format
   *  validation belongs upstream (per-jurisdiction). */
  taxRegistrationId?: string;
}
```

### Naming rationale

`taxRegistrationId` reads naturally across jurisdictions:

| Jurisdiction | Local name | Format |
|---|---|---|
| 🇯🇵 Japan | 登録番号 (T-number) | `T` + 13 digits |
| 🇪🇺 EU | VAT identification number | 2-letter country + digits |
| 🇬🇧 UK | VAT registration number | `GB` + 9 digits |
| 🇮🇳 India | GSTIN | 15 chars |
| 🇦🇺 Australia | ABN | 11 digits |

Alternatives considered and rejected:

- `taxId` — too broad; would be ambiguous with the user's own tax ID
- `tNumber` / `registrationNumber` — too JP-flavored; not self-describing in EU / IN / AU contexts
- `partyTaxId` — accurate (it's the counterparty's ID) but "party" is jargon outside accounting circles
- `supplierTaxId` — biased toward purchases; the same field on a sale line would record the customer's ID, which is also useful (issuing your own qualified invoices)

### Validation

Free-form string. No format check — formats vary too much by jurisdiction, and the burden of correctness belongs with the user / their invoice. Single defensive cap: max length 32 characters (covers the longest known formats with margin). Caller surfaces a clear validation error if the cap is exceeded; no client-side regex.

### Persistence

Stored verbatim in the journal JSONL line. No derived index, no separate table. Reading is "iterate journal entries, read `taxRegistrationId` per line." Reporting on input-tax-credit by supplier is a deferred concern — the data is captured and queryable; aggregation tools can be added when there's a concrete user need.

## 3. API surface

No new endpoints. Three existing surfaces pass `JournalLine` through verbatim and pick up the new field automatically once the type is updated:

- **REST**: `POST /api/accounting` (`addEntry`, `voidEntry` actions) and the read paths (`getEntries`, `getReport`). Confirm the request / response marshaling spreads unknown fields rather than filtering — tracing one round trip for `taxRegistrationId` is enough.
- **MCP / agent action**: the `manageAccounting` tool's `postJournalEntry` action contract. Update the action's input / output schema to include `taxRegistrationId?: string` on lines so the agent can both set and read it.
- **Pub/sub**: events that include entry payloads (e.g. `journal-entry-added`) will carry the field automatically once the type is updated.

Smoke verification: a single end-to-end test that posts an entry with `taxRegistrationId` set on one line, reads it back through `getEntries`, and asserts the value round-trips on that line and is absent on the others.

## 4. UI: `JournalEntryForm.vue`

Add an optional `<input>` per line, alongside the existing per-line `memo` field. Always shown (not gated behind a "Show tax details" toggle) — the field is optional and the row already has space; hiding it would just mean users overlook it.

- Placeholder: localized hint, e.g. `T1234567890123` (with locale-appropriate examples — `GB123456789` for `en`, `T1234567890123` for `ja`, etc., or a single jurisdiction-neutral hint like "Tax registration ID")
- Width: narrower than the memo field; the IDs are short
- Validation: realtime length-cap red border (matching the AccountEditor pattern shipped in this branch)
- i18n: one new key `pluginAccounting.entryForm.taxRegistrationIdLabel` and one `…Placeholder`, in all 8 locales

The Japanese-specific terminology (`登録番号`, `インボイス制度`) goes only in the `ja` locale; other locales use the jurisdiction-neutral wording. The field's `data-testid` is `accounting-entry-line-tax-registration-id-${index}`.

## 5. Tests

- **Unit (`test/accounting/test_journal.ts`)**: persisting and reading back a line with `taxRegistrationId`; absence on lines that didn't set it (the field is omitted from JSONL when undefined, not stored as `null`).
- **Unit (`test/accounting/test_service.ts`)**: `addEntry` accepts the field and round-trips it; the void-reverse path preserves it on the reversing entry's lines (each reversed line carries the original `taxRegistrationId` so the audit trail survives a void).
- **Validation (`test/plugins/accounting/test_journalLineValidation.ts` — new file if needed)**: max-length cap rejects > 32 chars with a clear error code; empty string is treated as `undefined`.
- **API smoke (`test/server/api/test_accounting.ts` or equivalent)**: POST an entry with the field, GET it back, assert round-trip.
- **E2E (`e2e/tests/accounting-flow.spec.ts`)**: fill the new input on one line of a new entry, post it, navigate to the journal list, click into the entry, assert the value renders. Also assert the field is empty by default.

## 6. Documentation

- **`docs/ui-cheatsheet.md`**: extend the `<JournalEntryForm>` block with the new per-line input and its `data-testid`.
- **`docs/developer.md`**: short note under the accounting section that `JournalLine.taxRegistrationId` is the canonical place for counterparty tax-registration IDs (T-number, VAT ID, GSTIN, ABN, …) and is round-tripped through REST + MCP without translation.

## Out of scope

- Per-jurisdiction format validation (T-number checksum, VAT ID country-code prefix check, GSTIN structure). Defer until a concrete user need surfaces.
- Reporting / aggregation by supplier (e.g. "input tax paid to T1234… this period"). Data is captured; aggregation can be a follow-up plan.
- Automatic netting of `1310 Sales Tax Receivable` against `2400 Sales Tax Payable` at period close. The user does the journal entry by hand for now (matches the rest of the period-close flow). A guided "consumption tax return" workflow is a separate, larger plan.
- Customer-side qualified-invoice issuance (your own T-number on outgoing invoices). The field captures it on the sale line if set, but the broader UX of issuing qualified invoices is out of scope.

## Rollout checklist

- [ ] `1310 Sales Tax Receivable` added to `defaultAccounts.ts` as `active: false`
- [ ] `JournalLine.taxRegistrationId?: string` added to `server/accounting/types.ts`
- [ ] Validation: max 32 chars; empty string normalized to `undefined`
- [ ] REST round-trip verified (POST sets, GET reads)
- [ ] `manageAccounting` MCP action schema updated to accept and return the field
- [ ] Void path preserves `taxRegistrationId` on each reversed line
- [ ] `JournalEntryForm.vue` per-line input + i18n in all 8 locales
- [ ] `data-testid="accounting-entry-line-tax-registration-id-${index}"`
- [ ] Unit tests: journal IO round-trip, service `addEntry` round-trip, validation cap
- [ ] API smoke test
- [ ] E2E: set the field, post, read back through the list view
- [ ] `docs/ui-cheatsheet.md` updated with the new input
- [ ] `docs/developer.md` accounting section names the canonical field
