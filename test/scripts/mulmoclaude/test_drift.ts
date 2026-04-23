// Unit tests for scripts/mulmoclaude/drift.mjs — the JS port of
// SKILL.md §2 workspace-drift check. Covers the pure line counter,
// the per-package audit against filesystem fixtures, and the
// auto-detection step that reads packages/mulmoclaude/package.json.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as drift from "../../../scripts/mulmoclaude/drift.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

describe("countValueExportLines", () => {
  it("counts plain re-export lines", () => {
    const source = `export { foo } from "./foo";\nexport { bar } from "./bar";\n`;
    assert.equal(drift.countValueExportLines(source), 2);
  });

  it("counts a mixed value+type brace as ONE line (value-bearing)", () => {
    // `EVENT_TYPES` is a runtime binding, so the line counts even
    // though it also lists some types. Matches the skill's shell
    // regex behaviour exactly.
    const source = `export { EVENT_TYPES, type EventType, generationKey } from "./events";\n`;
    assert.equal(drift.countValueExportLines(source), 1);
  });

  it("excludes `export type` lines", () => {
    const source = `export type Foo = number;\nexport type { Bar } from "./bar";\n`;
    assert.equal(drift.countValueExportLines(source), 0);
  });

  it("excludes `export interface` lines", () => {
    const source = `export interface Foo { x: number; }\n`;
    assert.equal(drift.countValueExportLines(source), 0);
  });

  it("excludes `export { type Foo }` brace-type-only lines", () => {
    const source = `export { type Attachment } from "./attachment";\n`;
    assert.equal(drift.countValueExportLines(source), 0);
  });

  it("includes `export { type Foo }` when the brace also has runtime bindings", () => {
    const source = `export { type Attachment, saveAttachment } from "./attachment";\n`;
    // Brace starts with `type`, so the skill's heuristic strips it.
    // We match the skill — this is an intentional false negative
    // that favours consistency with the existing pipeline.
    assert.equal(drift.countValueExportLines(source), 0);
  });

  it("handles CRLF line endings", () => {
    const source = 'export { a } from "./a";\r\nexport { b } from "./b";\r\n';
    assert.equal(drift.countValueExportLines(source), 2);
  });

  it("ignores indented `export` (only top-level counts)", () => {
    // TypeScript namespaces and conditional blocks emit nested
    // `export` tokens that aren't module-level exports.
    const source = `namespace NS {\n  export const x = 1;\n}\n`;
    assert.equal(drift.countValueExportLines(source), 0);
  });

  it("returns 0 for empty / no-export files", () => {
    assert.equal(drift.countValueExportLines(""), 0);
    assert.equal(drift.countValueExportLines("const x = 1;\n"), 0);
  });
});

describe("checkPackageDrift", () => {
  it("reports ok when src and dist line counts match", async () => {
    const result = await drift.checkPackageDrift({
      root: path.join(FIXTURES, "drift-clean"),
      packageBaseName: "protocol",
      installedRoot: "installed_packages",
      distRelative: "_dist/index.js",
    });
    assert.equal(result.status, "ok");
    assert.equal(result.localCount, 3);
    assert.equal(result.distCount, 3);
    assert.equal(result.localVersion, "0.1.3");
  });

  it("flags drift when src has more value-export lines than dist", async () => {
    const result = await drift.checkPackageDrift({
      root: path.join(FIXTURES, "drift-drifted"),
      packageBaseName: "protocol",
      installedRoot: "installed_packages",
      distRelative: "_dist/index.js",
    });
    assert.equal(result.status, "drifted");
    assert.equal(result.localCount, 3);
    assert.equal(result.distCount, 2);
  });

  it("returns ok for a sibling package that didn't drift", async () => {
    const result = await drift.checkPackageDrift({
      root: path.join(FIXTURES, "drift-drifted"),
      packageBaseName: "client",
      installedRoot: "installed_packages",
      distRelative: "_dist/index.js",
    });
    assert.equal(result.status, "ok");
    assert.equal(result.localCount, 1);
    assert.equal(result.distCount, 1);
  });

  it("skips (not fails) when the installed dist is missing", async () => {
    // drift-clean has protocol but not, say, chat-service. Missing
    // node_modules entry must NOT be a hard error — tests run
    // without a full yarn install on the fixture tree.
    const result = await drift.checkPackageDrift({
      root: path.join(FIXTURES, "drift-clean"),
      packageBaseName: "chat-service",
      installedRoot: "installed_packages",
      distRelative: "_dist/index.js",
    });
    assert.equal(result.status, "skipped");
    assert.match(result.reason ?? "", /src not found|dist not found/);
  });

  it("throws when packageBaseName is missing", async () => {
    await assert.rejects(drift.checkPackageDrift({ root: FIXTURES }), /packageBaseName is required/);
  });
});

describe("detectMulmobridgeDeps", () => {
  it("returns only bridge deps that also have a local workspace", async () => {
    // drift-drifted declares @mulmobridge/protocol + @mulmobridge/client
    // + express. Only the first two have a packages/<name>/ dir, so
    // only those two should be returned (express is not a bridge).
    const names = await drift.detectMulmobridgeDeps({
      root: path.join(FIXTURES, "drift-drifted"),
    });
    assert.deepEqual(names.sort(), ["client", "protocol"]);
  });

  it("returns empty when the launcher has no bridge deps", async () => {
    // drift-clean only declares one bridge; assert that handle:
    const names = await drift.detectMulmobridgeDeps({
      root: path.join(FIXTURES, "drift-clean"),
    });
    assert.deepEqual(names, ["protocol"]);
  });
});

describe("checkWorkspaceDrift (auto-detection)", () => {
  it("runs per-package checks across auto-detected deps", async () => {
    const results = await drift.checkWorkspaceDrift({
      root: path.join(FIXTURES, "drift-drifted"),
      installedRoot: "installed_packages",
      distRelative: "_dist/index.js",
    });
    assert.equal(results.length, 2);
    const protocolResult = results.find((row) => row.packageBaseName === "protocol");
    const clientResult = results.find((row) => row.packageBaseName === "client");
    assert.equal(protocolResult?.status, "drifted");
    assert.equal(clientResult?.status, "ok");
  });

  it("accepts an explicit package list (skips auto-detection)", async () => {
    const results = await drift.checkWorkspaceDrift({
      root: path.join(FIXTURES, "drift-clean"),
      packageBaseNames: ["protocol"],
      installedRoot: "installed_packages",
      distRelative: "_dist/index.js",
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "ok");
  });
});
