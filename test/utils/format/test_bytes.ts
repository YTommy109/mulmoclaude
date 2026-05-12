import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytes } from "../../../src/utils/format/bytes.js";

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;

describe("formatBytes", () => {
  it("renders bytes under 1 KiB as plain integers with 'B' suffix", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(KiB - 1), "1023 B");
  });

  it("renders KB once bytes >= 1024, with 1 decimal by default", () => {
    assert.equal(formatBytes(KiB), "1.0 KB");
    assert.equal(formatBytes(KiB * 5 + KiB / 2), "5.5 KB");
    assert.equal(formatBytes(MiB - 1), "1024.0 KB");
  });

  it("renders MB at the MiB boundary", () => {
    assert.equal(formatBytes(MiB), "1.0 MB");
    assert.equal(formatBytes(MiB * 2 + MiB / 4), "2.3 MB");
  });

  it("renders GB at the GiB boundary", () => {
    assert.equal(formatBytes(GiB), "1.0 GB");
    assert.equal(formatBytes(GiB * 12.5), "12.5 GB");
  });

  it("honours the decimals option", () => {
    assert.equal(formatBytes(KiB * 5.5, { decimals: 0 }), "6 KB");
    assert.equal(formatBytes(MiB * 2.345, { decimals: 2 }), "2.35 MB");
  });

  it("returns the em-dash placeholder for negative / non-finite input", () => {
    assert.equal(formatBytes(-1), "—");
    assert.equal(formatBytes(Number.NaN), "—");
    assert.equal(formatBytes(Number.POSITIVE_INFINITY), "—");
  });
});
