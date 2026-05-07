# Accounting plugin: tax-registration warning + pub/sub-only sync

## Goal

Two narrowly-scoped changes carved out of the (now-closed) `refactor-accounting-simplify` branch:

1. **Amber-warn a missing tax-registration ID on a postable 14xx/24xx line.** PR review on the prior tax-registration-id work flagged that the form silently strips an empty `taxRegistrationId` on a tax-related line, contradicting the role prompt's "don't silently leave the field blank" rule. Fix the contradiction with a *visual* nudge (amber border + ring) — keep the submit button enabled because some jurisdictions don't have a registration scheme and some suppliers won't have one. Country-specific behaviour is data, not prose, so it lives in a small per-country requirement table.
2. **Trust pub/sub as the single sync signal.** The `View` currently maintains `bookVersion = pubsubVersion + localVersion`, where children bump `localVersion` after every successful write — but the same write triggers a server-side `publishBookChange(...)` that the client receives over SSE within milliseconds. Two bumps per user action; race-handling state exists *because of* the dual-tracking. Collapse to the single signal.

These two are unrelated in subsystem but both small, both reviewed, both safe to land together. Splitting into separate commits keeps either revertable independently.

## Non-goals

- No change to the journal-as-source-of-truth invariant.
- No change to the snapshot cache (no queue removal, no concurrency mutex). The lazy `getOrBuildSnapshot` chain stays exactly as it is on `main`.
- No change to LLM-facing tool descriptions or the role prompt — the existing country-by-country prose stays the source of truth for the agent; the new requirement table is for the UI only.
- No change to the action surface, server routes, or pub/sub channel kinds.
- The `BookSwitcher` `book-created` optimistic insert + `pendingTargetBookId` flow stays untouched. Same for `deletedNoticeName`. Removing the dual-version signal is the smallest reversible step.

## Change #1 — amber-warn missing tax-registration ID

### Why

The role prompt (`src/config/roles.ts`, "Country-aware tax behaviour") tells the agent "don't silently leave the field blank" when posting against a 14xx/24xx account in a jurisdiction with a registration scheme. The `JournalEntryForm` form lets exactly that happen:

- `isTaxRegistrationIdInvalid(line)` only flags **too-long** values (length > `MAX_TAX_REGISTRATION_ID_LENGTH`), not empty ones — empty passes `balanced`.
- `toApiLines()` strips an empty `taxRegistrationId` silently:

  ```ts
  if (isTaxLine(line)) {
    const trimmedTaxId = line.taxRegistrationId.trim();
    if (trimmedTaxId !== "") apiLine.taxRegistrationId = trimmedTaxId;
  }
  ```
  → the entry posts cleanly with no error and no T-number.

Warn rather than block: any blank `taxRegistrationId` on a postable tax line gets an amber border + ring (distinct from the red length-error treatment), but submit stays enabled. The user can still post if they truly have nothing to enter — they're just warned that they're hitting the silent-strip path.

### Files touched

#### `src/plugins/accounting/countries.ts`

Add a per-country requirement table next to `SUPPORTED_COUNTRY_CODES` / `EU_COUNTRY_CODES`:

```ts
export type TaxRegistrationRequirement = "required" | "recommended" | "none";

export const TAX_REGISTRATION_REQUIREMENT: Record<SupportedCountryCode, TaxRegistrationRequirement> = {
  // Explicitly required by the role prompt.
  JP: "required",
  GB: "required",
  DE: "required", FR: "required", IT: "required", ES: "required", NL: "required",
  BE: "required", AT: "required", IE: "required", PT: "required", FI: "required",
  SE: "required", DK: "required", PL: "required",
  IN: "required", AU: "required", NZ: "required", CA: "required",
  // Explicitly excluded — US has no federal sales-tax registration.
  US: "none",
  // "Other countries" bucket — prompt asks for the equivalent local
  // registration number but doesn't make it a hard rule.
  CH: "recommended", NO: "recommended", CN: "recommended", KR: "recommended",
  TW: "recommended", HK: "recommended", SG: "recommended", BR: "recommended",
  MX: "recommended",
};

export function taxRegistrationRequirement(country: SupportedCountryCode | undefined): TaxRegistrationRequirement {
  if (!country) return "recommended";  // unset → still nudge; user picked a tax account so something tax-related is happening
  return TAX_REGISTRATION_REQUIREMENT[country];
}
```

Flat map (not derived from `EU_COUNTRY_CODES`) because `SUPPORTED_COUNTRY_CODES` ⊊ `EU_COUNTRY_CODES`. Two sources of truth are fine — the table only needs entries for `SupportedCountryCode`. Comment block flags that this mirrors the role prompt and they must stay in sync; drift means the LLM and the form give contradictory advice.

