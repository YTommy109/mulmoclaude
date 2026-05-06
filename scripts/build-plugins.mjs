#!/usr/bin/env node
//
// Glob-discovers every runtime plugin package under `packages/*-plugin`
// and runs `yarn workspace <name> run build` against each in parallel,
// fail-fast on the first non-zero exit.
//
// Replaces the explicit `concurrently --kill-others-on-fail "yarn
// workspace @mulmoclaude/X run build" ...` enumeration that used to
// live in `package.json`'s `build:packages` / `build:packages:dev`
// scripts. Adding a new runtime plugin no longer requires editing
// `package.json` — `mkdir packages/<name>-plugin/` is enough.
//
// Selection rule: a directory under `packages/` is treated as a
// runtime plugin when its `package.json` has BOTH:
//   - `name` starting with `@mulmoclaude/` AND ending with `-plugin`
//   - a `scripts.build` entry
// This excludes `create-mulmoclaude-plugin` (the scaffolder, no
// `@mulmoclaude/` scope), bridges (under `packages/bridges/`), and
// any other workspace not matching the runtime-plugin convention.
//
// yarn 1 / yarn 4 portability: this script only spawns
// `yarn workspace <name> run build`, which is identical syntax in
// both. The CI yarn4_smoke workflow exercises this script under
// yarn 4 and lint_test runs it under yarn 1.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGES_DIR = path.resolve(__dirname, "..", "packages");

function findRuntimePluginPackages() {
  const found = [];
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(PACKAGES_DIR, entry.name, "package.json");
    if (!existsSync(pkgJsonPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    } catch {
      continue;
    }
    const { name, scripts } = pkg ?? {};
    if (typeof name !== "string") continue;
    if (!name.startsWith("@mulmoclaude/")) continue;
    if (!name.endsWith("-plugin")) continue;
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
  const plugins = findRuntimePluginPackages();
  if (plugins.length === 0) {
    console.error("[build-plugins] no @mulmoclaude/*-plugin packages with a build script found under packages/");
    process.exit(1);
  }
  console.log(`[build-plugins] building ${plugins.length} plugin(s) in parallel: ${plugins.join(", ")}`);

  // Promise.all rejects on first failure, but the other in-flight
  // builds keep running until they finish on their own. That matches
  // `concurrently --kill-others-on-fail` semantics closely enough for
  // our use — we surface the first error and bail with non-zero. If
  // we ever need true kill-others, swap in AbortController + child.kill().
  try {
    await Promise.all(plugins.map(runOne));
  } catch (err) {
    console.error(`[build-plugins] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

await main();
