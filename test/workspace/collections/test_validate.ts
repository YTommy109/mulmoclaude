// Validation pass surfaced through presentCollection: a malformed record
// is silently skipped at read time, so the validator must report it back
// to the authoring LLM. Pins the unparseable-JSON detection (the
// silent-data-loss bug) plus the cheap schema checks.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { validateCollectionRecords } from "../../../server/workspace/collections/validate.js";
import type { LoadedCollection } from "../../../server/workspace/collections/index.js";
import type { CollectionSchema } from "../../../server/workspace/collections/types.js";

const schema = {
  title: "Lessons",
  icon: "school",
  dataPath: "data/lessons/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    title: { type: "string", label: "Title", required: true },
    status: { type: "enum", label: "Status", values: ["planned", "done"], required: true },
  },
} as unknown as CollectionSchema;

let dir: string;
const collection = (): LoadedCollection => ({ slug: "lessons", source: "project", schema, dataDir: dir, skillDir: dir }) as unknown as LoadedCollection;
const write = (name: string, body: string) => writeFileSync(path.join(dir, name), body);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "validate-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("validateCollectionRecords", () => {
  it("returns no issues when every record is valid", async () => {
    write("a.json", JSON.stringify({ id: "a", title: "A", status: "planned" }));
    write("b.json", JSON.stringify({ id: "b", title: "B", status: "done" }));
    assert.deepEqual(await validateCollectionRecords(collection()), []);
  });

  it("returns [] when the data dir doesn't exist yet", async () => {
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(await validateCollectionRecords(collection()), []);
  });

  it("flags an unparseable record (the unescaped-quote bug)", async () => {
    write("bad.json", '{ "id": "bad", "title": "がんは"細胞のバグ"", "status": "planned" }');
    const issues = await validateCollectionRecords(collection());
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "bad.json");
    assert.match(issues[0]?.problem ?? "", /invalid JSON/);
  });

  it("flags id not matching the filename", async () => {
    write("x.json", JSON.stringify({ id: "wrong", title: "T", status: "planned" }));
    const [issue] = await validateCollectionRecords(collection());
    assert.match(issue?.problem ?? "", /must equal the filename/);
  });

  it("flags a missing required field and an invalid enum value", async () => {
    write("m.json", JSON.stringify({ id: "m", status: "planned" })); // missing title
    write("e.json", JSON.stringify({ id: "e", title: "T", status: "nope" })); // bad enum
    const issues = await validateCollectionRecords(collection());
    const byFile = Object.fromEntries(issues.map((i) => [i.file, i.problem]));
    assert.match(byFile["m.json"] ?? "", /missing required field 'title'/);
    assert.match(byFile["e.json"] ?? "", /not one of/);
  });

  it("ignores dotfiles and non-json entries", async () => {
    write(".DS_Store", "junk");
    write("notes.txt", "not a record");
    write("ok.json", JSON.stringify({ id: "ok", title: "T", status: "done" }));
    assert.deepEqual(await validateCollectionRecords(collection()), []);
  });
});
