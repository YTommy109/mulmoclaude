// Tests for exe.dev-specific ALLOWED_HOSTS / ALLOWED_ORIGINS origin matching.
// Sets env vars BEFORE dynamically importing the module so the
// module-level sets are populated correctly.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";

// Module references populated in before().
let isTrustedOrigin: (origin: string, trustedOrigins: readonly string[]) => boolean;
let requireSameOrigin: (req: Request, res: Response, next: NextFunction) => void;

before(async () => {
  process.env.ALLOWED_ORIGINS = "https://exact.example.com:5173";
  process.env.ALLOWED_HOSTS = "wildcard.example.com,other.test";
  // Dynamically import after env vars are set so module-level constants are populated.
  ({ isTrustedOrigin, requireSameOrigin } = await import("../../server/api/csrfGuard.js"));
});

describe("isTrustedOrigin — full-origin match via ALLOWED_ORIGINS (in trustedOrigins)", () => {
  it("accepts exact origin when listed in trustedOrigins", () => {
    assert.equal(isTrustedOrigin("https://exact.example.com:5173", ["https://exact.example.com:5173"]), true);
  });

  it("rejects same host different port", () => {
    assert.equal(isTrustedOrigin("https://exact.example.com:3001", ["https://exact.example.com:5173"]), false);
  });

  it("rejects origin not in trustedOrigins", () => {
    assert.equal(isTrustedOrigin("https://other.example.com:5173", ["https://exact.example.com:5173"]), false);
  });
});

describe("isTrustedOrigin — hostname match via ALLOWED_HOSTS", () => {
  it("accepts any port on an allowed host", () => {
    assert.equal(isTrustedOrigin("https://wildcard.example.com:5173", []), true);
    assert.equal(isTrustedOrigin("https://wildcard.example.com:3001", []), true);
    assert.equal(isTrustedOrigin("https://wildcard.example.com:8080", []), true);
    assert.equal(isTrustedOrigin("http://wildcard.example.com", []), true);
  });

  it("accepts second allowed host", () => {
    assert.equal(isTrustedOrigin("https://other.test:4000", []), true);
  });

  it("rejects unlisted hostnames", () => {
    assert.equal(isTrustedOrigin("https://evil.example.com:5173", []), false);
    assert.equal(isTrustedOrigin("https://notother.test:4000", []), false);
  });

  it("rejects subdomain spoofing", () => {
    assert.equal(isTrustedOrigin("https://sub.wildcard.example.com:5173", []), false);
  });

  it("rejects empty and malformed inputs", () => {
    assert.equal(isTrustedOrigin("", []), false);
    assert.equal(isTrustedOrigin("not a url", []), false);
    assert.equal(isTrustedOrigin("null", []), false);
  });
});

// Middleware integration — requireSameOrigin uses env.trustedOrigins (includes ALLOWED_ORIGINS)

interface FakeReq {
  method: string;
  headers: Record<string, string | undefined>;
}

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
}

function makeReq(method: string, origin?: string): FakeReq {
  return {
    method,
    headers: origin === undefined ? {} : { origin },
  };
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function run(req: FakeReq, res: FakeRes): { nextCalled: boolean; statusCode: number; body: unknown } {
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  requireSameOrigin(req as unknown as Request, res as unknown as Response, next);
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

describe("requireSameOrigin — ALLOWED_HOSTS integration", () => {
  it("allows POST from any port on an ALLOWED_HOSTS hostname", () => {
    const { nextCalled, statusCode } = run(makeReq("POST", "https://wildcard.example.com:9999"), makeRes());
    assert.equal(nextCalled, true);
    assert.equal(statusCode, 200);
  });

  it("blocks POST from an unlisted hostname", () => {
    const { nextCalled, statusCode } = run(makeReq("POST", "https://evil.example.com:5173"), makeRes());
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });
});

describe("requireSameOrigin — ALLOWED_ORIGINS integration", () => {
  it("allows POST from exact origin in ALLOWED_ORIGINS", () => {
    const { nextCalled, statusCode } = run(makeReq("POST", "https://exact.example.com:5173"), makeRes());
    assert.equal(nextCalled, true);
    assert.equal(statusCode, 200);
  });

  it("blocks POST from same host but different port not in ALLOWED_ORIGINS", () => {
    const { nextCalled, statusCode } = run(makeReq("POST", "https://exact.example.com:9999"), makeRes());
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });
});
