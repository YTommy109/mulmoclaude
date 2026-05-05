// Pure helpers for the translation cache. Kept side-effect free so
// the unit tests can exercise the lookup / merge / assemble logic
// without touching the filesystem or any LLM.

import type { DictionaryFile } from "./types.js";

export function emptyDictionary(): DictionaryFile {
  return { sentences: {} };
}

export function lookupCached(dict: DictionaryFile, sentence: string, lang: string): string | undefined {
  return dict.sentences[sentence]?.[lang];
}

export interface SplitResult {
  /** Map from input sentence to its cached translation. */
  readonly cached: Map<string, string>;
  /** Distinct sentences that need a fresh LLM translation. */
  readonly misses: readonly string[];
}

export function splitHitMiss(dict: DictionaryFile, sentences: readonly string[], lang: string): SplitResult {
  const cached = new Map<string, string>();
  const missesSet = new Set<string>();
  for (const sentence of sentences) {
    const translated = lookupCached(dict, sentence, lang);
    if (translated !== undefined) {
      cached.set(sentence, translated);
    } else {
      missesSet.add(sentence);
    }
  }
  return { cached, misses: Array.from(missesSet) };
}

export function mergeTranslations(dict: DictionaryFile, lang: string, fresh: ReadonlyMap<string, string>): DictionaryFile {
  const next: Record<string, Record<string, string>> = { ...dict.sentences };
  for (const [source, translated] of fresh) {
    next[source] = { ...next[source], [lang]: translated };
  }
  return { sentences: next };
}

export function assembleResult(sentences: readonly string[], cached: ReadonlyMap<string, string>, fresh: ReadonlyMap<string, string>): string[] {
  return sentences.map((sentence) => {
    const translated = cached.get(sentence) ?? fresh.get(sentence);
    if (translated === undefined) {
      throw new Error(`[translation] missing translation for ${JSON.stringify(sentence)}`);
    }
    return translated;
  });
}
