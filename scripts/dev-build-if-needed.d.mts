// Type declarations for the JS sibling so `tsc -p test/tsconfig.json`
// can resolve `import { isStale, maxMtime } from
// "../scripts/dev-build-if-needed.mjs"` without `allowJs: true`.

export declare const DEV_FOUNDATIONAL_DIRS: readonly string[];

export declare function devPackageDirs(repoRoot: string): readonly string[];

/** Latest mtime (ms) of any file under `dir`, recursively. 0 if missing. */
export declare function maxMtime(dir: string): number;

/** True when `<pkg>/dist/` is missing or older than the newest input. */
export declare function isStale(pkgDir: string): boolean;
