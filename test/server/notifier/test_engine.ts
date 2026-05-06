import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import { publish, clear, cancel, get, listFor, listAll, initNotifier, _setActiveFilePathForTesting } from "../../../server/notifier/engine.js";
import type { NotifierEvent } from "../../../server/notifier/types.js";

let tmpDir = "";
let activeFile = "";
let emittedEvents: NotifierEvent[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "mulmo-notifier-test-"));
  activeFile = path.join(tmpDir, "active.json");
  _setActiveFilePathForTesting(activeFile);
  emittedEvents = [];
  initNotifier({
    publish: (_channel, payload) => {
      emittedEvents.push(payload as NotifierEvent);
    },
  });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("publish", () => {
  it("returns an id and stores the entry", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "Backup completed",
    });
    assert.match(id, /^[0-9a-f-]{36}$/);
    const entry = await get(id);
    assert.ok(entry);
    assert.equal(entry?.id, id);
    assert.equal(entry?.pluginPkg, "debug__system");
    assert.equal(entry?.severity, "info");
    assert.equal(entry?.title, "Backup completed");
    assert.match(entry?.createdAt ?? "", /\d{4}-\d{2}-\d{2}T/);
  });

  it("emits a `published` event after persistence", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "hello",
    });
    assert.equal(emittedEvents.length, 1);
    const [event] = emittedEvents;
    assert.equal(event.type, "published");
    if (event.type === "published") {
      assert.equal(event.entry.id, id);
    }
  });

  it("preserves opaque pluginData through JSON round-trip", async () => {
    const pluginData = { taxYear: 2026, items: ["w2", "1099"], nested: { ok: true } };
    const { id } = await publish({
      pluginPkg: "encore",
      severity: "urgent",
      lifecycle: "action",
      title: "File taxes",
      pluginData,
    });
    const entry = await get(id);
    assert.deepEqual(entry?.pluginData, pluginData);
  });

  it("persists across engine 'restart' (re-reading from disk)", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "persist me",
    });
    // Simulating a restart: drop the engine's path binding, then
    // re-set it. The engine has no in-memory cache, so a fresh
    // listAll() must read from disk and find the entry.
    _setActiveFilePathForTesting(activeFile);
    const entries = await listAll();
    const found = entries.find((entry) => entry.id === id);
    assert.ok(found, "entry should survive a path rebind");
  });
});

describe("clear", () => {
  it("removes the entry and emits `cleared`", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "clear me",
    });
    emittedEvents.length = 0;
    await clear(id);
    assert.equal(await get(id), undefined);
    assert.equal(emittedEvents.length, 1);
    assert.deepEqual(emittedEvents[0], { type: "cleared", id });
  });

  it("is idempotent: a second clear is a no-op (no throw, no emit)", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "x",
    });
    await clear(id);
    emittedEvents.length = 0;
    await clear(id);
    assert.equal(emittedEvents.length, 0, "no event on duplicate clear");
  });

  it("on unknown id is a no-op (no throw, no emit, no file mutation)", async () => {
    // Pre-publish so we have a known file state to compare against.
    await publish({ pluginPkg: "debug__system", severity: "info", title: "marker" });
    const before = readFileSync(activeFile, "utf-8");
    emittedEvents.length = 0;
    await clear("00000000-0000-0000-0000-000000000000");
    assert.equal(emittedEvents.length, 0);
    const after = readFileSync(activeFile, "utf-8");
    assert.equal(after, before, "file not rewritten on no-op clear");
  });
});

describe("cancel", () => {
  it("removes the entry and emits `cancelled`", async () => {
    const { id } = await publish({
      pluginPkg: "debug__system",
      severity: "info",
      title: "cancel me",
    });
    emittedEvents.length = 0;
    await cancel(id);
    assert.equal(await get(id), undefined);
    assert.equal(emittedEvents.length, 1);
    assert.deepEqual(emittedEvents[0], { type: "cancelled", id });
  });

  it("emits `cancelled`, distinct from `cleared`, on the same removal mechanic", async () => {
    const { id: idA } = await publish({ pluginPkg: "x", severity: "info", title: "a" });
    const { id: idB } = await publish({ pluginPkg: "x", severity: "info", title: "b" });
    emittedEvents.length = 0;
    await clear(idA);
    await cancel(idB);
    assert.deepEqual(
      emittedEvents.map((event) => event.type),
      ["cleared", "cancelled"],
    );
  });
});

