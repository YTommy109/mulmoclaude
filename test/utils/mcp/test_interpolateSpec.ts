import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpolateMcpSpec } from "../../../src/utils/mcp/interpolateSpec.js";
import type { McpServerSpec } from "../../../src/config/mcpTypes.js";

describe("interpolateMcpSpec — stdio", () => {
  it("substitutes ${VAR} in env values", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_API_KEY: "${NOTION_API_KEY}" },
    };
    const out = interpolateMcpSpec(template, { NOTION_API_KEY: "secret_abc" }, new Set(["NOTION_API_KEY"]));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.spec, {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_API_KEY: "secret_abc" },
    });
  });

  it("substitutes ${VAR} in args entries", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      args: ["-y", "some-server", "--token=${TOKEN}"],
    };
    const out = interpolateMcpSpec(template, { TOKEN: "xoxb-123" }, new Set(["TOKEN"]));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.spec.type === "stdio" ? out.spec.args : null, ["-y", "some-server", "--token=xoxb-123"]);
  });

  it("returns missing[] when a required key has no value", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { A: "${A}", B: "${B}" },
    };
    const out = interpolateMcpSpec(template, { A: "v" }, new Set(["A", "B"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing, ["B"]);
  });

  it("collects multiple missing required keys", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { A: "${A}", B: "${B}", C: "${C}" },
    };
    const out = interpolateMcpSpec(template, {}, new Set(["A", "B", "C"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing.sort(), ["A", "B", "C"]);
  });

  it("collapses optional placeholders to empty string when missing", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { OPTIONAL: "prefix-${OPT}" },
    };
    const out = interpolateMcpSpec(template, {}, new Set());
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.spec.type === "stdio" ? out.spec.env : null, { OPTIONAL: "prefix-" });
  });

  it("treats empty string the same as missing for required keys", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { TOKEN: "${TOKEN}" },
    };
    const out = interpolateMcpSpec(template, { TOKEN: "" }, new Set(["TOKEN"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing, ["TOKEN"]);
  });
});

describe("interpolateMcpSpec — http", () => {
  it("substitutes ${VAR} in url and headers", () => {
    const template: McpServerSpec = {
      type: "http",
      url: "https://api.example.com/${REGION}/mcp",
      headers: { Authorization: "Bearer ${TOKEN}" },
    };
    const out = interpolateMcpSpec(template, { REGION: "us", TOKEN: "abc" }, new Set(["REGION", "TOKEN"]));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.spec, {
      type: "http",
      url: "https://api.example.com/us/mcp",
      headers: { Authorization: "Bearer abc" },
    });
  });

  it("returns missing[] for required url placeholder", () => {
    const template: McpServerSpec = { type: "http", url: "https://${HOST}/" };
    const out = interpolateMcpSpec(template, {}, new Set(["HOST"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing, ["HOST"]);
  });
});

describe("interpolateMcpSpec — passthrough", () => {
  it("preserves enabled flag when present", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      enabled: false,
    };
    const out = interpolateMcpSpec(template, {}, new Set());
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.spec.enabled, false);
  });

  it("does not invent fields when args/env are absent", () => {
    const template: McpServerSpec = { type: "stdio", command: "npx" };
    const out = interpolateMcpSpec(template, {}, new Set());
    assert.equal(out.ok, true);
    if (!out.ok) return;
    if (out.spec.type !== "stdio") {
      assert.fail("expected stdio");
      return;
    }
    assert.equal(out.spec.args, undefined);
    assert.equal(out.spec.env, undefined);
  });
});
