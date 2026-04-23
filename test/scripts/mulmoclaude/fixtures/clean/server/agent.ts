// Fixture: a clean server tree where every bare import is already
// declared in the neighbouring packages/mulmoclaude/package.json.
// `auditServerDeps` should report zero missing.

import express from "express";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { helper } from "./utils/helper";

// Exercise the multi-line import form too.
import {
  thing,
  //
  otherThing,
} from "@mulmobridge/protocol";

// And the side-effect form.
import "dotenv/config";

// A type-only re-export must still surface as a bare import because
// the ports in server/ use the same specifier pattern for types and
// runtime. (The audit doesn't care about type-only — it just needs
// the specifier resolvable.)
export type { ZodType } from "zod";

export function example(): void {
  void express;
  void z;
  void readFile;
  void path;
  void helper;
  void thing;
  void otherThing;
}
