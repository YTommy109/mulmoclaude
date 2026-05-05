// Translates a role's suggested queries into the user's current
// browser locale via /api/translation. Until the response lands the
// caller keeps seeing the English source — the swap is reactive
// (Vue updates the SuggestionsPanel when the cache slot fills in).
//
// Cache keyed by `${roleId}:${locale}` and shared across all
// consumers. Concurrent requests for the same key are deduped via
// an in-flight Promise map.
//
// `locale` is taken as a Ref instead of being read from `useI18n()`
// internally so the composable can be unit-tested outside a Vue
// setup context.

import { computed, watchEffect, type ComputedRef, type Ref, ref } from "vue";
import { apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import type { Role } from "../config/roles";

const TRANSLATION_NAMESPACE = "role-queries";

interface TranslateResponse {
  translations: string[];
}

const cache = new Map<string, Ref<string[] | null>>();
const inflight = new Map<string, Promise<void>>();

function cacheKey(roleId: string, locale: string): string {
  return `${roleId}:${locale}`;
}

function ensureSlot(key: string): Ref<string[] | null> {
  let slot = cache.get(key);
  if (!slot) {
    slot = ref<string[] | null>(null);
    cache.set(key, slot);
  }
  return slot;
}

async function runFetch(key: string, locale: string, sentences: string[]): Promise<void> {
  const result = await apiPost<TranslateResponse>(API_ROUTES.translation.translate, {
    namespace: TRANSLATION_NAMESPACE,
    targetLanguage: locale,
    sentences,
  });
  if (!result.ok) {
    console.warn("[useTranslatedQueries] translate failed:", result.error);
    return;
  }
  const { translations } = result.data;
  if (!Array.isArray(translations) || translations.length !== sentences.length) {
    console.warn("[useTranslatedQueries] translate returned wrong length", {
      expected: sentences.length,
      got: Array.isArray(translations) ? translations.length : "(not array)",
    });
    return;
  }
  ensureSlot(key).value = [...translations];
}

function ensureFetch(roleId: string, locale: string, sentences: string[]): void {
  const key = cacheKey(roleId, locale);
  if (inflight.has(key)) return;
  if (ensureSlot(key).value !== null) return;
  const pending = runFetch(key, locale, sentences).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, pending);
}

export interface UseTranslatedQueriesResult {
  /** Translated queries when available, falling back to the role's
   *  English source while the request is in flight or fails. */
  readonly queries: ComputedRef<string[]>;
}

export function useTranslatedQueries(role: Ref<Role | undefined>, locale: Ref<string>): UseTranslatedQueriesResult {
  watchEffect(() => {
    const current = role.value;
    if (!current) return;
    const sources = current.queries;
    if (!sources || sources.length === 0) return;
    const lang = locale.value;
    if (lang === "en") return;
    ensureFetch(current.id, lang, [...sources]);
  });

  const queries = computed<string[]>(() => {
    const current = role.value;
    const sources = current?.queries ?? [];
    if (sources.length === 0) return [];
    const lang = locale.value;
    if (lang === "en" || !current) return [...sources];
    return cache.get(cacheKey(current.id, lang))?.value ?? [...sources];
  });

  return { queries };
}

// ── Test-only hooks ─────────────────────────────────────────────────
// Vitest / node:test lives in a fresh worker per file, so module
// state usually cleans itself up. These helpers exist so suites that
// share a worker can still reset between cases.

export function __resetTranslatedQueriesCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