#### `src/plugins/accounting/View.vue`

One-line change: the View already computes `activeCountry` (line ~198, used by `<BookSettings>`). Pass it through to `<JournalEntryForm>` as `:country="activeCountry"`.

#### `src/plugins/accounting/components/JournalEntryForm.vue`

- Import `taxRegistrationRequirement` and `SupportedCountryCode` from `../countries`.
- Add `country?: SupportedCountryCode` to `defineProps`.
- Add a new predicate alongside `isTaxRegistrationIdInvalid`:

  ```ts
  function isTaxRegistrationIdMissing(line: FormLine): boolean {
    if (!isTaxLine(line)) return false;
    if (!isPostable(line)) return false;        // only nudge when the line will actually post
    if (taxRegistrationRequirement(props.country) === "none") return false;  // US opt-out
    return line.taxRegistrationId.trim() === "";
  }
  ```

  `isPostable` (account picked + positive amount + account still selectable) avoids flashing amber the moment the user picks the account but before they've typed an amount. `function` declarations hoist, so calling `isPostable` from inside `isTaxRegistrationIdMissing` is fine even though the former appears later in the file.

- Update the `<input>` class binding to a 3-way: red (length error) → amber (missing) → gray default. Add `focus:outline-none` to the base classes and `focus:ring-1 focus:ring-blue-500` to the default branch — without `focus:outline-none` the browser's native focus outline draws on top of the amber/red ring, hiding it. Matches the existing pattern at `AccountEditor.vue:68-69`:

  ```vue
  :class="[
    'h-8 px-2 w-full rounded border text-sm font-mono focus:outline-none',
    isTaxRegistrationIdInvalid(line)
      ? 'border-red-500 ring-1 ring-red-500'
      : isTaxRegistrationIdMissing(line)
        ? 'border-amber-500 ring-1 ring-amber-500'
        : 'border-gray-300 focus:ring-1 focus:ring-blue-500',
  ]"
  ```

- **Do NOT touch `balanced`** — submit stays enabled in the missing case. `balanced` keeps gating only on length-error.
- **Do NOT touch `toApiLines()`** — the silent-strip is intentional fallback for the "user truly has no number" case. The amber border is the contract: "we warned you; if you still post, we strip."

### Risk

- **Amber flashes prematurely.** The `isPostable(line)` guard means the warning only fires once the user has typed an amount, which feels right — a freshly-picked tax account doesn't immediately scold the user.
- **i18n.** No new strings; the warning is purely visual. Zero churn across the 8 locale files.
- **a11y.** The amber border alone is a colour-only signal. The role prompt is the load-bearing instruction for the LLM; for direct human form use, the empty field is still empty (visible). If a future review wants stronger a11y, add an `aria-describedby` warning text — out of scope here.
- **Country drift.** If the role prompt grows a new country before the table does (or vice versa), the LLM and the form disagree. The mirroring is comment-flagged; a follow-up could DRY them, but the prompt is hand-tuned prose and the table is structured data — different consumers, fine to keep both for now.

## Change #2 — trust pub/sub as the only sync signal

### Why

Every mutating service function calls `publishBookChange(...)` after writing. The same client that posted the mutation receives the event back over SSE within milliseconds. Maintaining a separate `localVersion` that children bump after a successful POST means every `watch(version, refetch)` in the table/report components re-fires twice per user action.

The dual-tracking also seeds parts of the `pendingTargetBookId` race-handling and the `deletedNoticeName` flow. Killing the dual signal removes a subtle source of race-window bugs in the smallest reversible step.

### Files touched

#### `src/plugins/accounting/View.vue`

- Remove `localVersion = ref(0)`, `bumpLocalVersion()`, and the `bookVersion` computed.
- Replace every `:version="bookVersion"` prop with `:version="pubsubVersion"` (rename the destructured `version` from `useAccountingChannel` if helpful for readability).
- Drop `@changed="bumpLocalVersion"` from `<JournalList>`.
- Drop `@accounts-changed="bumpLocalVersion"` from `<JournalEntryForm>` and `<OpeningBalancesForm>`.
- Keep `@submitted="onEntrySubmitted"` — `onEntrySubmitted` still needs to switch tabs (UX, not data sync). After the trim it must do **two** things: (1) clear `entryBeingEdited.value = null` so the next visit to "New entry" starts blank instead of re-prefilling the just-replaced entry; (2) switch to the journal tab. Drop only the `bumpLocalVersion()` call — preserve the rest.
- Update the multi-paragraph comment around `bookVersion` to a one-line note (or delete it; the simpler code is self-explanatory).
- **Preserve the edit-flow plumbing in full**: `entryBeingEdited` ref, `onEditEntry` / `onCancelEdit` handlers, the `watch(activeBookId, …)` that clears the edit on book switch, and the `@edit-entry` / `:entry-to-edit` / `@cancel-edit` template wiring. These carry user intent (which entry the user wants to edit) — orthogonal to the data-sync signal we're collapsing.

