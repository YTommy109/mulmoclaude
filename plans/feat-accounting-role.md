# Plan: Accounting role

Add a built-in **Accounting** role (alongside `general`, `office`, `guide`, `artist`, `tutor`, `storyteller`, `settings`) so users can flip into a bookkeeping-focused agent without first hand-rolling a custom role.

The role's job is to record journal entries correctly and surface them in clean UI forms — not to invent accounts, guess at supplier IDs, or post entries the user didn't sign off on.

## Scope (single PR)

- Define the role in `src/config/roles.ts`: id, name, icon, prompt, `availablePlugins`, starter `queries`.
- Wire its id into `BUILTIN_ROLE_IDS` so the constant map keeps the one-entry-per-role invariant the existing test pins.
- Update the accounting isolation regression test (`e2e/tests/accounting-isolation.spec.ts`) — the third test currently asserts the literal `manageAccounting` is absent from the built-in roles page, which becomes false the moment the Accounting role ships. Narrow the assertion to "the **default (General)** role doesn't list `manageAccounting`" while keeping the launcher / route / default-role isolation assertions intact.

Not in scope (deferred to other plans):

- Country-of-residence on book open (`feat-accounting-country` — separate idea).
- T-number column in the Ledger (`feat-accounting-ledger-tax-id` — separate idea).
- Server-side refusal of input-tax entries without `taxRegistrationId` (relies on country field; defer).

## Role definition

```ts
{
  id: "accounting",
  name: "Accounting",
  icon: "account_balance",   // matches the AccountingApp header icon
  prompt: <see "System prompt" below>,
  availablePlugins: [
    TOOL_NAMES.manageAccounting,
    TOOL_NAMES.presentForm,
    TOOL_NAMES.presentDocument,
  ],
  queries: [<see "Starter queries" below>],
}
```

### Why these three plugins (and not more)

- **`manageAccounting`** — the entire reason the role exists. Gives the agent `openBook`, `addEntry`, `voidEntry`, `setOpeningBalances`, `getReport`, `upsertAccount`, etc.
- **`presentForm`** — every user-facing prompt the agent emits goes through a form (date, memo, lines, T-number, supplier name). Free-text Q&A round-trips for journal entries are too easy to mistype, hard to edit, and impossible to validate before the agent commits to `addEntry`. The system prompt enforces "form, not chat" for all data collection.
- **`presentDocument`** — for narrative outputs the user wants on-screen (a P&L summary, a month-end note, an explanation of an entry). The agent can also use it to render the result of `getReport` with annotations.

Other plugins are intentionally absent. No `presentChart` (agent can describe but the report tabs already chart), no `generateImage` (off-topic), no `manageTodoList` / `manageCalendar` (separate concerns; the user can switch roles for those).

### Bookkeeping isolation guard (still holds)

The original accounting plan-doc made "no built-in role exposes `manageAccounting`" a hard constraint. Adding the Accounting role narrows that to **"the default (General) role doesn't expose it"** — the user must actively switch to the Accounting role to see the plugin. This matches the existing pattern for Office (presentations), Guide (planning), Tutor, etc.: each is opt-in via the role picker, not surfaced everywhere.

## System prompt

The prompt teaches the agent the four things a brand-new bookkeeping agent gets wrong without explicit guidance:

1. **Double-entry mechanics** — every entry has Σ debit = Σ credit; debit ≠ "money in," credit ≠ "money out" (sign convention is per account type); never post without confirming the lines balance.
2. **Append-only contract** — there is no `editEntry`. Corrections are `voidEntry` of the original followed by a fresh `addEntry`. Don't suggest "let me fix that for you" without naming the void-and-repost flow.
3. **Tax-registration ID for input-tax lines** — when the user is recording a purchase that includes consumption / sales / VAT tax (any line touching `1310 Sales Tax Receivable` or the equivalent), ask for the supplier's tax-registration ID and populate `JournalLine.taxRegistrationId`. In Japan this is the 適格請求書発行事業者登録番号 (T-number); under the インボイス制度 (effective 2023-10-01) input-tax credit is forfeit without it. In the EU it's the VAT identification number; in India GSTIN; Australia ABN. The agent doesn't need to know which jurisdiction the book belongs to (that's coming via the country idea) — it asks every time on input-tax lines and treats the field as required for those lines and optional everywhere else.
4. **Forms over chat** — every data-collection prompt (date, memo, account picks, amounts, T-numbers, void confirmations, opening balances) is a `presentForm` call, not a chat question. Pre-post confirmation of a journal entry is also a form: render the proposed entry as a structured form, accept the user's edits, then call `addEntry`. This is non-negotiable; the prompt names it as a hard rule.

Draft (will iterate during implementation; ~600 chars to start, expanding to ~2 KB):

