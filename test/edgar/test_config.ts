// Pin the self-healing missing-config payload shape. The MCP
// bridge surfaces `instructions` to the LLM verbatim, and the
// LLM uses the absolute `path` from this payload to write the
// config file via its built-in Write tool. A regression that
// drops `path` or splits the payload across `data` (which would
// trigger an unwanted frontend canvas push) breaks the
// self-healing flow silently.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { homedir } from "node:os";

import { configAbsolutePath, missingConfigResponse } from "../../server/edgar/config.js";

describe("edgar config — missingConfigResponse", () => {
  it("returns the documented self-healing shape", () => {
    const payload = missingConfigResponse();
    assert.equal(payload.error, "config_required");
    assert.equal(typeof payload.instructions, "string");
    assert.ok(payload.instructions.length > 0);
    assert.equal(typeof payload.path, "string");
    assert.deepEqual(payload.schema, { name: "<user's full name>", email: "<user's email address>" });
  });

  it("does NOT include a `data` field (would trigger a frontend canvas push)", () => {
    const payload = missingConfigResponse() as Record<string, unknown>;
    assert.equal(payload.data, undefined);
  });

  it("instructions text includes a hard ask-the-user constraint", () => {
    const { instructions } = missingConfigResponse();
    // Soft-checks the prompt language — if these phrases are
    // dropped in a future copy edit, the reviewer should
    // confirm the LLM still understands "ask the user, never
    // invent". The exact wording can change; the intent must
    // remain.
    assert.match(instructions, /ask the user/i);
    assert.match(instructions, /never invent/i);
  });
});

describe("edgar config — configAbsolutePath", () => {
  it("resolves under the workspace root, not under tmp / encoded segments", () => {
    const abs = configAbsolutePath();
    const expected = path.join(homedir(), "mulmoclaude", "config", "plugins", "edgar", "config.json");
    assert.equal(abs, expected);
  });
});
