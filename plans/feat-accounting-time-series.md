# Plan: Accounting plugin — `getTimeSeries` action for cross-period reports

The current `manageAccounting.getReport` aggregates exactly one window (a single month, or one `[from, to]` range). To answer "what was my revenue per quarter for the last two years?" the LLM has to fan out N `getReport` calls, parse a full P&L envelope from each, pluck `income.total`, and assemble the series itself. Slow, wasteful in tokens, and easy to get wrong on fiscal-quarter boundaries.

This plan adds a single new action — `getTimeSeries` — that returns a flat `(periodLabel, value)[]` series the LLM can hand straight to `presentChart`. It also expands the Accounting role's sample queries so the new capability is exercised from day one.

`getReport` keeps its current shape and contract. No breaking changes.

## Goals

1. One round-trip for any chartable accounting metric over time.
2. Token-efficient response — one number per bucket, not a full P&L per bucket.
3. Fiscal-aware bucketing — "by quarter" honours the active book's `fiscalYearEnd`.
4. The sample queries on the Accounting role include at least one cross-period query, so a fresh user testing the role hits the new action immediately.

## Non-goals

- No retrofit of the in-canvas Accounting `<View>` to use this — the View has its own UI for switching periods. `getTimeSeries` is an LLM-facing action only.
- No new chart-rendering primitives in `presentChart` — the existing chart plugin already handles `(label, value)[]`.
- No `kind: "ledger"` time series. A "running balance over time" view per account is interesting but out of scope; revisit if a sample query motivates it.
- No multi-metric / multi-series response shape (e.g. `[{ income, expense, netIncome }]` per bucket). One metric per call. The LLM can issue parallel calls if it wants two series on one chart — `getTimeSeries` is cheap enough that this is fine.

## API shape

### Action

Add `getTimeSeries` to `ACCOUNTING_ACTIONS` in `src/plugins/accounting/actions.ts`.

### Tool parameters

Extend the `manageAccounting` JSON schema in `src/plugins/accounting/definition.ts` with these properties (all optional at the top level — required only when `action === "getTimeSeries"`, validated server-side):

| Field | Type | Notes |
|---|---|---|
| `metric` | enum: `"revenue" \| "expense" \| "netIncome" \| "accountBalance"` | What to plot per bucket. |
| `granularity` | enum: `"month" \| "quarter" \| "year"` | Bucket size. `"quarter"` and `"year"` honour the book's `fiscalYearEnd`. |
| `from` | string `YYYY-MM-DD` | Inclusive lower bound. The first bucket is the one *containing* `from`. |
| `to` | string `YYYY-MM-DD` | Inclusive upper bound. The last bucket is the one *containing* `to`. |
| `accountCode` | string | Required when `metric === "accountBalance"`. Forbidden otherwise. |

Reuses the top-level `bookId` already on the schema. No new `period` shape.

### Response

```ts
interface TimeSeriesPoint {
  /** Bucket label intended for chart axes. Format depends on
   *  granularity: "2025-09" / "FY2025-Q3" / "FY2025". */
  label: string;
  /** Inclusive start of the bucket, YYYY-MM-DD. */
  from: string;
  /** Inclusive end of the bucket, YYYY-MM-DD. */
  to: string;
  /** Single number — natural-sign per metric. Revenue and net
   *  income are positive when income exceeds expense; expense is
   *  reported as a positive cost (sign matches the P&L
   *  presentation, not the underlying credit/debit). */
  value: number;
}

interface TimeSeriesResponse {
  bookId: string;
  metric: "revenue" | "expense" | "netIncome" | "accountBalance";
  granularity: "month" | "quarter" | "year";
  /** Echoed for convenience — matches the input range, not the
   *  outermost bucket boundaries. The LLM uses these to caption
   *  the chart truthfully. */
  from: string;
  to: string;
  /** Required when metric === "accountBalance", echoed for chart
   *  titles. Omitted for the P&L metrics. */
  accountCode?: string;
  /** Always at least one element when from ≤ to. */
  points: TimeSeriesPoint[];
}
```

`points` is sorted ascending by `from`. Empty buckets (no entries in range) still appear with `value: 0` so the chart has a continuous x-axis.

## Server work

### `server/accounting/timeSeries.ts` (new)

Pure aggregation, mirroring `report.ts`:

