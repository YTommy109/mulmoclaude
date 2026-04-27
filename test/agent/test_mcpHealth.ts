import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractNpxPackage } from "../../server/agent/mcpHealth.js";

describe("extractNpxPackage", () => {
  it("returns the package name from `npx -y <pkg>`", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "spotify-mcp"]), "spotify-mcp");
  });

  it("strips the @version suffix from a versioned arg", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "spotify-mcp@latest"]), "spotify-mcp");
    assert.equal(extractNpxPackage("npx", ["-y", "foo@1.2.3"]), "foo");
  });

  it("preserves the leading @ for scoped packages", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "@scope/pkg"]), "@scope/pkg");
    assert.equal(extractNpxPackage("npx", ["-y", "@scope/pkg@2.0.0"]), "@scope/pkg");
  });

  it("skips short and long flags before the package", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "--verbose", "@modelcontextprotocol/server-github"]), "@modelcontextprotocol/server-github");
  });

  it("works with absolute path npx (workspace-local node_modules)", () => {
    assert.equal(extractNpxPackage("/usr/bin/npx", ["-y", "foo"]), "foo");
    assert.equal(extractNpxPackage("/Users/me/project/node_modules/.bin/npx", ["-y", "bar"]), "bar");
  });

  it("returns null for non-npx commands", () => {
    assert.equal(extractNpxPackage("node", ["-y", "foo"]), null);
    assert.equal(extractNpxPackage("python", ["-m", "foo"]), null);
  });

  it("returns null when args contain only flags", () => {
    assert.equal(extractNpxPackage("npx", ["-y", "--no-install"]), null);
  });

  it("returns null when args is missing or empty", () => {
    assert.equal(extractNpxPackage("npx", undefined), null);
    assert.equal(extractNpxPackage("npx", []), null);
  });
});
