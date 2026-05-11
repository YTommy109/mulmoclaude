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

test("StackView forwards googleMapKey via the gating helper on every plugin <component :is> mount", () => {
  const src = readSource("src/components/StackView.vue");
  // Both render branches must go through `googleMapKeyFor(...)` so
  // non-mapControl plugins do NOT receive the key (Codex security
  // review on PR #1241).
  const matches = src.match(/:google-map-key="googleMapKeyFor\(/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `Expected :google-map-key bound via googleMapKeyFor() in both render branches (>=2 sites); found ${matches.length}.\n` +
      'Direct bindings like :google-map-key="googleMapKey" leak the key to every plugin — must go through the gate.',
  );
  // And ensure the gate itself only releases the key for mapControl.
  assert.match(src, /TOOL_NAMES\.mapControl[\s\S]*?googleMapKey/, "googleMapKeyFor() must compare toolName against TOOL_NAMES.mapControl");
});

test("App.vue forwards googleMapsApiKey to StackView and gates the single-layout component mount by toolName", () => {
  const src = readSource("src/App.vue");
  // Single layout: through the gating helper, NOT a raw binding.
  assert.match(
    src,
    /:google-map-key="googleMapKeyFor\(selectedResult\.toolName\)"/,
    "App.vue must bind :google-map-key via googleMapKeyFor() in the single-layout dynamic <component> mount — direct binding leaks the key to non-map plugins",
  );
  // The gating helper itself.
  assert.match(
    src,
    /TOOL_NAMES\.mapControl\s*\?\s*googleMapsApiKey\.value\s*:\s*null/,
    "App.vue must define googleMapKeyFor() that gates by TOOL_NAMES.mapControl",
  );
  // Stack layout: forwards the raw key to <StackView>; StackView
  // applies the same per-result gate internally.
  assert.match(
    src,
    /<StackView[\s\S]*?:google-map-key="googleMapsApiKey"[\s\S]*?\/>/,
    "App.vue must forward :google-map-key to <StackView> so stack-layout map cards can receive the configured key (StackView applies the per-result gate)",
  );
});
