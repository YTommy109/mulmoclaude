// Unit tests for the pure helpers in `server/routes/files.ts`.
//
// Adjacent PRs (#146, #147) also add tests here for `parseRange`,
// `classify`, and `RAW_SECURITY_HEADERS`. Merge conflicts across
// those PRs are expected and should be resolved by combining the
// import list and the describe blocks — all tests are independent.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSensitivePath } from "../../server/routes/files.js";

describe("isSensitivePath — blocks secret files", () => {
  it("blocks a bare .env", () => {
    assert.equal(isSensitivePath(".env"), true);
  });

  it("blocks .env.<variant> files", () => {
    for (const name of [
      ".env.local",
      ".env.production",
      ".env.development",
      ".env.staging",
      ".env.test",
    ]) {
      assert.equal(isSensitivePath(name), true, `expected ${name} blocked`);
    }
  });

  it("blocks .env variants nested under subdirectories", () => {
    // The check is basename-based so it follows the file wherever
    // it lives in the tree.
    assert.equal(isSensitivePath("config/.env"), true);
    assert.equal(isSensitivePath("subdir/deeper/.env.local"), true);
  });

  it("is case-insensitive on .env", () => {
    // macOS / Windows are case-insensitive by default; a malicious
    // `.ENV` on either FS should still be rejected.
    assert.equal(isSensitivePath(".ENV"), true);
    assert.equal(isSensitivePath(".Env.Local"), true);
  });

  it("blocks SSH private keys but NOT their .pub counterparts", () => {
    for (const priv of ["id_rsa", "id_ecdsa", "id_ed25519", "id_dsa"]) {
      assert.equal(isSensitivePath(priv), true, `expected ${priv} blocked`);
    }
    // .pub files are public and safe to preview.
    assert.equal(isSensitivePath("id_rsa.pub"), false);
    assert.equal(isSensitivePath("id_ed25519.pub"), false);
  });

  it("blocks TLS / cert extensions", () => {
    assert.equal(isSensitivePath("cert.pem"), true);
    assert.equal(isSensitivePath("server.key"), true);
    assert.equal(isSensitivePath("ca.crt"), true);
    assert.equal(isSensitivePath("some/path/to/cert.PEM"), true);
  });

  it("blocks known credential filenames", () => {
    assert.equal(isSensitivePath("credentials.json"), true);
    assert.equal(isSensitivePath(".npmrc"), true);
    assert.equal(isSensitivePath(".htpasswd"), true);
  });
});

describe("isSensitivePath — does not over-block", () => {
  it("allows .env lookalikes that are not actually env files", () => {
    // `.environment` / `.envoy.yaml` / etc. should not match.
    assert.equal(isSensitivePath(".environment"), false);
    assert.equal(isSensitivePath(".envoy"), false);
    assert.equal(isSensitivePath("envelope.md"), false);
    assert.equal(isSensitivePath("env.json"), false);
  });

  it("allows ordinary source and document files", () => {
    assert.equal(isSensitivePath("README.md"), false);
    assert.equal(isSensitivePath("notes.txt"), false);
    assert.equal(isSensitivePath("server/routes/files.ts"), false);
    assert.equal(isSensitivePath("wiki/pages/sakura.md"), false);
  });

  it("allows files with similar but non-sensitive extensions", () => {
    assert.equal(isSensitivePath("foo.pkm"), false);
    assert.equal(isSensitivePath("foo.keypress"), false);
    // `.cert.ts` is a TypeScript file, extname is `.ts` not `.cert`.
    assert.equal(isSensitivePath("server.cert.ts"), false);
  });

  it("allows an empty path (resolveSafe guards those separately)", () => {
    assert.equal(isSensitivePath(""), false);
  });
});
