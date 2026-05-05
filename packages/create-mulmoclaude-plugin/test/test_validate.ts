// Tests for plugin name validation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { directoryNameFor, validatePluginName } from "../src/validate.js";

describe("validatePluginName — accepts canonical shapes", () => {
  it("accepts unscoped lowercase + hyphens", () => {
    assert.equal(validatePluginName("my-plugin").ok, true);
    assert.equal(validatePluginName("counter").ok, true);
    assert.equal(validatePluginName("foo123-bar").ok, true);
  });

  it("accepts scoped names", () => {
    assert.equal(validatePluginName("@scope/plugin").ok, true);
    assert.equal(validatePluginName("@example/cool-plugin").ok, true);
  });

  it("accepts dots in the segment (npm-legal: foo.bar)", () => {
    assert.equal(validatePluginName("foo.bar").ok, true);
  });
});

describe("validatePluginName — rejects malformed inputs", () => {
  it("rejects empty", () => {
    assert.equal(validatePluginName("").ok, false);
  });

  it("rejects uppercase", () => {
    assert.equal(validatePluginName("MyPlugin").ok, false);
    assert.equal(validatePluginName("@Scope/plugin").ok, false);
  });

  it("rejects whitespace anywhere", () => {
    assert.equal(validatePluginName("my plugin").ok, false);
    assert.equal(validatePluginName("my-plugin ").ok, false);
  });

  it("rejects leading dot or underscore on unscoped names", () => {
    assert.equal(validatePluginName(".plugin").ok, false);
    assert.equal(validatePluginName("_plugin").ok, false);
  });

  it("rejects scoped names with empty parts", () => {
    assert.equal(validatePluginName("@/plugin").ok, false);
    assert.equal(validatePluginName("@scope/").ok, false);
    assert.equal(validatePluginName("@scope").ok, false);
  });

  it("rejects names that exceed 214 chars", () => {
    const long = "a".repeat(215);
    assert.equal(validatePluginName(long).ok, false);
  });

  it("rejects punctuation that isn't dot/hyphen/underscore", () => {
    assert.equal(validatePluginName("my!plugin").ok, false);
    assert.equal(validatePluginName("foo$bar").ok, false);
    assert.equal(validatePluginName("with/slash").ok, false);
  });

  it("rejects npm-reserved names that would fail at publish time", () => {
    assert.equal(validatePluginName("node_modules").ok, false);
    assert.equal(validatePluginName("favicon.ico").ok, false);
  });

  it("rejects Node built-in module names", () => {
    // builtinModules tracks per-Node-version; pick a few known stable ones
    assert.equal(validatePluginName("http").ok, false);
    assert.equal(validatePluginName("fs").ok, false);
    assert.equal(validatePluginName("crypto").ok, false);
    assert.equal(validatePluginName("path").ok, false);
  });

  it("still accepts the same names when scoped (npm permits @scope/http)", () => {
    assert.equal(validatePluginName("@example/http").ok, true);
    assert.equal(validatePluginName("@example/node_modules").ok, true);
  });
});

describe("directoryNameFor", () => {
  it("returns the name verbatim for unscoped packages", () => {
    assert.equal(directoryNameFor("my-plugin"), "my-plugin");
  });

  it("strips the scope from scoped packages", () => {
    assert.equal(directoryNameFor("@example/cool-plugin"), "cool-plugin");
    assert.equal(directoryNameFor("@scope/foo"), "foo");
  });
});
