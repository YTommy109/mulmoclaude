// Backwards-compat shim — all helpers moved to server/utils/files/
// as part of issue #366. This file re-exports so existing import
// paths keep working. Will be removed after Phase 5 migration.

export {
  loadJsonFile,
  saveJsonFile,
  writeFileAtomic,
  writeJsonAtomic,
  readJsonOrNull,
  type WriteAtomicOptions,
} from "./files/index.js";
