// Regression tests for the direct-invocation gate.
//
// History: an earlier revision used `argv[1].endsWith("/dist/index.js")`,
// which is POSIX-only and silently no-ops on Windows where argv paths use
// backslashes. The replacement compares resolved real paths through
// `realpathSync` + `fileURLToPath`, which handles separators AND symlinks
// (npm bin shims). These tests pin the contract — anyone reverting to a
// suffix-string check will trip the symlink case.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { entryMatchesModule } from "../src/index.js";

let workdir: string;

before(async () => {
  // realpath the tmpdir so macOS's /var → /private/var symlink doesn't
  // skew the comparison — entryMatchesModule resolves entry via
  // realpathSync but takes the module URL verbatim.
  workdir = realpathSync(await mkdtemp(path.join(tmpdir(), "create-mulmoclaude-plugin-invoke-")));
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("entryMatchesModule", () => {
  it("returns true when entry resolves to the same file as the module URL", async () => {
    const real = path.join(workdir, "real.js");
    await writeFile(real, "// real entry");
    assert.equal(entryMatchesModule(real, pathToFileURL(real).href), true);
  });

  it("returns true when entry is a symlink to the module file (npm bin shim)", async () => {
    const real = path.join(workdir, "shim-target.js");
    const link = path.join(workdir, "shim-link.js");
    await writeFile(real, "// real entry");
    await symlink(real, link);
    assert.equal(entryMatchesModule(link, pathToFileURL(real).href), true);
  });

  it("returns false when entry points to a different file", async () => {
    const real = path.join(workdir, "real-a.js");
    const other = path.join(workdir, "real-b.js");
    await writeFile(real, "// a");
    await writeFile(other, "// b");
    assert.equal(entryMatchesModule(other, pathToFileURL(real).href), false);
  });

  it("returns false when entry is undefined (no argv[1])", () => {
    assert.equal(entryMatchesModule(undefined, "file:///anything.js"), false);
  });

  it("returns false when entry path does not exist (realpathSync throws)", () => {
    const ghost = path.join(workdir, "does-not-exist.js");
    assert.equal(entryMatchesModule(ghost, pathToFileURL(ghost).href), false);
  });
});
