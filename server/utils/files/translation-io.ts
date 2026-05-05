// Domain file I/O for the translation cache. One JSON file per
// namespace under `data/translation/`. All writes go through the
// atomic helper per project rule.

import path from "node:path";
import { WORKSPACE_DIRS, workspacePath } from "../../workspace/paths.js";
import { loadJsonFile, writeJsonAtomic } from "./json.js";
import { emptyDictionary } from "../../services/translation/cache.js";
import type { DictionaryFile } from "../../services/translation/types.js";

function root(workspaceRoot?: string): string {
  return workspaceRoot ?? workspacePath;
}

export function dictionaryPath(namespace: string, workspaceRoot?: string): string {
  return path.join(root(workspaceRoot), WORKSPACE_DIRS.translation, `${namespace}.json`);
}

export function loadDictionary(namespace: string, workspaceRoot?: string): DictionaryFile {
  return loadJsonFile<DictionaryFile>(dictionaryPath(namespace, workspaceRoot), emptyDictionary());
}

export async function saveDictionary(namespace: string, dict: DictionaryFile, workspaceRoot?: string): Promise<void> {
  await writeJsonAtomic(dictionaryPath(namespace, workspaceRoot), dict);
}
