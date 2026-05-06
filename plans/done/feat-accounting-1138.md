# Plan: manageAccounting enhancements (issue #1138)

Three independent UX improvements that reinforce each other once shipped. The unifying theme is "make the year that the book is keeping books for an explicit, navigable thing." Today the app has no notion of a fiscal year; date filters are free-form; the chart of accounts is reachable only through a modal nested inside two other forms.

Single PR. Three commits in the order below so each can be reviewed in isolation.

## Background — what's there today

- `BookSummary` (server/accounting/types.ts, src/plugins/accounting/api.ts) carries `id / name / currency / country? / createdAt`. No fiscal-year field.
- `NewBookForm.vue` collects name + currency + country. `BookSettings.vue` lets the user change country only.
- The 7 tabs in `View.vue` are: journal / newEntry / opening / ledger / balanceSheet / profitLoss / settings. There is no "Accounts" tab — the chart of accounts is reachable only via the **Manage Accounts** modal opened from `JournalEntryForm.vue` and `OpeningBalancesForm.vue`.
- `Ledger.vue` calls `getLedger(accountCode, undefined, bookId)` — passes `undefined` for the period, so it always fetches the full history. The server already supports a `ReportPeriod` argument; it has just never been wired.
- `JournalList.vue` has free-form `from` / `to` `<input type="date">` controls but no shortcut dropdown.
- `dates.ts` has `localDateString` / `localMonthString` / `localStartOfYearString`. No quarter / fiscal-year helpers.

## 1. Fiscal year end on each book

### Semantics

Each book stores a `fiscalYearEnd: "Q1" | "Q2" | "Q3" | "Q4"`, where the literal denotes which calendar-quarter end is the fiscal year end:

- **Q1** — fiscal year ends **March 31** (fiscal year covers Apr 1 → Mar 31)
- **Q2** — fiscal year ends **June 30** (fiscal year covers Jul 1 → Jun 30)
- **Q3** — fiscal year ends **September 30** (fiscal year covers Oct 1 → Sep 30)
- **Q4** — fiscal year ends **December 31** (calendar year, Jan 1 → Dec 31; **the default**)

Fiscal *quarters* within a book are aligned to its fiscal-year end. For a Q4 book they coincide with calendar quarters. For a Q1 book the four fiscal quarters are Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar (and the last one closes the fiscal year). Same shifting principle for Q2 and Q3.

### "Current quarter" / "current year" — definitions

Throughout the app and the new range picker:

- **Current quarter** = the fiscal quarter containing **today** (local timezone), under the book's `fiscalYearEnd`.
- **Previous quarter** = the fiscal quarter immediately before the current one.
- **Current year** = the fiscal year containing today, i.e. the union of the four fiscal quarters that ends on the next `fiscalYearEnd` on or after today.
- **Previous year** = the fiscal year immediately before that.
- **All** = no date bounds (`from` / `to` both empty).

The picker depends on the active book's `fiscalYearEnd`, so it's not a pure component — it takes the value as a prop.

### Required at create time, default Q4 only for back-compat

- `NewBookForm.vue` adds a required `<select>` with the four options. Default selection: `Q4`.
- The server requires `fiscalYearEnd` on **`createBook`** (rejects an absent value with a 400). On read, when an existing book on disk has no field, the value is treated as `"Q4"` *in code* — but never persisted; if the user opens settings on such a book and saves anything, the field is written through. This matches issue #1138 wording ("for backward compatibility, we allow empty property, which will be treated as Q4").
- `BookSettings.vue` lets the user change `fiscalYearEnd` (same select widget). Changing it is **pure metadata** — it does not move any entries or rebuild snapshots; it only changes how the date-range shortcuts resolve from now on. Document this in the help text under the field.

### Files

- `server/accounting/types.ts` — add `fiscalYearEnd?: "Q1"|"Q2"|"Q3"|"Q4"` to `BookSummary` (optional in the type for back-compat reads; required at the create boundary).
- `server/accounting/service.ts` — `createBook` validates and persists; `updateBook` accepts `fiscalYearEnd` and writes it.
- `src/plugins/accounting/api.ts` — mirror the field on the client `BookSummary`, extend the `createBook` and `updateBook` signatures.
- `src/plugins/accounting/components/NewBookForm.vue` — add the select, default `Q4`, send to API.
- `src/plugins/accounting/components/BookSettings.vue` — add the select between currency display and country, save through `updateBook`.
- New helper `src/plugins/accounting/fiscalYear.ts` — pure functions:
  - `fiscalYearEndMonth(end: FiscalYearEnd): 3|6|9|12`
  - `currentQuarterRange(end, today): { from, to }`
  - `previousQuarterRange(end, today): { from, to }`
  - `currentFiscalYearRange(end, today): { from, to }`
  - `previousFiscalYearRange(end, today): { from, to }`
  All return `YYYY-MM-DD` strings in local timezone (same convention as `dates.ts`).
