// Backwards-compat shim — all helpers moved to server/utils/files/
// as part of issue #366. This file re-exports so existing import
// paths keep working. Will be removed after Phase 5 migration.

export {
  statSafe,
  statSafeAsync,
  readDirSafe,
  readDirSafeAsync,
  readTextOrNull,
  resolveWithinRoot,
} from "./files/index.js";
