<template>
  <div class="flex flex-col gap-3" data-testid="accounting-profit-loss">
    <div class="flex flex-wrap items-end gap-3">
      <DateRangePicker v-model="range" :fiscal-year-end="resolvedFiscalYearEnd" :opening-date="openingDate" />
      <button class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50" @click="refresh">
        <span class="material-icons text-base align-middle">refresh</span>
      </button>
    </div>
    <p v-if="loading" class="text-xs text-gray-400">{{ t("pluginAccounting.common.loading") }}</p>
    <p v-else-if="error" class="text-xs text-red-500">{{ t("pluginAccounting.common.error", { error }) }}</p>
    <template v-else-if="profitLoss">
      <section class="border border-gray-200 rounded p-3">
        <h4 class="text-sm font-semibold mb-2">{{ t("pluginAccounting.profitLoss.income") }}</h4>
        <table class="w-full text-sm">
          <tbody>
            <tr v-for="row in profitLoss.income.rows" :key="row.accountCode" class="border-b border-gray-100">
              <td class="py-1 px-1">
                <span class="font-mono text-[10px] text-gray-400 mr-2">{{ row.accountCode }}</span
                >{{ row.accountName }}
              </td>
              <td class="py-1 px-1 text-right font-mono">{{ formatAmount(row.amount) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="font-semibold border-t border-gray-300">
              <td class="py-1 px-1">{{ t("pluginAccounting.balanceSheet.total") }}</td>
              <td class="py-1 px-1 text-right">{{ formatAmount(profitLoss.income.total) }}</td>
            </tr>
          </tfoot>
        </table>
      </section>
      <section class="border border-gray-200 rounded p-3">
        <h4 class="text-sm font-semibold mb-2">{{ t("pluginAccounting.profitLoss.expense") }}</h4>
        <table class="w-full text-sm">
          <tbody>
            <tr v-for="row in profitLoss.expense.rows" :key="row.accountCode" class="border-b border-gray-100">
              <td class="py-1 px-1">
                <span class="font-mono text-[10px] text-gray-400 mr-2">{{ row.accountCode }}</span
                >{{ row.accountName }}
              </td>
              <td class="py-1 px-1 text-right font-mono">{{ formatAmount(row.amount) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="font-semibold border-t border-gray-300">
              <td class="py-1 px-1">{{ t("pluginAccounting.balanceSheet.total") }}</td>
              <td class="py-1 px-1 text-right">{{ formatAmount(profitLoss.expense.total) }}</td>
            </tr>
          </tfoot>
        </table>
      </section>
      <div class="flex justify-end items-center gap-2 text-sm font-semibold" data-testid="accounting-pl-net">
        <span>{{ t("pluginAccounting.profitLoss.netIncome") }}</span>
        <span :class="profitLoss.netIncome >= 0 ? 'text-green-600' : 'text-red-500'">{{ formatAmount(profitLoss.netIncome) }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getProfitLoss, type ProfitLoss } from "../api";
import { formatAmount as formatAmountWithCurrency } from "../currencies";
import { currentFiscalYearRange, resolveFiscalYearEnd, type DateRange, type FiscalYearEnd } from "../fiscalYear";
import { useLatestRequest } from "./useLatestRequest";
import DateRangePicker from "./DateRangePicker.vue";

const { t } = useI18n();

const props = defineProps<{
  bookId: string;
  currency: string;
  version: number;
  fiscalYearEnd?: FiscalYearEnd;
  /** Opening-balance date for the active book — drives the "All"
   *  shortcut in the date picker (from = openingDate, to = today). */
  openingDate?: string;
}>();

const resolvedFiscalYearEnd = computed<FiscalYearEnd>(() => resolveFiscalYearEnd(props.fiscalYearEnd));

// Default = current fiscal year. Reset by the bookId/fiscalYearEnd
// watcher below so switching books or changing the FY-end in
// settings drops a stale custom range from the prior book.
const range = ref<DateRange>(currentFiscalYearRange(resolvedFiscalYearEnd.value));
const profitLoss = ref<ProfitLoss | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const { begin: beginRequest, isCurrent } = useLatestRequest();

function formatAmount(value: number): string {
  return formatAmountWithCurrency(value, props.currency);
}

async function refresh(): Promise<void> {
  const token = beginRequest();
  loading.value = true;
  error.value = null;
  try {
    // P&L always sends a range. Empty-side gets a sentinel so "All"
    // (both empty) means "every entry" rather than an empty window.
    const fromBound = range.value.from || "0000-01-01";
    const toBound = range.value.to || "9999-12-31";
    const result = await getProfitLoss({ kind: "range", from: fromBound, to: toBound }, props.bookId);
    if (!isCurrent(token)) return;
    if (!result.ok) {
      error.value = result.error;
      profitLoss.value = null;
      return;
    }
    profitLoss.value = result.data.profitLoss;
  } finally {
    if (isCurrent(token)) loading.value = false;
  }
}

watch(
  () => [props.bookId, resolvedFiscalYearEnd.value],
  () => {
    range.value = currentFiscalYearRange(resolvedFiscalYearEnd.value);
  },
);

watch(() => [props.bookId, props.version, range.value.from, range.value.to], refresh, { immediate: true });
</script>
