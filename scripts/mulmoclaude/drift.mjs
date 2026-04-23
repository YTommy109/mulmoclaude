// @mulmobridge/* drift check (§2 of publish-mulmoclaude skill).
//
// Problem: a local `packages/<name>/src/` file adds a new runtime
// export without a version bump. `yarn install` keeps using the
// older dist/ already in node_modules, so consumers crash with:
//   does not provide an export named X
// at runtime — invisible to lint, typecheck, or local dev.
//
// Detection strategy (from the skill, unchanged):
//   count value-export LINES in src/index.ts
//   count value-export LINES in <installed dist>/index.js
//   if src > dist, the package has drifted and must be bumped.
//
// "Value export LINES" = every `^export …` line except ones that
// are entirely type-only (`export type …`, `export interface …`,
// `export { type … }`). Counting lines (not individual specifiers)
// is intentional — the skill has been using this heuristic across
// real releases and it's picked up every regression we've seen.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MULMOBRIDGE_SCOPE = "@mulmobridge/";
const DEFAULT_INSTALLED_ROOT = "node_modules";

// Returns how many `^export …` lines in `source` declare at least
// one runtime (value) export. Type-only lines are filtered.
//
// Matches only when `export` is at column 0 (no leading whitespace)
// to mirror the skill's `grep -E '^export'` exactly — indented
// `export` tokens inside namespaces or conditional blocks aren't
// module-level re-exports and shouldn't count.
export function countValueExportLines(source) {
  const lines = source.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    if (!line.startsWith("export")) continue;
    // `export type Foo = …` / `export interface Foo { … }`
    if (/^export\s+(?:type|interface)\b/.test(line)) continue;
    // `export { type Foo, type Bar }` — brace starts with `type`.
    // Matches the skill's heuristic even when the brace also has
    // runtime bindings (rare in practice).
    if (/^export\s*\{\s*type\b/.test(line)) continue;
    count += 1;
  }
  return count;
}

// Read the local workspace package.json for `<packageBaseName>` to
// surface its version string. Returns `null` if the file can't be
// read — not every @mulmobridge/* dep has a local workspace twin.
async function readLocalVersion(root, packageBaseName) {
  const pkgPath = path.join(root, "packages", packageBaseName, "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

// Inspect one package: compare local src value-export count with
// installed dist value-export count. If either file is missing,
// the package is reported as `skipped` with a reason so the CLI
// caller can decide whether to treat it as a failure or warning.
//
// `installedRoot` is overridable so fixture trees (which can't use
// a real `node_modules/` path — it's globally gitignored) can point
// the lookup at an alternate directory.
export async function checkPackageDrift({
  root = process.cwd(),
  packageBaseName,
  srcRelative = "src/index.ts",
  distRelative = "dist/index.js",
  installedRoot = DEFAULT_INSTALLED_ROOT,
} = {}) {
  if (!packageBaseName) {
    throw new Error("checkPackageDrift: packageBaseName is required");
  }
  const srcPath = path.join(root, "packages", packageBaseName, srcRelative);
  const distPath = path.join(root, installedRoot, MULMOBRIDGE_SCOPE + packageBaseName, distRelative);
  const localVersion = await readLocalVersion(root, packageBaseName);

  let srcSource;
  try {
    srcSource = await readFile(srcPath, "utf8");
  } catch {
    return { packageBaseName, localVersion, status: "skipped", reason: `local src not found at ${srcRelative}` };
  }

  let distSource;
  try {
    distSource = await readFile(distPath, "utf8");
  } catch {
    // Common when `yarn install` hasn't run yet, or when the dep
    // isn't in node_modules at this workspace level. Not an error —
    // the caller (CLI or smoke driver) decides.
    return { packageBaseName, localVersion, status: "skipped", reason: "installed dist not found (run yarn install first)" };
  }

  const localCount = countValueExportLines(srcSource);
  const distCount = countValueExportLines(distSource);
  const drifted = localCount > distCount;
  return {
    packageBaseName,
    localVersion,
    status: drifted ? "drifted" : "ok",
    localCount,
    distCount,
  };
}

// Auto-detect which @mulmobridge/* packages to check by reading the
// launcher's package.json. Only packages that ALSO exist as a local
// workspace (`packages/<name>/`) are returned — published-only deps
// can't drift against themselves.
export async function detectMulmobridgeDeps({ root = process.cwd() } = {}) {
  const pkgPath = path.join(root, "packages", "mulmoclaude", "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  const bridges = deps.filter((name) => name.startsWith(MULMOBRIDGE_SCOPE)).map((name) => name.slice(MULMOBRIDGE_SCOPE.length));
  const out = [];
  for (const name of bridges) {
    const localVersion = await readLocalVersion(root, name);
    if (localVersion !== null) out.push(name);
  }
  return out;
}

// Run checkPackageDrift against every auto-detected (or explicit)
// @mulmobridge/* workspace dep. Returns one result per package.
export async function checkWorkspaceDrift({
  root = process.cwd(),
  packageBaseNames,
  installedRoot = DEFAULT_INSTALLED_ROOT,
  srcRelative,
  distRelative,
} = {}) {
  const names = packageBaseNames ?? (await detectMulmobridgeDeps({ root }));
  const results = [];
  for (const name of names) {
    results.push(await checkPackageDrift({ root, packageBaseName: name, installedRoot, srcRelative, distRelative }));
  }
  return results;
}

function formatLine(result) {
  const { packageBaseName, localVersion, status } = result;
  const ver = localVersion ? `v${localVersion}` : "(no local version)";
  if (status === "drifted") {
    return `  ⚠ @mulmobridge/${packageBaseName} ${ver}: local has ${result.localCount} value-export lines, installed dist has ${result.distCount}`;
  }
  if (status === "skipped") {
    return `  · @mulmobridge/${packageBaseName} ${ver}: skipped — ${result.reason}`;
  }
  return `  ✓ @mulmobridge/${packageBaseName} ${ver}: ${result.localCount} value-export lines (src == dist)`;
}

// CLI: exits 1 if any package drifted, 0 otherwise. "skipped"
// results don't fail the check but are printed so the operator can
// decide if they should retry after `yarn install`.
export async function main() {
  const results = await checkWorkspaceDrift();
  for (const result of results) console.log(formatLine(result));
  const drifted = results.filter((result) => result.status === "drifted");
  if (drifted.length === 0) {
    console.log("[mulmoclaude:drift] OK — no workspace drift detected.");
    return 0;
  }
  console.error("");
  console.error(`[mulmoclaude:drift] ${drifted.length} package(s) drifted — bump + republish before publishing mulmoclaude.`);
  console.error("See .claude/skills/publish-mulmoclaude/SKILL.md §2 for the cascade-publish flow.");
  return 1;
}

// CLI entry point — same direct-run guard as deps.mjs so this file
// can be both imported and executed.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const code = await main();
  process.exit(code);
}
