<template>
  <div class="flex items-center gap-2">
    <label class="text-xs text-gray-500" for="accounting-book-select">{{ t("pluginAccounting.bookSwitcher.label") }}</label>
    <select
      id="accounting-book-select"
      :value="modelValue"
      class="h-8 px-2 rounded border border-gray-300 text-sm bg-white"
      data-testid="accounting-book-select"
      @change="onSelect"
    >
      <option v-for="book in books" :key="book.id" :value="book.id">{{ book.name }} ({{ book.currency }})</option>
    </select>
    <button
      class="h-8 px-2.5 flex items-center gap-1 rounded border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
      data-testid="accounting-new-book"
      @click="showNewBook = true"
    >
      <span class="material-icons text-base">add</span>{{ t("pluginAccounting.bookSwitcher.newBook") }}
    </button>
    <div v-if="showNewBook" class="fixed inset-0 z-50 bg-black/20 flex items-center justify-center" @click.self="showNewBook = false">
      <form class="bg-white p-4 rounded shadow-lg w-80 flex flex-col gap-3" data-testid="accounting-new-book-form" @submit.prevent="onCreate">
        <h3 class="text-base font-semibold">{{ t("pluginAccounting.bookSwitcher.newBook") }}</h3>
        <label class="text-sm flex flex-col gap-1">
          {{ t("pluginAccounting.bookSwitcher.nameLabel") }}
          <input v-model="newName" required class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-new-book-name" />
        </label>
        <label class="text-sm flex flex-col gap-1">
          {{ t("pluginAccounting.bookSwitcher.currencyLabel") }}
          <input v-model="newCurrency" class="h-8 px-2 rounded border border-gray-300 text-sm" data-testid="accounting-new-book-currency" placeholder="USD" />
        </label>
        <p v-if="error" class="text-xs text-red-500" data-testid="accounting-new-book-error">{{ error }}</p>
        <div class="flex justify-end gap-2 mt-1">
          <button type="button" class="h-8 px-2.5 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50" @click="showNewBook = false">
            {{ t("pluginAccounting.common.cancel") }}
          </button>
          <button
            type="submit"
            class="h-8 px-2.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
            :disabled="creating"
            data-testid="accounting-new-book-submit"
          >
            {{ creating ? t("pluginAccounting.common.loading") : t("pluginAccounting.bookSwitcher.create") }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { createBook, setActiveBook, type BookSummary } from "../api";

const { t } = useI18n();

const props = defineProps<{ modelValue: string; books: BookSummary[] }>();
const emit = defineEmits<{
  "update:modelValue": [bookId: string];
  "books-changed": [];
}>();

const showNewBook = ref(false);
const newName = ref("");
const newCurrency = ref("USD");
const creating = ref(false);
const error = ref<string | null>(null);

async function onSelect(event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement;
  const bookId = target.value;
  if (bookId === props.modelValue) return;
  const result = await setActiveBook(bookId);
  if (!result.ok) {
    target.value = props.modelValue;
    error.value = result.error;
    return;
  }
  emit("update:modelValue", bookId);
  emit("books-changed");
}

async function onCreate(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  error.value = null;
  try {
    const result = await createBook({ name: newName.value.trim(), currency: newCurrency.value.trim() || "USD" });
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    showNewBook.value = false;
    newName.value = "";
    newCurrency.value = "USD";
    emit("books-changed");
    emit("update:modelValue", result.data.book.id);
  } finally {
    creating.value = false;
  }
}
</script>
