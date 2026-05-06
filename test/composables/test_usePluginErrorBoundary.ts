import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { usePluginErrorBoundary } from "../../src/composables/usePluginErrorBoundary.ts";

// Silence the deliberate `console.error` calls from `captureError`.
// We assert on the boundary's state, not on the log line.
const originalError = console.error;
console.error = () => {};
process.on("exit", () => {
  console.error = originalError;
});

describe("usePluginErrorBoundary", () => {
  it("starts clean", () => {
    const boundary = usePluginErrorBoundary("foo");
    assert.equal(boundary.error.value, null);
    assert.equal(boundary.showDetails.value, false);
    assert.equal(boundary.mountKey.value, 0);
    assert.equal(boundary.errorDetails.value, "");
  });

  it("captureError flips error state and exposes a composed details string", () => {
    const boundary = usePluginErrorBoundary("foo");
    boundary.captureError(new Error("boom"));
    assert.ok(boundary.error.value instanceof Error);
    assert.equal(boundary.error.value?.message, "boom");
    assert.match(boundary.errorDetails.value, /^boom/);
  });

  it("captureError coerces a non-Error throw to an Error", () => {
    const boundary = usePluginErrorBoundary("foo");
    boundary.captureError("string-thrown");
    assert.ok(boundary.error.value instanceof Error);
    assert.equal(boundary.error.value?.message, "string-thrown");
  });

  it("retry clears error, hides details, and bumps mountKey to remount the subtree", () => {
    const boundary = usePluginErrorBoundary("foo");
    boundary.captureError(new Error("boom"));
    boundary.showDetails.value = true;
    const keyBefore = boundary.mountKey.value;
    boundary.retry();
    assert.equal(boundary.error.value, null);
    assert.equal(boundary.showDetails.value, false);
    assert.equal(boundary.mountKey.value, keyBefore + 1);
  });

  it("a second error after retry re-enters the fallback (transient-bug case)", () => {
    const boundary = usePluginErrorBoundary("foo");
    boundary.captureError(new Error("first"));
    assert.equal(boundary.error.value?.message, "first");
    boundary.retry();
    boundary.captureError(new Error("second"));
    assert.equal(boundary.error.value?.message, "second");
  });
});
