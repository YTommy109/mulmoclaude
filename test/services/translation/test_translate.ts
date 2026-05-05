import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { WORKSPACE_DIRS } from "../../../server/workspace/paths.js";
import { createTranslationService, TranslationInputError } from "../../../server/services/translation/index.js";
import type { TranslateBatchFn, TranslateBatchInput } from "../../../server/services/translation/types.js";

interface MockBackend {
  readonly fn: TranslateBatchFn;
  readonly calls: TranslateBatchInput[];
}

function makeMock(fakeTranslate: (sentence: string, lang: string) => string = (sentence, lang) => `[${lang}]${sentence}`): MockBackend {
  const calls: TranslateBatchInput[] = [];
  const runner: TranslateBatchFn = async (input) => {
    calls.push({ targetLanguage: input.targetLanguage, sentences: [...input.sentences] });
    return input.sentences.map((sentence) => fakeTranslate(sentence, input.targetLanguage));
  };
  return { fn: runner, calls };
}

function dictPath(root: string, namespace: string): string {
  return path.join(root, WORKSPACE_DIRS.translation, `${namespace}.json`);
}

function readDict(root: string, namespace: string): unknown {
  return JSON.parse(readFileSync(dictPath(root, namespace), "utf-8"));
}

describe("translation service — cold/warm/partial", () => {
  let root: string;
  before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "mulmoclaude-tr-")));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("cold: missing cache → mock called with all sentences, file written, result matches", async () => {
    const mock = makeMock();
    const service = createTranslationService({ translateBatch: mock.fn, workspaceRoot: root });
    const { translations } = await service.translate({
      namespace: "cold",
      targetLanguage: "ja",
      sentences: ["Hello", "World"],
    });
    assert.deepEqual(translations, ["[ja]Hello", "[ja]World"]);
    assert.equal(mock.calls.length, 1);
    assert.deepEqual([...mock.calls[0].sentences].sort(), ["Hello", "World"]);
    assert.deepEqual(readDict(root, "cold"), {
      sentences: {
        Hello: { ja: "[ja]Hello" },
        World: { ja: "[ja]World" },
      },
    });
  });

  it("warm: full cache hit → mock NOT called", async () => {
    const mock = makeMock();
    const service = createTranslationService({ translateBatch: mock.fn, workspaceRoot: root });
    // primed by the previous test
    const { translations } = await service.translate({
      namespace: "cold",
      targetLanguage: "ja",
      sentences: ["World", "Hello"],
    });
    assert.deepEqual(translations, ["[ja]World", "[ja]Hello"]);
    assert.equal(mock.calls.length, 0);
  });

  it("partial: some cached, some missing → mock called only with misses, result preserves input order", async () => {
    const mock = makeMock();
    const service = createTranslationService({ translateBatch: mock.fn, workspaceRoot: root });
    const { translations } = await service.translate({
      namespace: "cold",
      targetLanguage: "ja",
      sentences: ["Hello", "Foo", "World", "Bar"],
    });
    assert.deepEqual(translations, ["[ja]Hello", "[ja]Foo", "[ja]World", "[ja]Bar"]);
    assert.equal(mock.calls.length, 1);
    assert.deepEqual([...mock.calls[0].sentences].sort(), ["Bar", "Foo"]);
  });

  it("merge: adding a new language preserves existing one", async () => {
    const mock = makeMock();
    const service = createTranslationService({ translateBatch: mock.fn, workspaceRoot: root });
    await service.translate({
      namespace: "cold",
      targetLanguage: "ko",
      sentences: ["Hello"],
    });
    const dict = readDict(root, "cold") as { sentences: Record<string, Record<string, string>> };
    assert.deepEqual(dict.sentences.Hello, { ja: "[ja]Hello", ko: "[ko]Hello" });
  });
});

