<template>
  <div class="space-y-3" data-testid="settings-map-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.mapTab.description") }}</p>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-800" for="settings-map-api-key">{{ t("settingsModal.mapTab.apiKeyLabel") }}</label>
      <input
        id="settings-map-api-key"
        v-model="apiKeyDraft"
        type="password"
        autocomplete="off"
        spellcheck="false"
        class="w-full px-3 py-2 text-sm font-mono rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        :placeholder="t('settingsModal.mapTab.apiKeyPlaceholder')"
        data-testid="settings-map-api-key-input"
        @keydown.enter.prevent="save"
      />
      <p class="text-xs text-gray-500">
        <i18n-t keypath="settingsModal.mapTab.helperText" tag="span">
          <template #consoleLink>
            <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- "Google Cloud Console" is a product name, not translatable copy -->
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline"
              >Google Cloud Console</a
            >
            <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
          </template>
        </i18n-t>
      </p>
      <p class="text-xs text-gray-500">{{ t("settingsModal.mapTab.requiredApis") }}</p>
    </div>

    <div class="flex items-center gap-3">
      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
        :disabled="!isDirty || saving"
        data-testid="settings-map-save-btn"
        @click="save"
      >
        {{ saving ? t("common.saving") : t("common.save") }}
      </button>
      <span v-if="loaded" class="text-xs" :class="storedKey ? 'text-green-600' : 'text-gray-500'" data-testid="settings-map-status">
        {{ storedKey ? t("settingsModal.mapTab.configured") : t("settingsModal.mapTab.notConfigured") }}
      </span>
      <button v-if="storedKey" type="button" class="text-xs text-red-600 hover:underline" data-testid="settings-map-clear-btn" @click="clear">
        {{ t("settingsModal.mapTab.clear") }}
      </button>
    </div>

    <p v-if="errorMessage" class="text-sm text-red-700" role="alert" data-testid="settings-map-error">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPut } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();

const props = defineProps<{
  /** When the parent modal closes/opens, force a reload so values
   *  reflect any out-of-band edit (e.g. user edited settings.json
   *  by hand between sessions). */
  reloadToken: number;
}>();

const emit = defineEmits<{
  saved: [];
}>();

interface SettingsResponse {
  settings: { extraAllowedTools: string[]; googleMapsApiKey?: string };
}

const apiKeyDraft = ref("");
const storedKey = ref("");
const loaded = ref(false);
const saving = ref(false);
const errorMessage = ref("");

const isDirty = computed(() => apiKeyDraft.value !== storedKey.value);

async function load(): Promise<void> {
  errorMessage.value = "";
  const response = await apiGet<SettingsResponse>(API_ROUTES.config.base);
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.mapTab.loadError");
    return;
  }
  storedKey.value = response.data.settings.googleMapsApiKey ?? "";
  apiKeyDraft.value = storedKey.value;
  loaded.value = true;
}

async function save(): Promise<void> {
  if (saving.value || !isDirty.value) return;
  saving.value = true;
  errorMessage.value = "";
  const trimmed = apiKeyDraft.value.trim();
  // Patch-style PUT: only `googleMapsApiKey` is sent. The server's
  // /api/config/settings handler merges over the on-disk state,
  // so other tabs' fields (extraAllowedTools) survive untouched.
  // Empty string is a valid "clear" operation.
  const response = await apiPut<unknown>(API_ROUTES.config.settings, {
    googleMapsApiKey: trimmed,
  });
  saving.value = false;
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.mapTab.saveError");
    return;
  }
  storedKey.value = trimmed;
  apiKeyDraft.value = trimmed;
  emit("saved");
}

async function clear(): Promise<void> {
  apiKeyDraft.value = "";
  await save();
}

watch(
  () => props.reloadToken,
  () => {
    void load();
  },
  { immediate: true },
);
</script>
