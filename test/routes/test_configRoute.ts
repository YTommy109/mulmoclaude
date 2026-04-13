// Route-level checks for /api/config.
//
// The route logic itself is a thin wrapper around server/config.ts —
// load/save/validate. These tests cover:
//   - GET returns the current settings wrapped in { settings }
//   - PUT /config/settings validates shape + persists + returns the
//     re-read state (not the incoming payload, to catch write/read
//     drift)
//   - PUT rejects malformed bodies with HTTP 400
//
// Heavier integration — round-trips across the real Express stack
// including CSRF — is covered by e2e/tests/settings.spec.ts.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import type { Request, Response } from "express";

type ConfigModule = typeof import("../../server/config.js");
type RouteModule = typeof import("../../server/routes/config.js");

let tmpRoot: string;
let originalHome: string | undefined;
let configMod: ConfigModule;
let routeMod: RouteModule;

// Extract the two handlers from the Router so we can invoke them
// with plain req/res mocks (no supertest dependency).
type Handler = (req: Request, res: Response) => void;
let getHandler: Handler;
let putSettingsHandler: Handler;

interface RouteLayer {
  route?: { stack: Array<{ method: string; handle: Handler }> };
}

interface StackFrame {
  route?: {
    path: string;
    stack: Array<{ method: string; handle: Handler }>;
  };
}

interface RouterInternals {
  stack: StackFrame[];
}

function extractRouteHandler(
  mod: RouteModule,
  path: string,
  method: "get" | "put",
): Handler {
  const router = mod.default as unknown as RouterInternals;
  const frame = router.stack.find((f) => f.route?.path === path);
  if (!frame?.route) throw new Error(`route ${path} not registered`);
  const layer = frame.route.stack.find((s) => s.method === method);
  if (!layer) throw new Error(`method ${method} not found on ${path}`);
  return layer.handle;
}

function mockRes() {
  const state: {
    status: number;
    body: unknown;
    ended: boolean;
  } = { status: 200, body: undefined, ended: false };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      state.ended = true;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

before(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mulmo-config-route-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpRoot;
  fs.mkdirSync(path.join(tmpRoot, "mulmoclaude"), { recursive: true });
  configMod = await import("../../server/config.js");
  routeMod = await import("../../server/routes/config.js");
  getHandler = extractRouteHandler(routeMod, "/config", "get");
  putSettingsHandler = extractRouteHandler(routeMod, "/config/settings", "put");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /config", () => {
  beforeEach(() => {
    fs.rmSync(configMod.configsDir(), { recursive: true, force: true });
  });

  it("returns defaults when nothing is on disk", () => {
    const { state, res } = mockRes();
    getHandler({} as Request, res);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, {
      settings: { extraAllowedTools: [] },
      mcp: { servers: [] },
    });
  });

  it("returns the persisted settings", () => {
    configMod.saveSettings({
      extraAllowedTools: ["mcp__claude_ai_Gmail"],
    });
    const { state, res } = mockRes();
    getHandler({} as Request, res);
    assert.deepEqual(state.body, {
      settings: { extraAllowedTools: ["mcp__claude_ai_Gmail"] },
      mcp: { servers: [] },
    });
  });
});

describe("PUT /config/settings", () => {
  beforeEach(() => {
    fs.rmSync(configMod.configsDir(), { recursive: true, force: true });
  });

  it("persists a well-formed payload and echoes the re-read state", () => {
    const body = { extraAllowedTools: ["alpha", "beta"] };
    const { state, res } = mockRes();
    putSettingsHandler({ body } as Request, res);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { settings: body, mcp: { servers: [] } });
    assert.deepEqual(configMod.loadSettings(), body);
  });

  it("rejects invalid shape with 400", () => {
    const { state, res } = mockRes();
    putSettingsHandler(
      { body: { extraAllowedTools: "not-an-array" } } as Request,
      res,
    );
    assert.equal(state.status, 400);
    const body = state.body as { error: string };
    assert.match(body.error, /Invalid/);
  });

  it("rejects null body with 400", () => {
    const { state, res } = mockRes();
    putSettingsHandler({ body: null } as Request, res);
    assert.equal(state.status, 400);
  });

  it("rejects arrays containing non-strings", () => {
    const { state, res } = mockRes();
    putSettingsHandler(
      { body: { extraAllowedTools: ["ok", 42] } } as Request,
      res,
    );
    assert.equal(state.status, 400);
  });

  it("overwrites a prior save", () => {
    configMod.saveSettings({ extraAllowedTools: ["old"] });
    const { state, res } = mockRes();
    putSettingsHandler(
      { body: { extraAllowedTools: ["new"] } } as Request,
      res,
    );
    assert.equal(state.status, 200);
    assert.deepEqual(configMod.loadSettings().extraAllowedTools, ["new"]);
  });
});

// Suppress the "unused" warning for RouteLayer (kept for symmetry
// with StackFrame in case we need to introspect individual layers).
const _layerUnused: RouteLayer = {};
void _layerUnused;
