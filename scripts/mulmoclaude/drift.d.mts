// Type declarations for drift.mjs. Sidecar keeps the script plain
// JS (no build step for the CI/script path) while tests + the
// future smoke driver still get a typed import surface.

/** One entry from a successful drift scan. `status` encodes the verdict. */
export interface PackageDriftResult {
  packageBaseName: string;
  localVersion: string | null;
  status: "ok" | "drifted" | "skipped";
  /** Present when `status` is "ok" or "drifted". */
  localCount?: number;
  /** Present when `status` is "ok" or "drifted". */
  distCount?: number;
  /** Present when `status` is "skipped" — human-readable explanation. */
  reason?: string;
}

export function countValueExportLines(source: string): number;

export interface CheckPackageDriftOptions {
  root?: string;
  /** Required at runtime — throws if omitted. Typed as optional so
   * tests can assert the throw without a `@ts-expect-error`. */
  packageBaseName?: string;
  srcRelative?: string;
  distRelative?: string;
  /** Override the `node_modules` path (used by fixtures that
   * can't ship a real node_modules/ — globally gitignored). */
  installedRoot?: string;
}

export function checkPackageDrift(options: CheckPackageDriftOptions): Promise<PackageDriftResult>;

export interface DetectOptions {
  root?: string;
}

export function detectMulmobridgeDeps(options?: DetectOptions): Promise<string[]>;

export interface CheckWorkspaceDriftOptions {
  root?: string;
  /** Overrides auto-detection when provided. */
  packageBaseNames?: string[];
  /** Override the `node_modules` path — passed through to every
   * per-package check. */
  installedRoot?: string;
  srcRelative?: string;
  distRelative?: string;
}

export function checkWorkspaceDrift(options?: CheckWorkspaceDriftOptions): Promise<PackageDriftResult[]>;

/** CLI entry point. Returns 0 on clean, 1 if any package drifted. */
export function main(): Promise<number>;