- New unit test `test/plugins/accounting/test_fiscalYear.ts` — covers Q4 (calendar) and at least one shifted case (Q2), boundary days (the last day of a fiscal quarter resolves to *that* quarter, the first day of the next resolves to the next).

### i18n

Add to all 8 locales under `pluginAccounting.bookSwitcher`:

```
fiscalYearEndLabel
fiscalYearEndQ1   # "March 31 (Q1)"  → translate the month name
fiscalYearEndQ2   # "June 30 (Q2)"
fiscalYearEndQ3   # "September 30 (Q3)"
fiscalYearEndQ4   # "December 31 (Q4)"
fiscalYearEndHint # short paragraph: "Determines the fiscal year boundary used by the date-range shortcuts in this book. Default is December 31 (Q4)."
```

And under `pluginAccounting.settings`:

```
fiscalYearEndExplain # "Changes only how date-range shortcuts resolve from now on; existing entries are not moved."
```

`Q1` / `Q2` / `Q3` / `Q4` stay as English brand-style tokens (per the project's product-name rule).

## 2. Reusable `<DateRangePicker>` component

A small Vue component that owns the from/to inputs plus the shortcut dropdown. Used in two places this PR (Ledger and the new Accounts → Ledger transition); JournalList migration is a follow-up.

### Props / model

```ts
interface DateRange { from: string; to: string }   // "" = unbounded

defineProps<{
  modelValue: DateRange;
  fiscalYearEnd: FiscalYearEnd;   // active book's; required
}>();

defineEmits<{ "update:modelValue": [DateRange] }>();
```

Shortcut options (in order) — these write the from/to on selection:

1. **Current quarter** (default initial selection on mount when `modelValue` matches it; else the dropdown shows "Custom")
2. **Previous quarter**
3. **Current year**
4. **Previous year**
5. **All**
6. **Custom** — sentinel surfaced when from/to don't match any of the above; selecting it leaves the inputs alone.

The default value the component **starts** with is **current year**, set by the parent — the component itself is uncontrolled-default-free. Per the issue: "The default is current year." This means parents pass `currentFiscalYearRange(fiscalYearEnd, today)` as the initial `modelValue`.

### Behavior notes

- Picking a shortcut sets both inputs and re-emits.
- Editing either input switches the shortcut display to **Custom** without clearing inputs.
- "All" sets `from = ""` and `to = ""`. The component renders empty inputs in that mode.
- The component does **not** call any API. It is a pure controlled input.

### Files

- New `src/plugins/accounting/components/DateRangePicker.vue` (~80 lines).
- New unit test `test/plugins/accounting/test_DateRangePicker.ts` *if* we already have Vue component tests in the suite — otherwise rely on E2E coverage and skip the unit test (check existing test layout before adding).
- i18n keys under `pluginAccounting.dateRange.*`: `currentQuarter`, `previousQuarter`, `currentYear`, `previousYear`, `all`, `custom`, `fromLabel`, `toLabel`. All 8 locales.

### Wiring in `Ledger.vue`

- Add a `DateRangePicker` between the account select and the refresh button.
- Initial value = `currentFiscalYearRange(props.fiscalYearEnd, new Date())`.
- Pass the active book's `fiscalYearEnd` down from `View.vue` (new prop on `<Ledger>`, plumbed from `activeBook`).
- In `refresh()`, build a `ReportPeriod` from the current range:
  - When `from && to` → `{ kind: "range", from, to }`.
  - When both empty → pass `undefined` (full history).
  - Mixed (one side empty) → still send `{ kind: "range", from: from || "0000-01-01", to: to || "9999-12-31" }`. Document the convention in the helper.

### Out of scope this PR

- Migrating `JournalList.vue`'s free-form date inputs to `<DateRangePicker>`. Worth doing, but a separate change keeps this PR focused on what #1138 lists.
- Migrating `BalanceSheet.vue` / `ProfitLoss.vue` to the new picker. They already have their own period selectors that are tied to the snapshot cache; reworking them is a bigger refactor.

## 3. New **Accounts** tab

A list view of the chart of accounts, grouped by type, with a "Manage Accounts" button on the row of action buttons. Selecting an account opens the **Ledger** tab pre-filtered to that account, with the date range = current year.

### Component layout

`src/plugins/accounting/components/AccountsList.vue` — a new component, distinct from `AccountsModal.vue` (which is a modal called from forms). Reuses the same grouping logic by importing the `ACCOUNT_TYPES` constant and the per-type sort. Renders sections like the modal but uses the full panel area, no overlay chrome.

Each row is clickable. Clicking emits `selectAccount(code)` and the parent in `View.vue` reacts by:

1. Setting `currentTab.value = "ledger"`.
2. Emitting a new "preselected account" hint that the `<Ledger>` consumes via a prop (similar pattern to `entryBeingEdited`).

The Ledger reads the prop on mount / on prop change and sets its internal `accountCode` ref to that value.

### Tab definition

Add a new entry to `TABS` in `View.vue`:

```ts
{ key: "accounts", icon: "list_alt", labelKey: "pluginAccounting.tabs.accounts" }
```

Insert it **before** `ledger` so the chart-of-accounts → ledger flow reads top-to-bottom in the strip.

Gated-mode behavior: when `openingGateActive` is true, hide the accounts tab too — same rule as journal/ledger/reports. The `visibleTabs` filter already does this for everything that isn't `opening` / `settings`; the new tab key just inherits the rule.

### Manage Accounts button

A single button at the top of the Accounts panel: `+ Manage Accounts`. Opens the existing `AccountsModal.vue`. On its `changed` event, the panel does nothing extra — `bookVersion` already triggers `refetchAccounts` in `View.vue`, which trickles into the `accounts` prop of `AccountsList`.

### Hidden / soft-deleted accounts

Show only `account.active !== false` rows by default (matches what dropdowns do). A small "Show inactive" toggle in the header makes the soft-deleted ones visible — clicking them still opens the ledger.

### Files

- New `src/plugins/accounting/components/AccountsList.vue`.
- `src/plugins/accounting/View.vue` — add the tab, the `selectAccount` handler, plumb the preselected account into `<Ledger>`.
- `src/plugins/accounting/components/Ledger.vue` — accept an optional `preselectAccountCode?: string` prop; on mount or prop change, write it into the local `accountCode` ref.

### i18n

Under `pluginAccounting.tabs`:

```
accounts # "Accounts" / "勘定科目" / etc.
```

Under `pluginAccounting.accounts`:

```
manageAccounts            # button label
showInactive              # toggle
emptyForType              # "No accounts in this category"  (already present? check before adding)
```

All 8 locales. The label for the section-type headers (`asset` / `liability` / …) already exists from the modal — reuse `pluginAccounting.accounts.sectionTitle.*`.

## E2E + unit test additions

Unit:

- `test/plugins/accounting/test_fiscalYear.ts` — quarter / year resolution under each `Q1..Q4`, including boundary days.
- (Optional) `test/accounting/test_service.ts` — `createBook` rejects missing `fiscalYearEnd`, persists when supplied, `updateBook` accepts it, `listBooks` echoes back.

E2E (`e2e/tests/accounting/`):

- Extend `flow.spec.ts`: create a book with `fiscalYearEnd = Q2`, switch to Accounts tab, click an account, assert Ledger tab opens with that account selected and the date range showing the current fiscal year (the visible `from` / `to` bracket today's date and end at the next June 30).
- Assert Manage Accounts button on the Accounts tab opens the existing modal (`accounting-accounts-modal` testid).
- Assert NewBookForm requires `fiscalYearEnd` (submit-disabled-until-set, or rejected if blank — depends on UI choice).

Add `data-testid`s as needed (`accounting-tab-accounts`, `accounting-account-row-<code>`, `accounting-daterange-shortcut`, `accounting-daterange-from`, `accounting-daterange-to`, `accounting-fiscal-year-end`).

`docs/ui-cheatsheet.md` — extend the `<AccountingApp>` block with the new tab and the picker testids.

## Rollout checklist (single PR)

- [ ] **Commit 1 — Fiscal year**: `BookSummary` schema, `createBook` / `updateBook` validation, NewBookForm + BookSettings UI, `fiscalYear.ts` helpers + unit tests, i18n in all 8 locales.
- [ ] **Commit 2 — DateRangePicker + Ledger wiring**: new component, hooked into Ledger, Ledger now respects the range when calling `getLedger`. i18n in all 8 locales.
- [ ] **Commit 3 — Accounts tab**: `AccountsList.vue`, new tab, ledger preselect prop, e2e flow update. i18n in all 8 locales.
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build` all clean.
- [ ] `yarn test && yarn test:e2e` green.
- [ ] `docs/ui-cheatsheet.md` updated for the Accounts tab and DateRangePicker testids.

## Out of scope

- Migrating JournalList to the new picker (follow-up).
- Per-quarter / per-fiscal-year shortcuts on B/S and P/L tabs (those have their own period UIs).
- Mid-year change of `fiscalYearEnd` doing anything to past entries — explicitly documented as metadata-only.
- Multi-currency, tax rules, snapshot reshape — same exclusions as the original accounting plan.