#### Children — drop now-unused emits

- `JournalList.vue`: drop `changed` from `defineEmits`; drop `emit("changed")` from `onVoid`. Keep `editEntry` and `editOpening` — both carry user intent that pub/sub can't replicate.
- `JournalEntryForm.vue`: drop `accountsChanged` from `defineEmits`; drop the inner `@changed="emit('accountsChanged')"` on `<AccountsModal>`. Keep `submitted` and `cancelEdit`.
- `OpeningBalancesForm.vue`: drop `accountsChanged` from `defineEmits`; drop the inner `@changed="emit('accountsChanged')"` on `<AccountsModal>`. Keep `submitted`.
- `AccountsModal.vue`: keep `emit("changed")` — the modal uses it internally to refresh its own accounts list after an upsert (independent of the parent wiring being removed).

#### What stays

- `useAccountingBooksChannel(refetchBooks)` already drives book-list refetches via pub/sub. Keep.
- The `BookSwitcher` `book-created` event flow (optimistic insert) is more nuanced — it exists to prevent the dropdown from "sticking on the old selection" while the books refetch lands. **Out of scope.**
- Same for `deletedNoticeName` — keep as-is.

### Risk

- **Perceived latency on form submit.** Currently: form posts, server publishes, *and* child emits `changed` → table refetches before SSE arrives. After: table refetches when SSE arrives (~10–50ms on localhost, ~100ms on real network). For a single-user local app this is imperceptible.
- **SSE drop.** If pub/sub delivery drops a message (server crash mid-publish, websocket reconnect window), the table won't refetch. Currently the `localVersion` masked this by re-fetching anyway. Mitigation: every component already re-fetches on mount and on `bookId` change, and the user can manually click a refresh button on every report tab. Acceptable for v1; if it becomes a real issue, add a "stale > Ns → refetch" heuristic.
- **No multi-tab regression.** Pub/sub events fan out to every connected tab equally, so cross-tab sync (which the local-version bump never participated in) is unaffected.
- **Edit-entry double-fire.** The merged "edit" flow posts `voidEntry` then `addEntry` sequentially, each publishing a `journal` pub/sub event. With `localVersion` removed, subscribers refetch twice in quick succession instead of once. Still correct, still cheap (~ms-scale fetches), but worth noting — a future debounce/coalesce in the subscriber composable could collapse them if it ever matters.
- **Pub/sub vs UX state — preserved boundary.** The cleanup only removes the *data-sync* duplicate. Tab switches, edit-mode resets, and other UX state changes stay tied to local Vue parent-child emits (`@submitted`, `@cancelEdit`, `@editEntry`, `@editOpening`) and never to pub/sub — a pub/sub event that came from another tab / window / LLM tool call must NEVER hijack the active tab's UI state.

## Sequencing

Three commits on a fresh branch (e.g. `feat/accounting-tax-warning-and-pubsub`):

1. **Plan commit** — this document.
2. **`feat(accounting): amber-warn missing tax-registration ID on postable tax line`** — `countries.ts` table, View prop wiring, JournalEntryForm predicate + class binding + focus fix.
3. **`refactor(accounting): drop View localVersion, trust pub/sub`** — frontend-only simplification.

Splitting #2 and #3 lets either be reverted independently if a regression surfaces.

## Acceptance criteria

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test` all green.
- `View.vue` no longer maintains `localVersion`; sub-components no longer emit `changed` / `accountsChanged` to the View.
- Picking 1400/2400 + amount, leaving the T-number blank, on a JP / EU / GB / IN / AU / NZ / CA book → input has amber border + ring. On a US book → no warning.
- Focusing the amber-bordered input keeps the amber visible (no browser outline overlay).
- Manual smoke test: `npm run dev`, create a book, set opening balances, post an entry, edit it, void it. Each action lands in the journal/B-S/P-L within ~100ms via pub/sub. (Recorded in PR description; not automated here.)

## Out of scope (follow-ups)

- DRY the country-tax knowledge between `roles.ts` (LLM prompt prose) and `countries.ts` (UI table) — different consumers, fine to keep both for now.
- Per-country placeholder format for the T-number input (`T1234567890123` for JP, `GB123456789` for GB, `15-char GSTIN` for IN, etc.). Easy follow-up once the requirement table is in.
- Re-evaluate the optimistic `onBookCreated` insert + `pendingTargetBookId` flow once pub/sub-only has been live for a few sessions.
- Snapshot cache concurrency hardening (the lazy-only race the github-actions bot flagged on the closed PR). Separate concern, separate PR.