describe("listFor", () => {
  it("returns only entries with the given pluginPkg", async () => {
    await publish({ pluginPkg: "a", severity: "info", title: "a1" });
    await publish({ pluginPkg: "b", severity: "info", title: "b1" });
    await publish({ pluginPkg: "a", severity: "info", title: "a2" });

    const aEntries = await listFor("a");
    const bEntries = await listFor("b");
    assert.equal(aEntries.length, 2);
    assert.equal(bEntries.length, 1);
    assert.deepEqual(aEntries.map((entry) => entry.title).sort(), ["a1", "a2"]);
    assert.deepEqual(bEntries[0].title, "b1");
  });

  it("returns [] when nothing matches", async () => {
    await publish({ pluginPkg: "a", severity: "info", title: "x" });
    const result = await listFor("nope");
    assert.deepEqual(result, []);
  });

  it("returns [] on a fresh workspace (file doesn't exist yet)", async () => {
    assert.equal(existsSync(activeFile), false, "precondition: no file");
    const result = await listFor("anything");
    assert.deepEqual(result, []);
  });
});

describe("listAll", () => {
  it("returns every active entry", async () => {
    await publish({ pluginPkg: "a", severity: "info", title: "1" });
    await publish({ pluginPkg: "b", severity: "info", title: "2" });
    const entries = await listAll();
    assert.equal(entries.length, 2);
  });

  it("excludes cleared / cancelled entries", async () => {
    const { id: cleared } = await publish({ pluginPkg: "a", severity: "info", title: "c" });
    const { id: kept } = await publish({ pluginPkg: "a", severity: "info", title: "k" });
    await clear(cleared);
    const entries = await listAll();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, kept);
  });
});

describe("write coordination under concurrency", () => {
  it("10 simultaneous publishes all land in the file", async () => {
    const titles = Array.from({ length: 10 }, (_unused, index) => `concurrent-${index}`);
    const results = await Promise.all(titles.map((title) => publish({ pluginPkg: "concur", severity: "info", title })));
    assert.equal(new Set(results.map((result) => result.id)).size, 10, "ids are unique");

    const entries = await listAll();
    assert.equal(entries.length, 10);
    assert.deepEqual(entries.map((entry) => entry.title).sort(), titles.slice().sort());
  });

  it("interleaved publish + clear leaves the expected residual set", async () => {
    const published = await Promise.all(Array.from({ length: 5 }, (_unused, index) => publish({ pluginPkg: "concur", severity: "info", title: `t-${index}` })));
    // Concurrently clear three of them while two more publishes are
    // in flight; the queue's drainer batches them into one or two
    // load/save cycles. End state must reflect every operation.
    await Promise.all([
      clear(published[0].id),
      clear(published[1].id),
      clear(published[2].id),
      publish({ pluginPkg: "concur", severity: "info", title: "extra-1" }),
      publish({ pluginPkg: "concur", severity: "info", title: "extra-2" }),
    ]);

    const entries = await listAll();
    const titles = entries.map((entry) => entry.title).sort();
    assert.deepEqual(titles, ["extra-1", "extra-2", "t-3", "t-4"]);
  });
});

describe("on-disk format", () => {
  it("writes a valid JSON document with an `entries` map", async () => {
    const { id } = await publish({ pluginPkg: "x", severity: "info", title: "y" });
    const raw = readFileSync(activeFile, "utf-8");
    const parsed = JSON.parse(raw);
    assert.ok(parsed && typeof parsed === "object");
    assert.ok(parsed.entries && typeof parsed.entries === "object");
    assert.equal(parsed.entries[id]?.id, id);
  });

  it("creates the file on first publish (no eager init)", async () => {
    assert.equal(existsSync(activeFile), false, "precondition: no file");
    await publish({ pluginPkg: "x", severity: "info", title: "y" });
    assert.equal(existsSync(activeFile), true);
  });
});
