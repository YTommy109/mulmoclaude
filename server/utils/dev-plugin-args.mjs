// Shared `--dev-plugin` argv parser for the npm launcher
// (`packages/mulmoclaude/bin/mulmoclaude.js`) and any other Node entry
// point that needs to interpret the same flags.
//
// Kept as plain `.mjs` for the same reason as `port.mjs`: the launcher
// runs BEFORE tsx is wired up, so it can't import from a `.ts` file.
// Sibling `dev-plugin-args.d.mts` carries the type declarations.
//
// The parser is pure — no `process.cwd()`, no `console.*`, no
// `process.exit()`. The caller passes argv + cwd in, and decides what
// to log and when to exit. That keeps it unit-testable from
// node:test without spawning subprocesses.

import path from "node:path";

/** Parse repeated `--dev-plugin <path>` flags out of argv.
 *
 *  Returns one of:
 *    { ok: true, resolved: [{ rawInput, absPath }] }
 *    { ok: false, reason }
 *
 *  Errors are surfaced as a single human-readable string so the caller
 *  can write it to stderr. The launcher's invariants are:
 *    - missing argument value (`--dev-plugin` at end of argv, or
 *      followed by another `-`-prefixed flag) → reject
 *    - relative paths resolve against `cwd`
 *    - duplicate flags are accumulated in argv order; the caller
 *      detects same-name collisions later, against the resolved package
 *      names from disk.
 */
export function parseDevPluginArgs(argv, cwd) {
  const resolved = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--dev-plugin") continue;
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith("-")) {
      return { ok: false, reason: "--dev-plugin requires a path argument" };
    }
    resolved.push({ rawInput: raw, absPath: path.resolve(cwd, raw) });
    i++;
  }
  return { ok: true, resolved };
}
