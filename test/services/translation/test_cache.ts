import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assembleResult, emptyDictionary, lookupCached, mergeTranslations, splitHitMiss } from "../../../server/services/translation/cache.js";

describe("translation cache helpers", () => {
  it("emptyDictionary returns a fresh empty object on each call", () => {
    const first = emptyDictionary();
    const second = emptyDictionary();
    first.sentences["Hello"] = { ja: "こんにちは" };
    assert.deepEqual(second, { sentences: {} });
  });

  it("lookupCached returns the translation when present", () => {
    const dict = { sentences: { Hello: { ja: "こんにちは", ko: "안녕" } } };
    assert.equal(lookupCached(dict, "Hello", "ja"), "こんにちは");
  });

  it("lookupCached returns undefined when sentence or language is missing", () => {
    const dict = { sentences: { Hello: { ja: "こんにちは" } } };
    assert.equal(lookupCached(dict, "Hello", "ko"), undefined);
    assert.equal(lookupCached(dict, "World", "ja"), undefined);
  });

  it("splitHitMiss separates cached entries from misses, dedupes misses", () => {
    const dict = { sentences: { Hello: { ja: "こんにちは" } } };
    const { cached, misses } = splitHitMiss(dict, ["Hello", "World", "Hello", "Foo"], "ja");
    assert.equal(cached.get("Hello"), "こんにちは");
    assert.equal(cached.size, 1);
    assert.deepEqual([...misses].sort(), ["Foo", "World"]);
  });

  it("mergeTranslations preserves existing language entries when adding a new one", () => {
    const dict = { sentences: { Hello: { ja: "こんにちは" } } };
    const fresh = new Map([["Hello", "안녕"]]);
    const next = mergeTranslations(dict, "ko", fresh);
    assert.deepEqual(next.sentences.Hello, { ja: "こんにちは", ko: "안녕" });
    // original untouched (pure helper)
    assert.deepEqual(dict.sentences.Hello, { ja: "こんにちは" });
  });

  it("mergeTranslations adds new sentence keys", () => {
    const dict = emptyDictionary();
    const fresh = new Map([
      ["Hello", "こんにちは"],
      ["World", "世界"],
    ]);
    const next = mergeTranslations(dict, "ja", fresh);
    assert.deepEqual(next.sentences, {
      Hello: { ja: "こんにちは" },
      World: { ja: "世界" },
    });
  });

  it("assembleResult preserves caller's input order across cached + fresh", () => {
    const cached = new Map([["Hello", "こんにちは"]]);
    const fresh = new Map([
      ["World", "世界"],
      ["Foo", "フー"],
    ]);
    const result = assembleResult(["World", "Hello", "Foo", "Hello"], cached, fresh);
    assert.deepEqual(result, ["世界", "こんにちは", "フー", "こんにちは"]);
  });

  it("assembleResult throws when a sentence is in neither map", () => {
    assert.throws(() => assembleResult(["Hello"], new Map(), new Map()), /missing translation/);
  });
});
