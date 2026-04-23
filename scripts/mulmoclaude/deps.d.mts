// Type declarations for deps.mjs. Kept as a sidecar so the script
// itself stays plain JS (easier to run with `node` on a fresh clone
// without any build step) while still giving consumers — tests and
// future smoke.mjs — a typed import surface.

export function isNodeBuiltin(specifier: string): boolean;

export function packageRoot(specifier: string): string;

export function extractBareImports(source: string): Set<string>;

export function walkTsFiles(dir: string): Promise<string[]>;

export function collectBareImports(dir: string): Promise<Set<string>>;

export interface AuditOptions {
  /** Repo root. Defaults to `process.cwd()`. */
  root?: string;
  /** Directory to scan. Defaults to `<root>/server`. */
  serverDir?: string;
  /** package.json whose `dependencies` define the allowlist. */
  packageJsonPath?: string;
}

/** Returns package names imported by `serverDir` but not declared in the target package.json. Sorted, deduplicated, built-ins filtered. */
export function auditServerDeps(options?: AuditOptions): Promise<string[]>;

/** CLI entry point. Returns 0 on clean, 1 if anything is missing. */
export function main(): Promise<number>;