describe("translation service — en short-circuit", () => {
  let root: string;
  before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "mulmoclaude-tr-en-")));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("targetLanguage en → mock NOT called, no cache file, returns input verbatim", async () => {
    const mock = makeMock();
    const service = createTranslationService({ translateBatch: mock.fn, workspaceRoot: root });
    const { translations } = await service.translate({
      namespace: "en-test",
      targetLanguage: "en",
      sentences: ["Hello", "World"],
    });
    assert.deepEqual(translations, ["Hello", "World"]);
    assert.equal(mock.calls.length, 0);
    assert.equal(existsSync(dictPath(root, "en-test")), false);
  });
});

describe("translation service — validation", () => {
  let root: string;
  let service: ReturnType<typeof createTranslationService>;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "mulmoclaude-tr-val-")));
    service = createTranslationService({ translateBatch: makeMock().fn, workspaceRoot: root });
  });

  it("rejects path-traversal namespace", async () => {
    await assert.rejects(() => service.translate({ namespace: "../etc", targetLanguage: "ja", sentences: ["Hi"] }), TranslationInputError);
  });

  it("rejects empty namespace", async () => {
    await assert.rejects(() => service.translate({ namespace: "", targetLanguage: "ja", sentences: ["Hi"] }), TranslationInputError);
  });

  it("rejects malformed targetLanguage", async () => {
    await assert.rejects(() => service.translate({ namespace: "ns", targetLanguage: "Japanese", sentences: ["Hi"] }), TranslationInputError);
  });

  it("accepts BCP-47 region code (pt-BR)", async () => {
    const mock = makeMock();
    const svc = createTranslationService({ translateBatch: mock.fn, workspaceRoot: root });
    const { translations } = await svc.translate({ namespace: "ns", targetLanguage: "pt-BR", sentences: ["Hi"] });
    assert.deepEqual(translations, ["[pt-BR]Hi"]);
  });

  it("rejects empty sentences array", async () => {
    await assert.rejects(() => service.translate({ namespace: "ns", targetLanguage: "ja", sentences: [] }), TranslationInputError);
  });

  it("rejects sentences with empty strings", async () => {
    await assert.rejects(() => service.translate({ namespace: "ns", targetLanguage: "ja", sentences: ["Hi", ""] }), TranslationInputError);
  });
});

describe("translation service — backend contract", () => {
  let root: string;
  before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "mulmoclaude-tr-bad-")));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("throws when translateBatch returns the wrong number of strings", async () => {
    const wrongLength: TranslateBatchFn = async () => ["only-one"];
    const service = createTranslationService({ translateBatch: wrongLength, workspaceRoot: root });
    await assert.rejects(() => service.translate({ namespace: "ns", targetLanguage: "ja", sentences: ["A", "B"] }), /returned 1 translations for 2 sentences/);
  });
});

describe("translation service — single-flight serialization", () => {
  let root: string;
  before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "mulmoclaude-tr-sf-")));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("two concurrent calls on the same namespace serialize: the second sees the first's writes", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const calls: TranslateBatchInput[] = [];
    let callIndex = 0;
    const gated: TranslateBatchFn = async (input) => {
      calls.push({ targetLanguage: input.targetLanguage, sentences: [...input.sentences] });
      callIndex += 1;
      if (callIndex === 1) {
        await firstGate;
      }
      return input.sentences.map((sentence) => `[${input.targetLanguage}]${sentence}`);
    };

    const service = createTranslationService({ translateBatch: gated, workspaceRoot: root });

    const firstCall = service.translate({ namespace: "ns", targetLanguage: "ja", sentences: ["Hello"] });
    const secondCall = service.translate({ namespace: "ns", targetLanguage: "ja", sentences: ["Hello", "World"] });

    // Yield so the second call can register its serialization continuation behind the first.
    await new Promise((resolve) => setImmediate(resolve));
    releaseFirst?.();

    const [resA, resB] = await Promise.all([firstCall, secondCall]);
    assert.deepEqual(resA.translations, ["[ja]Hello"]);
    assert.deepEqual(resB.translations, ["[ja]Hello", "[ja]World"]);

    // First mock invocation handled "Hello"; second should have been called only with "World".
    assert.equal(calls.length, 2);
    assert.deepEqual([...calls[0].sentences], ["Hello"]);
    assert.deepEqual([...calls[1].sentences], ["World"]);
  });
});
