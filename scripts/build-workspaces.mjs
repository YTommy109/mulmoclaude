#!/usr/bin/env node
//
// Glob-discovers workspace packages under a given directory and
// runs `yarn workspace <name> run build` against each in parallel,
// fail-fast on the first non-zero exit. Replaces the verbose explicit
// enumerations that used to live in `package.json`'s `build:packages`
// / `build:packages:dev` scripts.
//
// Usage:
//
//   node scripts/build-workspaces.mjs <relDir> <scope> [--name-suffix=<suffix>]
//
// Examples:
//
//   # All bridges under packages/bridges/* whose name starts with "@mulmobridge/":
//   node scripts/build-workspaces.mjs packages/bridges @mulmobridge
//
//   # All runtime plugins under packages/* whose name is "@mulmoclaude/<x>-plugin":
//   node scripts/build-workspaces.mjs packages @mulmoclaude --name-suffix=-plugin
//
// Selection rule: a directory under <relDir> is included when its
// `package.json` has BOTH:
//   - `name` starting with the <scope> argument (followed by `/`),
//     and ending with the optional `--name-suffix` value
//   - a `scripts.build` entry
//
// yarn 1 / yarn 4 portability: this script only spawns
// `yarn workspace <name> run build`, identical syntax in both. The
// CI yarn4_smoke workflow exercises this script under yarn 4 and
// lint_test runs it under yarn 1.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const positional = [];
  let nameSuffix = "";
  for (const arg of argv) {
    if (arg.startsWith("--name-suffix=")) {
      nameSuffix = arg.slice("--name-suffix=".length);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) {
    console.error("usage: build-workspaces.mjs <relDir> <scope> [--name-suffix=<suffix>]");
    process.exit(2);
  }
  const [relDir, scope] = positional;
  if (!scope.startsWith("@")) {
    console.error(`[build-workspaces] scope must start with '@' (got: ${scope})`);
    process.exit(2);
  }
  return { relDir, scope, nameSuffix };
}

function findWorkspaces({ relDir, scope, nameSuffix }) {
  const absDir = path.resolve(REPO_ROOT, relDir);
  if (!existsSync(absDir)) {
    console.error(`[build-workspaces] directory not found: ${relDir}`);
    process.exit(1);
  }
  const scopePrefix = `${scope}/`;
  const found = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(absDir, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    } catch (err) {
      // Log + skip rather than crash — a single broken package.json
      // shouldn't take down the whole build, but it should be visible
      // so the misconfigured workspace is easy to find. Sourcery review
      // on PR #1189.
      console.warn(`[build-workspaces] skipping ${pkgJsonPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const { name, scripts } = pkg ?? {};
    if (typeof name !== "string") continue;
    if (!name.startsWith(scopePrefix)) continue;
    if (nameSuffix && !name.endsWith(nameSuffix)) continue;
    if (!scripts || typeof scripts.build !== "string") continue;
    found.push(name);
  }
  found.sort();
  return found;
}

function runOne(pkgName) {
  return new Promise((resolve, reject) => {
    const child = spawn("yarn", ["workspace", pkgName, "run", "build"], {
      stdio: ["ignore", "pipe", "pipe"],
      // Spawn through a shell on Windows so `yarn.cmd` is found via
      // PATH; macOS / Linux honour the no-shell variant for
      // predictable signal handling.
      shell: process.platform === "win32",
    });
    const prefix = `[${pkgName}]`;
    const stamp = (chunk, stream) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) stream.write(`${prefix} ${line}\n`);
      }
    };
    child.stdout.on("data", (chunk) => stamp(chunk, process.stdout));
    child.stderr.on("data", (chunk) => stamp(chunk, process.stderr));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else if (signal) reject(new Error(`${pkgName} terminated by ${signal}`));
      else reject(new Error(`${pkgName} exited with code ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaces = findWorkspaces(args);
  if (workspaces.length === 0) {
    console.error(`[build-workspaces] no packages matching scope=${args.scope}` + (args.nameSuffix ? ` suffix=${args.nameSuffix}` : "") + ` under ${args.relDir}`);
    process.exit(1);
  }
  console.log(`[build-workspaces] building ${workspaces.length} package(s) in parallel under ${args.relDir}: ${workspaces.join(", ")}`);

  // Promise.all rejects on first failure, but the other in-flight
  // builds keep running until they finish on their own. That matches
  // `concurrently --kill-others-on-fail` semantics closely enough for
  // our use — we surface the first error and bail with non-zero. If
  // we ever need true kill-others, swap in AbortController + child.kill().
  try {
    await Promise.all(workspaces.map(runOne));
  } catch (err) {
    console.error(`[build-workspaces] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

await main();
