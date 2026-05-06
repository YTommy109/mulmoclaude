// Unit tests for the staleness gate that protects `yarn dev` from
// rebuilding workspace packages whose dist/ is already up to date
// (#1202). The script itself is JS-with-JSDoc; we import the pure
// helpers (no spawn / no `process.argv` reading) and exercise them
// against a tmp-dir fixture.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isStale, maxMtime } from "../scripts/dev-build-if-needed.mjs";

const ONE_DAY_S = 24 * 60 * 60;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dev-build-gate-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function touch(path: string, mtimeS: number): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "x");
  utimesSync(path, mtimeS, mtimeS);
}

describe("maxMtime", () => {
  it("returns 0 for a missing directory (no throw)", () => {
    assert.equal(maxMtime(join(root, "does", "not", "exist")), 0);
  });

  it("returns 0 for an empty directory", () => {
    mkdirSync(join(root, "empty"));
    assert.equal(maxMtime(join(root, "empty")), 0);
  });

  it("returns the latest mtime across nested files", () => {
    const now = Date.now() / 1000;
    touch(join(root, "a", "old.ts"), now - ONE_DAY_S);
    touch(join(root, "a", "deep", "new.ts"), now);
    const result = maxMtime(join(root, "a"));
    assert.ok(Math.abs(result / 1000 - now) < 5, `expected ~now, got ${result / 1000} vs ${now}`);
  });
});

describe("isStale", () => {
  function setupPkg(opts: { srcMtimeS?: number; distMtimeS?: number; pkgJsonMtimeS?: number }): string {
    const pkgDir = join(root, "pkg");
    mkdirSync(pkgDir);
    touch(join(pkgDir, "package.json"), opts.pkgJsonMtimeS ?? 0);
    if (opts.srcMtimeS !== undefined) touch(join(pkgDir, "src", "index.ts"), opts.srcMtimeS);
    if (opts.distMtimeS !== undefined) touch(join(pkgDir, "dist", "index.js"), opts.distMtimeS);
    return pkgDir;
  }

  it("treats a missing dist/ as stale (cold-start path)", () => {
    const now = Date.now() / 1000;
    const pkg = setupPkg({ srcMtimeS: now, pkgJsonMtimeS: now });
    assert.equal(isStale(pkg), true);
  });

  it("returns false when dist/ is newer than src/", () => {
    const now = Date.now() / 1000;
    const pkg = setupPkg({ srcMtimeS: now - ONE_DAY_S, distMtimeS: now, pkgJsonMtimeS: now - ONE_DAY_S });
    assert.equal(isStale(pkg), false);
  });

  it("returns true when src/ is newer than dist/", () => {
    const now = Date.now() / 1000;
    const pkg = setupPkg({ srcMtimeS: now, distMtimeS: now - ONE_DAY_S, pkgJsonMtimeS: now - ONE_DAY_S });
    assert.equal(isStale(pkg), true);
  });

  it("returns true when package.json was bumped after the last build (deps / exports changed)", () => {
    const now = Date.now() / 1000;
    const pkg = setupPkg({ srcMtimeS: now - ONE_DAY_S, distMtimeS: now - ONE_DAY_S / 2, pkgJsonMtimeS: now });
    assert.equal(isStale(pkg), true);
  });

  it("returns false when src/ is missing (fully empty package — degenerate)", () => {
    // Defensive: a package with `dist/` but no `src/` shouldn't loop on
    // a phantom rebuild. `maxMtime("src")` returns 0, package.json is the
    // only input, dist exists → not stale.
    const now = Date.now() / 1000;
    const pkg = setupPkg({ distMtimeS: now, pkgJsonMtimeS: now - ONE_DAY_S });
    assert.equal(isStale(pkg), false);
  });
});
