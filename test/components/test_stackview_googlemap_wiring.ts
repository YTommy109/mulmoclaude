// Regression check: `googleMapKey` must reach plugin Views in BOTH
// the single-layout `<component :is>` mount in `App.vue` AND the
// stack-layout mounts inside `StackView.vue`. This caught a Codex
// finding on PR #1241 where the prop was wired only in single
// layout, leaving stack-mode mapControl cards silently broken.
//
// The repo doesn't have Vue component unit-test infrastructure
// today (e2e/ covers that surface). For a lightweight regression
// guard, this test parses the source files and asserts the
// declarations / bindings are present. A future renamer or
// restructure that drops the prop from a render branch will trip
// the assertion at unit-test time, ahead of the e2e run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readSource(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

test("StackView declares googleMapKey as an optional string prop", () => {
  const src = readSource("src/components/StackView.vue");
  // Be tolerant of whitespace + comments around the entry.
  assert.match(src, /googleMapKey\??:\s*string\s*\|\s*null/, "StackView's defineProps must declare `googleMapKey?: string | null`");
});

test("StackView forwards googleMapKey on every plugin <component :is> mount", () => {
  const src = readSource("src/components/StackView.vue");
  // Count occurrences of the binding. The template has TWO render
  // branches (stack-natural + fixed-height), each must forward.
  const matches = src.match(/:google-map-key="googleMapKey"/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `Expected :google-map-key forwarded in both render branches (>=2 sites); found ${matches.length}.\n` +
      "If you removed a render branch, drop the assertion threshold; otherwise restore the binding so map cards aren't broken in stack layout.",
  );
});

test("App.vue forwards googleMapsApiKey to StackView and the single-layout component mount", () => {
  const src = readSource("src/App.vue");
  // Single layout: directly on the dynamic <component :is>.
  assert.match(src, /:google-map-key="googleMapsApiKey"/, "App.vue must bind :google-map-key on the chat tool result <component :is> mount");
  // Stack layout: as an attribute on the StackView usage.
  assert.match(
    src,
    /<StackView[\s\S]*?:google-map-key="googleMapsApiKey"[\s\S]*?\/>/,
    "App.vue must forward :google-map-key to <StackView> so stack-layout map cards receive the configured key",
  );
});
