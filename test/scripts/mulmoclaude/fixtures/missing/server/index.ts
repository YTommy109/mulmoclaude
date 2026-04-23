// Fixture: server tree that imports a package NOT declared in the
// package.json, so the audit must flag it.
//
// Also exercises:
//   - deep subpath stripping (`mammoth/lib/foo` → `mammoth`)
//   - scoped deep subpath (`@google/genai/deep/module` → `@google/genai`)
//   - node: prefix that must NOT be flagged even if someone adds
//     `node:crypto` to dependencies by accident
import mammoth from "mammoth/lib/foo";
import { bar } from "@google/genai/deep/module";
import { webcrypto } from "node:crypto";

// Something that IS declared — audit should not flag this.
import express from "express";

export function demo(): void {
  void mammoth;
  void bar;
  void webcrypto;
  void express;
}