- `bucketize(from, to, granularity, fiscalYearEnd) → BucketBoundary[]` — returns the inclusive `[from, to]` for each bucket, plus the chart label. For `granularity === "quarter"` and `"year"` it calls into existing helpers in `src/plugins/accounting/fiscalYear.ts` (which compute fiscal-quarter boundaries from `Q1..Q4` ends).
  - **Move bucket boundary helpers to a shared module first.** `fiscalYear.ts` lives under `src/plugins/accounting/`, and the server can't import from `src/`. Either (a) move the helpers into a server-side module like `server/accounting/fiscalYear.ts` and re-export from the plugin, or (b) extract a small `packages/accounting-core/` shared module. Option (a) is cheaper for this PR; option (b) is the right long-term home but out of scope here.
- `buildTimeSeries({ entries, accounts, openingBalances, buckets, metric, accountCode? }) → TimeSeriesPoint[]` — single pass over `entries` per bucket; for `accountBalance` it walks all entries with `entry.date <= bucket.to` (closing balance is cumulative; opening balances must be included).

### `server/accounting/service.ts`

Add `getTimeSeriesReport(input, workspaceRoot?)`:

1. Resolve `bookId`, load `book` (need `fiscalYearEnd`), accounts, opening balances, and journal entries (use `readAllEntries` — same path as `getProfitLossReport`).
2. Call `bucketize(from, to, granularity, book.fiscalYearEnd ?? "Q4")`.
3. Call `buildTimeSeries(...)` and assemble the response envelope.

For `granularity === "month"` we *can* fast-path off the snapshot cache (one snapshot read per bucket boundary), but that's a perf optimization and not required for v1. The simple "filter entries per bucket" path is correct and adequate up to several thousand entries; revisit only if profiling motivates it. Note in a code comment.

### `server/api/routes/accounting.ts`

