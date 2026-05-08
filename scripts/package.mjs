#!/usr/bin/env node
// Build the full app and produce a publishable tarball at
// `packages/mulmoclaude/mulmoclaude-<version>.tgz`. Wired up as
// `yarn package` so the testing flow (build → prepare-dist → pack)
// is one command instead of three.
//
// `npm pack` triggers the `prepack` hook in
// `packages/mulmoclaude/package.json`, which runs
// `bin/prepare-dist.js` to copy `dist/client/` + `server/` + `src/`
// into the package — no manual prepare step needed.
//
// To install the tarball locally for a smoke test:
//
//   mkdir /tmp/mc-test && cd /tmp/mc-test
//   npm init -y
//   npm install /abs/path/to/mulmoclaude-<X.Y.Z>.tgz
//   ./node_modules/.bin/mulmoclaude --no-open --port 3099

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG_DIR = join(REPO_ROOT, "packages/mulmoclaude");

console.log("[package] yarn build");
execSync("yarn build", { cwd: REPO_ROOT, stdio: "inherit" });

console.log("[package] npm pack (runs prepack → prepare-dist.js)");
execSync("npm pack", { cwd: PKG_DIR, stdio: "inherit" });

const { version } = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf-8"));
const tarball = join(PKG_DIR, `mulmoclaude-${version}.tgz`);
console.log(`\n[package] ✓ ${tarball}`);
