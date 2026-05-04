#!/usr/bin/env tsx
// One-shot migration for #1145: relocate the built-in todo plugin's
// JSON data from `data/todos/` (the old static-plugin location) to
// `data/plugins/%40mulmoclaude%2Ftodo-plugin/` (the runtime-plugin
// scope root used by the same package after the migration).
//
// Background: the todo plugin moved out of `src/plugins/todo/` +
// `server/api/routes/todos.ts` into `packages/todo-plugin/` and
// loads as a runtime plugin. Runtime plugins persist their data
// under `data/plugins/<encoded-package-name>/`, so the existing
// `todos.json` and `columns.json` in `data/todos/` need to migrate
// or the user's items disappear from the UI on first launch.
//
// Usage:
//   npx tsx scripts/migrate-todos-to-plugin.ts              # dry-run
//   npx tsx scripts/migrate-todos-to-plugin.ts --write      # apply
//   npx tsx scripts/migrate-todos-to-plugin.ts --root=/tmp/ws  # override
//
// Idempotent: re-running after a successful migration is a no-op.
// If both source and destination exist, the script logs a warning
// and skips that file rather than overwriting destination data.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

interface CliArgs {
  write: boolean;
  root: string;
}

const SRC_DIR = "data/todos";
const DST_DIR = "data/plugins/%40mulmoclaude%2Ftodo-plugin";
const FILES = ["todos.json", "columns.json"] as const;

function parseArgs(argv: readonly string[]): CliArgs {
  let write = false;
  let root = path.join(os.homedir(), "mulmoclaude");
  for (const arg of argv) {
    if (arg === "--write") {
      write = true;
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  return { write, root };
}

function printHelp(): void {
  console.error(`Usage: migrate-todos-to-plugin.ts [--write] [--root=<path>]

  --write           Apply changes (default is dry-run).
  --root=<path>     Workspace root (default: ~/mulmoclaude).
`);
}

interface MoveResult {
  file: string;
  status: "moved" | "would-move" | "absent" | "already-migrated" | "conflict";
}

async function migrateFile(args: CliArgs, fileName: string): Promise<MoveResult> {
  const srcAbs = path.join(args.root, SRC_DIR, fileName);
  const dstAbs = path.join(args.root, DST_DIR, fileName);

  const srcExists = fs.existsSync(srcAbs);
  const dstExists = fs.existsSync(dstAbs);

  if (!srcExists && !dstExists) return { file: fileName, status: "absent" };
  if (!srcExists && dstExists) return { file: fileName, status: "already-migrated" };
  if (srcExists && dstExists) {
    console.error(`  ${fileName}: BOTH source and destination exist — skipping (manual review required: ${srcAbs} vs ${dstAbs})`);
    return { file: fileName, status: "conflict" };
  }

  if (!args.write) return { file: fileName, status: "would-move" };

  await fs.promises.mkdir(path.dirname(dstAbs), { recursive: true });
  await fs.promises.rename(srcAbs, dstAbs);
  return { file: fileName, status: "moved" };
}

async function removeEmptySourceDir(args: CliArgs): Promise<void> {
  const srcDirAbs = path.join(args.root, SRC_DIR);
  if (!fs.existsSync(srcDirAbs)) return;
  const entries = await fs.promises.readdir(srcDirAbs);
  if (entries.length > 0) return;
  if (!args.write) {
    console.error(`  ${SRC_DIR}/ would be removed (empty after migration).`);
    return;
  }
  await fs.promises.rmdir(srcDirAbs);
  console.error(`  ${SRC_DIR}/ removed (was empty).`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.root)) {
    console.error(`Workspace root not found: ${args.root}`);
    process.exit(1);
  }
  console.error(`Workspace root: ${args.root}`);
  console.error(`Mode: ${args.write ? "WRITE" : "dry-run"}`);
  console.error("");

  const results: MoveResult[] = [];
  for (const fileName of FILES) {
    results.push(await migrateFile(args, fileName));
  }

  for (const result of results) {
    const tag = result.status.toUpperCase();
    console.log(`${tag.padEnd(18)} ${result.file}`);
  }

  const movedOrPending = results.filter((result) => result.status === "moved" || result.status === "would-move").length;
  const conflicts = results.filter((result) => result.status === "conflict").length;

  if (movedOrPending === 0 && conflicts === 0) {
    console.error("");
    console.error("Nothing to do.");
    return;
  }

  if (movedOrPending > 0) {
    await removeEmptySourceDir(args);
  }

  console.error("");
  if (args.write) {
    console.error(`Migrated ${results.filter((result) => result.status === "moved").length} file(s).`);
  } else {
    console.error(`Would migrate ${movedOrPending} file(s). Re-run with --write to apply.`);
  }
  if (conflicts > 0) {
    console.error(`${conflicts} conflict(s) require manual review.`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