- Add `handleGetTimeSeries(rest)` that validates required fields with the same `AccountingError(400, ...)` style as `handleGetReport`:
  - `metric` is one of the four enum values
  - `granularity` is one of the three enum values
  - `from` and `to` are non-empty `YYYY-MM-DD` and `from <= to`
  - `accountCode` required iff `metric === "accountBalance"` (400 if missing or if present but metric isn't `accountBalance`)
- Wire into `ACTION_HANDLERS` under `[ACCOUNTING_ACTIONS.getTimeSeries]`.

### Tool definition copy

`prompt` in `definition.ts` gains one sentence:

> When the user wants a chart, dashboard, or any view that compares a metric across multiple months / quarters / years, use `getTimeSeries` (one round-trip) — not repeated `getReport` calls. Pair it with `presentChart` to render.

`description` and the existing `period` parameter docs stay as-is.

## Frontend work

### `src/plugins/accounting/api.ts`

Add a `getTimeSeries(args)` wrapper that mirrors the existing `getReport` helper. Returns `Promise<TimeSeriesResponse>`. Used by tests and any future in-canvas surface; the LLM tool path doesn't need it.

### Preview rendering

`src/plugins/accounting/Preview.vue` already renders compact JSON for non-`openBook` action results. `getTimeSeries` returns small JSON, so it works without changes — but a tiny tweak is worth it: render `points.length` and the first/last labels as a one-line summary so a chat transcript stays readable when the LLM didn't pipe the result into `presentChart`. This is polish, not blocking.

### No `<View>` changes

The full Accounting app keeps its current period-picker UI. `getTimeSeries` is for the LLM, not the in-canvas chart tabs (which read directly from `service.ts` via the existing endpoints).

## Sample-query update

`src/config/roles.ts` (the Accounting role's `queries: [...]` array, currently lines ~249-256) gets two cross-period queries that exercise `getTimeSeries`:

```ts
queries: [
  "List my books",
  "Create a new book",
  "Record today's coffee shop receipt — supplier: Starbucks Tokyo, total 660 yen including 60 yen consumption tax (T-number: T1234567890123)",
  "What's my net income this month?",
  "Show me the balance sheet at the end of last month",
  "Chart my quarterly revenue over the last two years",            // NEW — getTimeSeries(metric=revenue, granularity=quarter)
  "Show net income month-over-month for this fiscal year",        // NEW — getTimeSeries(metric=netIncome, granularity=month)
  "I posted yesterday's rent entry to the wrong account — fix it",
],
```

The two new queries are intentionally distinct in `metric` and `granularity` so the test surface covers both axes. If the array starts feeling long, drop "Show me the balance sheet at the end of last month" — the new month-over-month query subsumes the value of an at-a-point balance check for the role-pitch use case.

The role's `prompt` (the long instruction string above the `queries` array) gains one paragraph in the **Reports and narratives** section:

> For "compare X over time" / "chart this by month/quarter/year" requests, use `getTimeSeries` and pipe its `points` directly into `presentChart`. Do not fan out repeated `getReport` calls for each bucket — `getTimeSeries` is one round-trip and returns chart-ready data.

## Tests

### Unit (`test/accounting/`)

- **`test_timeSeries.ts`** (new):
  - **Bucket boundaries.** `bucketize` for each `granularity × fiscalYearEnd` combination — Q4 books bucket calendar quarters; Q1/Q2/Q3 shift accordingly. Year buckets honour the same shift. Month buckets ignore `fiscalYearEnd`.
  - **Empty buckets.** A range that includes a month with no entries returns `value: 0` for that month, not a missing point.
  - **Metric correctness.** With a fixture book that has a known monthly revenue / expense pattern, assert `revenue`, `expense`, `netIncome`, and `accountBalance` series match hand-computed values.
  - **`accountBalance` includes opening balances.** A book with opening balances and one entry has the right closing balance in every bucket — the cumulative path can't drop the opening row.
  - **Voided entries cancel.** A void pair posted in different buckets nets to zero in the metric across both buckets.
- **`test_service_timeSeries.ts`** (new): integration through `getTimeSeriesReport` — fixture book, hits real `readAllEntries`, asserts the envelope shape.
- **`test_routes_accounting.ts`** extends with `getTimeSeries` validation cases: missing fields, `accountCode` required-when-metric-is-accountBalance, granularity / metric enum guards.

### E2E

No Playwright addition. The action is pure data-flow; the existing `flow.spec.ts` doesn't need to grow. If we later wire `getTimeSeries` into `<View>`, that's when it earns an E2E.

### Manual testing checklist

Add one row to `docs/manual-testing.md` under the accounting section: "Click 'Chart my quarterly revenue over the last two years' from the Accounting role's sample queries; confirm a single `manageAccounting` tool call (one round-trip in the network panel) and a chart with at least one point per quarter."

## Migration / compatibility

- Existing `getReport` callers unaffected.
- `BUILT_IN_PLUGIN_METAS` / `API_ROUTES` / `TOOL_NAMES` aren't touched — the action lives inside the existing `manageAccounting` tool.
- No changes to on-disk format (journal, snapshots, config). `getTimeSeries` is read-only.

## Risks and open questions

- **Fiscal helper relocation (server/accounting/fiscalYear.ts).** Moving the helpers from `src/plugins/` to `server/` and re-exporting risks a circular-import pattern if not done carefully. Mitigation: the server module owns the logic, the plugin module re-exports for the View. Validate by running `yarn typecheck` after the move; revert to keeping a thin duplicate if a cycle appears (tracked in plan `decisions/` if it happens).
- **Year labels under non-Q4 fiscal years.** A JP book with `fiscalYearEnd === "Q1"` whose FY runs Apr 2025 → Mar 2026: do we label that bucket `FY2025` (start year) or `FY2026` (end year)? Pick one and document it. Recommendation: **end year** (matches Japanese convention "令和7年度" = April 2025–March 2026 = ends in 2026). Encode in `bucketize`; assert in unit tests.
- **Range straddling fiscal-year-end on `granularity: "year"`.** When `from` and `to` cross a fiscal-year close, the response has two `FY` buckets — clear and correct. When `from` is mid-fiscal-year and `to` is also mid-fiscal-year of the same FY, the response has one bucket whose `from`/`to` echo the fiscal-year boundaries (not the input range). Document this in the response field doc-string so the LLM doesn't try to "correct" the labels.
- **Performance for large books.** `accountBalance` with `granularity: "month"` over 5 years scans every entry per bucket — O(N × buckets). For the v1 user volume this is fine; if any book grows past ~10k entries we'll add the snapshot-cache fast-path mentioned in `getTimeSeriesReport`.

## Rollout

One PR. Land server + frontend wrapper + sample queries + tests together. After merge, the test-rollout users hit the new sample queries naturally; soak for a week before adding more metrics (e.g. `grossMargin`, `expenseByCategory`).
