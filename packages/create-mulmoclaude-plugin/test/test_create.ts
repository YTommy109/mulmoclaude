// Integration test: run the CLI in a temp directory and verify the
// resulting plugin tree. Skips the actual `yarn install / yarn build`
// — that's outside the CLI's responsibility and would slow CI down.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "../src/index.js";

let workdir: string;
let outputs: string[];

function captureOutput(text: string): void {
  outputs.push(text);
}

before(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "create-mulmoclaude-plugin-"));
  outputs = [];
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("runCli — happy path", () => {
  it("creates the expected file tree for an unscoped name", async () => {
    outputs = [];
    const result = await runCli(["my-plugin"], workdir, captureOutput);
    assert.equal(result.exitCode, 0);

    const root = path.join(workdir, "my-plugin");
    const expected = [
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "eslint.config.mjs",
      ".gitignore",
      "README.md",
      "src/index.ts",
      "src/definition.ts",
      "src/vue.ts",
      "src/View.vue",
      "src/shims-vue.d.ts",
      "src/lang/en.ts",
      "src/lang/ja.ts",
      "src/lang/index.ts",
    ];
    for (const rel of expected) {
      const full = path.join(root, rel);
      const stats = await stat(full);
      assert.ok(stats.isFile(), `expected file: ${rel}`);
    }

    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf-8"));
    assert.equal(pkg.name, "my-plugin");
    assert.equal(pkg.type, "module");

    const indexTs = await readFile(path.join(root, "src/index.ts"), "utf-8");
    assert.match(indexTs, /definePlugin/);

    const allOutput = outputs.join("");
    assert.match(allOutput, /Created my-plugin/);
    assert.match(allOutput, /yarn build/);
  });

  it("creates a directory matching the local part for a scoped name", async () => {
    outputs = [];
    const result = await runCli(["@example/cool-plugin"], workdir, captureOutput);
    assert.equal(result.exitCode, 0);

    const root = path.join(workdir, "cool-plugin");
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf-8"));
    assert.equal(pkg.name, "@example/cool-plugin");
  });
});

describe("runCli — error paths", () => {
  it("prints usage and exits 1 when no name is given", async () => {
    outputs = [];
    const result = await runCli([], workdir, captureOutput);
    assert.equal(result.exitCode, 1);
    assert.match(outputs.join(""), /Usage:/);
  });

  it("rejects multiple positional arguments", async () => {
    outputs = [];
    const result = await runCli(["foo", "bar"], workdir, captureOutput);
    assert.equal(result.exitCode, 1);
    assert.match(outputs.join(""), /Expected exactly one package name/);
  });

  it("rejects an invalid name", async () => {
    outputs = [];
    const result = await runCli(["My Bad Name"], workdir, captureOutput);
    assert.equal(result.exitCode, 1);
    assert.match(outputs.join(""), /Invalid package name/);
  });

  it("refuses to overwrite an existing directory", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "create-mulmoclaude-plugin-overwrite-"));
    try {
      // Pre-create the target dir to simulate a name collision.
      const collisionTarget = path.join(fresh, "exists-already");
      await (await import("node:fs/promises")).mkdir(collisionTarget);
      // Add a marker so we can prove it survived.
      await writeFile(path.join(collisionTarget, "marker.txt"), "untouched");

      const captured: string[] = [];
      const result = await runCli(["exists-already"], fresh, (text) => captured.push(text));
      assert.equal(result.exitCode, 1);
      assert.match(captured.join(""), /Refusing to overwrite/);

      // Marker is still there — we did not blow away the user's data.
      const marker = await readFile(path.join(collisionTarget, "marker.txt"), "utf-8");
      assert.equal(marker, "untouched");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
