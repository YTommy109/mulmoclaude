// Type declarations for dev-plugin-args.mjs. See the .mjs file for
// rationale on why the shared helper lives in plain JS.

export interface DevPluginArg {
  rawInput: string;
  absPath: string;
}

export type ParseDevPluginArgsResult = { ok: true; resolved: DevPluginArg[] } | { ok: false; reason: string };

export function parseDevPluginArgs(argv: readonly string[], cwd: string): ParseDevPluginArgsResult;
