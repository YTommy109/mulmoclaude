<template>
  <div class="flex flex-col gap-3">
    <!-- Top-row toolbar slot. Renders the embedded entry form
         in-place when the user opens "New entry" or clicks Edit
         on a journal row; otherwise just the "+ New entry"
         button. The date picker / account filter / table below
         stay visible in either state. -->
    <div v-if="showForm" class="border border-gray-200 rounded p-3" data-testid="accounting-journal-inline-form">
      <JournalEntryForm
        :book-id="bookId"
        :accounts="accounts"
        :currency="currency"
        :country="country"
        :entry-to-edit="entryBeingEdited"
        @submitted="onFormSubmitted"
        @cancel="onFormCancel"
      />
    </div>
    <div v-else class="flex items-center justify-end">
      <button
        type="button"
        class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
        data-testid="accounting-journal-new-entry"
        @click="onOpenNewEntry"
      >
        <span class="material-icons text-base">add</span>
        <span>{{ t("pluginAccounting.tabs.newEntry") }}</span>
      </button>
    </div>
    <div class="flex flex-wrap items-end gap-2">
      <DateRangePicker v-model="range" :fiscal-year-end="resolvedFiscalYearEnd" :opening-date="openingDate" />
      <label class="text-xs text-gray-500 flex flex-col gap-1">
        {{ t("pluginAccounting.journalList.accountLabel") }}
        <select v-model="accountCode" class="h-8 px-2 rounded border border-gray-300 text-sm bg-white" data-testid="accounting-journal-account">
          <option value="">{{ t("pluginAccounting.journalList.allAccounts") }}</option>
          <option v-for="account in accounts" :key="account.code" :value="account.code">{{ formatAccountLabel(account) }}</option>
        </select>
      </label>
      <button class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50" @click="refresh">
        <span class="material-icons text-base align-middle">refresh</span>
      </button>
    </div>
    <p v-if="loading" class="text-xs text-gray-400">{{ t("pluginAccounting.common.loading") }}</p>
    <p v-else-if="error" class="text-xs text-red-500">{{ t("pluginAccounting.common.error", { error }) }}</p>
    <p v-else-if="filteredEntries.length === 0" class="text-xs text-gray-400">{{ t("pluginAccounting.common.empty") }}</p>
    <table v-else class="w-full text-sm" data-testid="accounting-journal-table">
      <thead>
        <tr class="text-xs text-gray-500 border-b border-gray-200">
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.date") }}</th>
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.kind") }}</th>
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.memo") }}</th>
          <th class="text-left py-1 px-2">{{ t("pluginAccounting.journalList.columns.lines") }}</th>
          <th class="py-1 px-2"></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="entry in filteredEntries" :key="entry.id">
          <tr
            :class="[
              voidedEntryIds.has(entry.id) ? 'text-gray-400 line-through' : '',
              'border-b border-gray-100 align-top cursor-pointer hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
            ]"
            :data-testid="voidedEntryIds.has(entry.id) ? `accounting-journal-row-voided-${entry.id}` : `accounting-journal-row-${entry.id}`"
            tabindex="0"
            role="button"
            :aria-expanded="expandedEntryId === entry.id"
            @click="toggleExpanded(entry.id)"
            @keydown.enter.prevent.self="onKeyToggle($event, entry.id)"
            @keydown.space.prevent.self="onKeyToggle($event, entry.id)"
          >
            <td class="py-1 px-2 whitespace-nowrap">{{ entry.date }}</td>
            <td class="py-1 px-2 text-xs">{{ kindLabel(entry.kind) }}</td>
            <td class="py-1 px-2">
              <span v-if="entry.memo">{{ entry.memo }}</span>
            </td>
            <td class="py-1 px-2">
              <div v-for="(line, idx) in entry.lines" :key="idx" class="text-xs flex gap-2 items-baseline">
                <span class="font-mono text-[10px] text-gray-400">{{ line.accountCode }}</span>
                <span v-if="accountNameFor(line.accountCode)">{{ accountNameFor(line.accountCode) }}</span>
                <span v-if="line.debit">{{ formatDebit(line.debit) }}</span>
                <span v-if="line.credit">{{ formatCredit(line.credit) }}</span>
              </div>
            </td>
            <!-- Stop the toggle from firing when the user reaches for
                 Edit / Void — those rails already handle their own
                 navigation / confirm dialog and shouldn't double as a
                 detail-expand trigger. -->
            <td class="py-1 px-2 text-right whitespace-nowrap" @click.stop>
              <template v-if="entry.kind === 'normal' && !voidedEntryIds.has(entry.id)">
                <button class="text-xs text-blue-600 hover:underline mr-2" :data-testid="`accounting-edit-${entry.id}`" @click="onEditEntry(entry)">
                  {{ t("pluginAccounting.journalList.edit") }}
                </button>
                <button class="text-xs text-red-500 hover:underline" :data-testid="`accounting-void-${entry.id}`" @click="onVoid(entry)">
                  {{ t("pluginAccounting.journalList.void") }}
                </button>
              </template>
              <button
                v-else-if="entry.kind === 'opening' && !voidedEntryIds.has(entry.id)"
                class="text-xs text-blue-600 hover:underline"
                :data-testid="`accounting-edit-opening-${entry.id}`"
                @click="emit('editOpening')"
              >
                {{ t("pluginAccounting.journalList.edit") }}
              </button>
            </td>
          </tr>
          <tr v-if="expandedEntryId === entry.id" class="bg-gray-50" :data-testid="`accounting-journal-detail-${entry.id}`">
            <td :colspan="5" class="px-6 py-2 relative">
              <button
                type="button"
                class="absolute top-1 right-2 h-8 w-8 flex items-center justify-center rounded text-gray-500 hover:bg-gray-100"
                :data-testid="`accounting-journal-detail-close-${entry.id}`"
                :aria-label="t('pluginAccounting.common.cancel')"
                @click="expandedEntryId = null"
              >
                <span class="material-icons text-base">close</span>
              </button>
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-gray-500 border-b border-gray-200">
                    <th class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.accountLabel") }}</th>
                    <th class="text-right py-1 px-2">{{ t("pluginAccounting.entryForm.debitLabel") }}</th>
                    <th class="text-right py-1 px-2">{{ t("pluginAccounting.entryForm.creditLabel") }}</th>
                    <th class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.memoLabel") }}</th>
                    <th v-if="entryHasTaxIds(entry)" class="text-left py-1 px-2">{{ t("pluginAccounting.entryForm.taxRegistrationIdLabel") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(line, idx) in entry.lines" :key="idx" class="border-b border-gray-100 text-gray-700">
                    <td class="py-1 px-2">
                      <span class="font-mono text-[10px] text-gray-400 mr-2">{{ line.accountCode }}</span>
                      <span v-if="accountNameFor(line.accountCode)">{{ accountNameFor(line.accountCode) }}</span>
                    </td>
                    <td class="py-1 px-2 text-right font-mono">{{ line.debit ? formatAmount(line.debit, currency) : "" }}</td>
                    <td class="py-1 px-2 text-right font-mono">{{ line.credit ? formatAmount(line.credit, currency) : "" }}</td>
                    <td class="py-1 px-2">{{ line.memo ?? "" }}</td>
                    <td v-if="entryHasTaxIds(entry)" class="py-1 px-2 font-mono text-[10px]">{{ line.taxRegistrationId ?? "" }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="font-semibold border-t border-gray-300 text-gray-700">
                    <td class="py-1 px-2 text-gray-500">{{ t("pluginAccounting.balanceSheet.total") }}</td>
                    <td class="py-1 px-2 text-right font-mono">{{ formatAmount(entryDebitTotal(entry), currency) }}</td>
                    <td class="py-1 px-2 text-right font-mono">{{ formatAmount(entryCreditTotal(entry), currency) }}</td>
                    <td :colspan="entryHasTaxIds(entry) ? 2 : 1"></td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getJournalEntries, voidEntry, type Account, type JournalEntry, type JournalEntryKind, type JournalLine } from "../api";
import { formatAmount } from "../currencies";
import { currentFiscalYearRange, resolveFiscalYearEnd, type DateRange, type FiscalYearEnd } from "../fiscalYear";
import type { SupportedCountryCode } from "../countries";
import { useLatestRequest } from "./useLatestRequest";
import DateRangePicker from "./DateRangePicker.vue";
import JournalEntryForm from "./JournalEntryForm.vue";

const { t } = useI18n();

const props = defineProps<{
  bookId: string;
  accounts: Account[];
  currency: string;
  country?: SupportedCountryCode;
  version: number;
  fiscalYearEnd?: FiscalYearEnd;
  /** Opening-balance date for the active book — drives the "Lifetime"
   *  shortcut in the date picker (from = openingDate, to = today).
   *  When absent, the picker hides Lifetime; "All" still works. */
  openingDate?: string;
}>();
const emit = defineEmits<{ editOpening: [] }>();

// Inline-form state. The form replaces the toolbar slot when either
// rail is active:
//   • showNewForm = true → blank draft (the "+ New entry" button).
//   • entryBeingEdited != null → edit mode, prefilled from the row.
// Both flow through the same <JournalEntryForm>; the form looks at
// `entryToEdit` to decide its title / submit label.
const showNewForm = ref(false);
const entryBeingEdited = ref<JournalEntry | null>(null);
const showForm = computed<boolean>(() => showNewForm.value || entryBeingEdited.value !== null);

function onOpenNewEntry(): void {
  entryBeingEdited.value = null;
  showNewForm.value = true;
}

function onEditEntry(entry: JournalEntry): void {
  showNewForm.value = false;
  entryBeingEdited.value = entry;
}

function closeForm(): void {
  showNewForm.value = false;
  entryBeingEdited.value = null;
}

function onFormSubmitted(): void {
  // Submit posts via the form. In production the server-side
  // publishBookChange round-trips an SSE event that bumps
  // `bookVersion` and re-runs `refresh` via the watcher below.
  // We also kick a synchronous refetch here so the freshly-posted
  // row shows up immediately — the SSE round-trip can race the
  // tab repaint, and skipping it here also makes the e2e mock
  // path (no pubsub replay) deterministic.
  closeForm();
  void refresh();
}

function onFormCancel(): void {
  closeForm();
}

// Switching books mid-edit would carry the prior book's draft into
// the new book. Force the panel closed so the next visit starts
// from a blank toolbar — the form's own bookId watcher would also
// reset its internal state, but we want the user back in the
// neutral "+ New entry" surface.
watch(
  () => props.bookId,
  () => {
    closeForm();
    expandedEntryId.value = null;
  },
);

const resolvedFiscalYearEnd = computed<FiscalYearEnd>(() => resolveFiscalYearEnd(props.fiscalYearEnd));

// Default = current fiscal year. Reset by the bookId/fiscalYearEnd
// watcher so switching books or changing the FY-end in settings
// drops a stale custom range from the prior book.
const range = ref<DateRange>(currentFiscalYearRange(resolvedFiscalYearEnd.value));
const accountCode = ref("");
const entries = ref<JournalEntry[]>([]);
const serverVoidedIds = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const { begin: beginRequest, isCurrent } = useLatestRequest();

function kindLabel(kind: JournalEntryKind): string {
  if (kind === "opening") return t("pluginAccounting.journalList.kind.opening");
  if (kind === "void") return t("pluginAccounting.journalList.kind.void");
  if (kind === "void-marker") return t("pluginAccounting.journalList.kind.voidMarker");
  return t("pluginAccounting.journalList.kind.normal");
}

function formatDebit(value: number): string {
  return `DR ${formatAmount(value, props.currency)}`;
}
function formatCredit(value: number): string {
  return `CR ${formatAmount(value, props.currency)}`;
}
function formatAccountLabel(account: Account): string {
  // Name first so type-to-search in the <select> matches the
  // human-meaningful word; the code goes in trailing parens.
  // Same convention used by JournalEntryForm and Ledger pickers.
  return `${account.name} (${account.code})`;
}
const accountNameByCode = computed(() => {
  const map = new Map<string, string>();
  for (const account of props.accounts) map.set(account.code, account.name);
  return map;
});
function accountNameFor(code: string): string | null {
  return accountNameByCode.value.get(code) ?? null;
}

// Single-selection detail expansion. Clicking a row swaps the
// selection (or collapses if it's already the selected row).
// Cleared on book switch via the closeForm watcher; entries deleted
// between fetches simply drop out of filteredEntries, so a stale id
// here just renders no detail row.
const expandedEntryId = ref<string | null>(null);

function toggleExpanded(entryId: string): void {
  expandedEntryId.value = expandedEntryId.value === entryId ? null : entryId;
}

function onKeyToggle(event: KeyboardEvent, entryId: string): void {
  if (event.repeat) return;
  toggleExpanded(entryId);
}

function entryHasTaxIds(entry: JournalEntry): boolean {
  return entry.lines.some((line) => Boolean(line.taxRegistrationId));
}

function sumLines(lines: JournalLine[], pick: (line: JournalLine) => number | undefined): number {
  return lines.reduce((acc, line) => acc + (pick(line) ?? 0), 0);
}

function entryDebitTotal(entry: JournalEntry): number {
  return sumLines(entry.lines, (line) => line.debit);
}

function entryCreditTotal(entry: JournalEntry): number {
  return sumLines(entry.lines, (line) => line.credit);
}

async function refresh(): Promise<void> {
  const token = beginRequest();
  loading.value = true;
  error.value = null;
  try {
    const result = await getJournalEntries({
      bookId: props.bookId,
      from: range.value.from || undefined,
      to: range.value.to || undefined,
      accountCode: accountCode.value || undefined,
    });
    if (!isCurrent(token)) return;
    if (!result.ok) {
      error.value = result.error;
      entries.value = [];
      serverVoidedIds.value = [];
      return;
    }
    entries.value = result.data.entries;
    serverVoidedIds.value = result.data.voidedEntryIds;
  } finally {
    if (isCurrent(token)) loading.value = false;
  }
}

const filteredEntries = computed(() => entries.value);

// Set of original entry ids that have been voided. The server
// computes this from the *unfiltered* journal (so an account-filtered
// query — which drops void-marker rows because they have no lines —
// still strikes out the cancelled original). Source of truth on the
// server is `voidedIdSet()` in journal.ts.
const voidedEntryIds = computed(() => new Set(serverVoidedIds.value));

async function onVoid(entry: JournalEntry): Promise<void> {
  // Single dialog: the prompt is the confirmation. Cancelling
  // (returning null) cancels the void; entering empty text or a
  // reason proceeds.
  const reason = window.prompt(t("pluginAccounting.journalList.voidReason"));
  if (reason === null) return;
  try {
    const result = await voidEntry({ entryId: entry.id, reason: reason || undefined, bookId: props.bookId });
    if (!result.ok) error.value = result.error;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

// Reset to current-year window whenever the active book or its
// fiscal-year end changes. Keeps a custom range from leaking across
// books and follows a settings-driven shift in fiscalYearEnd.
watch(
  () => [props.bookId, resolvedFiscalYearEnd.value],
  () => {
    range.value = currentFiscalYearRange(resolvedFiscalYearEnd.value);
  },
);

watch(() => [props.bookId, props.version, range.value.from, range.value.to, accountCode.value], refresh, { immediate: true });
</script>