> You are an Accounting assistant. You help the user keep a clean, audit-ready set of books in the workspace's accounting plugin (`manageAccounting`).
>
> ## Hard rules
>
> - **Forms, not chat.** Every time you need information from the user — booking date, memo, account pick, amounts, supplier name, T-number, void reason, opening balances — call `presentForm`. Never ask the user to type a journal entry, an account code, or a tax-registration ID as free text. Group related fields into one form. Mark every field the user must answer as `required: true`.
> - **Confirm before posting.** Before calling `addEntry` or `voidEntry`, render the proposed entry as a `presentForm` with one field per line (account, debit, credit, taxRegistrationId, memo) plus the entry-level date and memo. The user reviews, edits in place, and submits. Only then call the action. Skip this only when the user has explicitly said "post it as-is" in the same turn.
> - **Append-only.** There is no `editEntry`. To correct an entry, call `voidEntry` on the original and post a fresh `addEntry` for the right values. Don't say "let me fix entry X" without naming the void-and-repost flow.
>
> ## Bookkeeping mechanics
>
> Every entry's lines must satisfy Σ debit = Σ credit. Debit ≠ "money in" — sign convention is per account type. Use `getAccounts` to look up codes; never invent a code that isn't in the chart. The chart of accounts uses 4-digit codes whose leading digit is the account type (1xxx asset, 2xxx liability, 3xxx equity, 4xxx income, 5xxx expense). Use `upsertAccount` if the user wants a new account.
>
> ## Tax-registration ID (T-number / VAT ID / GSTIN / ABN)
>
> When the user is recording a purchase that includes consumption / sales / VAT tax — any line that touches `1310 Sales Tax Receivable` or the equivalent suspense account — you MUST ask for the supplier's tax-registration ID and populate `JournalLine.taxRegistrationId` on that line.
>
> - In Japan this is the 適格請求書発行事業者登録番号 (T-number, format `T` + 13 digits). Under the インボイス制度 (effective 2023-10-01), input-tax credit is forfeit without it.
> - In the EU it's the VAT identification number; in the UK the VAT registration number; in India GSTIN; in Australia ABN.
> - Ask via a `presentForm` field labelled "Supplier's tax-registration ID" with a placeholder showing a plausible format. If the user can't provide it, ask whether to post the entry without input-tax credit (book the gross amount to the expense / asset, not split through 1310) — don't silently leave the field blank.
>
> ## Reports and narratives
>
> Use `getReport` for balance sheet / P&L / ledger queries. For longer narratives the user wants in the canvas (month-end summary, explanation of an entry's impact), use `presentDocument`. The accounting view itself is mounted via `openBook`; reach for that when the user wants to browse rather than ask a specific question.

Wording will tighten during implementation. Length budget: keep under 2 KB so it doesn't dominate the system message.

## Starter queries

Keep these short and characteristic — they appear on the role's empty-state cards:

- `Open my books`
- `Record today's coffee shop receipt — supplier: Starbucks Tokyo, total 660 yen including 60 yen consumption tax (T-number: T1234567890123)`
- `What's my net income this month?`
- `Show me the balance sheet at end of last month`
- `I posted yesterday's rent entry to the wrong account — fix it`

## Tests

- `test/roles/test_builtin_role_ids.ts` — already iterates `ROLES` and `BUILTIN_ROLE_IDS`; passes automatically once both gain the `accounting` entry.
- `test/roles/test_role_schema.ts` — `BUILTIN_ROLES.forEach(RoleSchema.parse)` covers shape validation.
- New test (`test/roles/test_accounting_role.ts` or extend `test_role_schema.ts`): assert the Accounting role's `availablePlugins` is exactly `[manageAccounting, presentForm, presentDocument]` — guards against future drift where someone adds a tool to the role without revisiting the scoping decision.
- Update `e2e/tests/accounting-isolation.spec.ts` third test: change "default Role config does not list manageAccounting in available tools" → "the **General** (default) role's plugin list does not contain `manageAccounting`" by asserting the absence within the General role's specific row / panel rather than the whole `/roles` page. The Accounting role row is allowed to mention it (in fact must).

## Docs

- `docs/manual-testing.md` — accounting section: replace "create a custom Role with `manageAccounting` in `availablePlugins`" with "switch to the Accounting role from the role picker" as the primary path; the custom-role path stays as a secondary callout.
- `docs/ui-cheatsheet.md` — the `<AccountingApp>` block's "Default Role cannot reach this surface" callout needs softening to "The General role cannot reach this surface; the Accounting role and any custom role with `manageAccounting` can."

## Out of scope (still)

- Country-of-residence prompt on book open — separate plan (`feat-accounting-country`).
- Country-aware system-prompt branches (e.g. tighter T-number enforcement when `country=JP`) — depends on country plan.
- T-number column in the ledger — separate plan (`feat-accounting-ledger-tax-id`).
- Server-side enforcement of T-number presence on input-tax lines — defer until soft-prompt enforcement has been observed in practice.

## Rollout checklist

- [ ] `accounting` role added to `ROLES` in `src/config/roles.ts`
- [ ] `BUILTIN_ROLE_IDS.accounting = "accounting"` added
- [ ] `availablePlugins` is exactly `[manageAccounting, presentForm, presentDocument]`
- [ ] System prompt covers: forms-not-chat, append-only, double-entry, T-number-on-input-tax, JP インボイス制度 callout
- [ ] At least 3 starter queries
- [ ] `test/roles/test_builtin_role_ids.ts` passes (no edits expected — invariants hold)
- [ ] `test/roles/test_role_schema.ts` passes (Accounting role schema-valid)
- [ ] New test pinning the Accounting role's exact `availablePlugins` set
- [ ] `e2e/tests/accounting-isolation.spec.ts` third test updated to scope absence to the General role
- [ ] `docs/manual-testing.md` accounting section: Accounting role is the recommended entry point
- [ ] `docs/ui-cheatsheet.md` `<AccountingApp>` callout: General role can't reach it; Accounting role can
