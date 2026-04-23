// Nested file — proves the walker recurses and that relative imports
// are (correctly) ignored.
import { readFile } from "node:fs/promises";

export async function helper(p: string): Promise<string> {
  return readFile(p, "utf8");
}
