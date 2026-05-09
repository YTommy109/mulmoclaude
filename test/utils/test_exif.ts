// Unit tests for the EXIF wrapper (#1222 PR-A).
//
// Exercises the projection logic against synthetic exifr outputs, so
// no JPEG fixture file is needed. The integration test under
// test/workspace/photo-locations/ covers the on-disk hook flow.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isExifSupportedMime, projectExif, readPhotoExif } from "../../server/utils/exif.js";

const TAKEN_AT_RAW = new Date("2026-04-12T08:30:00.000Z");
const TAKEN_AT_ISO = TAKEN_AT_RAW.toISOString();

describe("isExifSupportedMime", () => {
  it("accepts every image MIME exifr can read", () => {
    for (const mime of ["image/jpeg", "image/png", "image/heic", "image/heif", "image/tiff", "image/webp"]) {
      assert.equal(isExifSupportedMime(mime), true, mime);
    }
  });

  // Codex review on PR #1247: `attachment-store.ts`'s `MIME_EXT` table
  // accepts BOTH `image/jpeg` and the legacy alias `image/jpg`, so an
  // upload labelled `image/jpg` saves successfully — but the original
  // allowlist rejected it, silently skipping EXIF capture for that
  // alias. Lock the alias parity in place with a test.
  it("accepts the image/jpg alias (parity with attachment-store MIME_EXT)", () => {
    assert.equal(isExifSupportedMime("image/jpg"), true);
    assert.equal(isExifSupportedMime("IMAGE/JPG"), true);
  });

  it("rejects non-image MIMEs", () => {
    for (const mime of ["application/pdf", "video/mp4", "text/plain", "application/octet-stream", "image/gif"]) {
      assert.equal(isExifSupportedMime(mime), false, mime);
    }
  });

  it("ignores casing", () => {
    assert.equal(isExifSupportedMime("IMAGE/JPEG"), true);
    assert.equal(isExifSupportedMime("Image/Heic"), true);
  });
});

describe("projectExif — happy paths", () => {
  it("plucks lat/lng/altitude and takenAt + camera fields", () => {
    const exif = projectExif({
      latitude: 35.6586,
      longitude: 139.7454,
      GPSAltitude: 38.4,
      DateTimeOriginal: TAKEN_AT_RAW,
      Make: "Apple",
      Model: "iPhone 15 Pro",
      LensModel: "iPhone 15 Pro back triple camera",
      Orientation: 1,
    });
    assert.deepEqual(exif, {
      lat: 35.6586,
      lng: 139.7454,
      altitude: 38.4,
      takenAt: TAKEN_AT_ISO,
      make: "Apple",
      model: "iPhone 15 Pro",
      lens: "iPhone 15 Pro back triple camera",
      orientation: 1,
    });
  });

  it("keeps lat/lng even when other fields are missing", () => {
    const exif = projectExif({ latitude: 35.6586, longitude: 139.7454 });
    assert.deepEqual(exif, { lat: 35.6586, lng: 139.7454 });
  });

  it("keeps takenAt without GPS (typical scanned-document case)", () => {
    const exif = projectExif({ DateTimeOriginal: TAKEN_AT_RAW });
    assert.deepEqual(exif, { takenAt: TAKEN_AT_ISO });
  });
});

describe("projectExif — date-field fallback chain", () => {
  it("falls back to CreateDate when DateTimeOriginal is missing", () => {
    const exif = projectExif({ CreateDate: TAKEN_AT_RAW });
    assert.equal(exif?.takenAt, TAKEN_AT_ISO);
  });

  it("falls back to DateTime when CreateDate is missing too", () => {
    const exif = projectExif({ DateTime: TAKEN_AT_RAW });
    assert.equal(exif?.takenAt, TAKEN_AT_ISO);
  });

  it("ignores invalid Date objects", () => {
    const exif = projectExif({ DateTimeOriginal: new Date("invalid") });
    assert.equal(exif, null);
  });

  it("ignores plain-string date fields (exifr pre-coerces; bare strings mean parse failure)", () => {
    const exif = projectExif({ DateTimeOriginal: "2026:04:12 08:30:00" });
    assert.equal(exif, null);
  });
});

describe("projectExif — coordinate validation", () => {
  it("rejects out-of-range latitude", () => {
    const exif = projectExif({ latitude: 91, longitude: 0 });
    assert.equal(exif, null);
  });

  it("rejects out-of-range longitude", () => {
    const exif = projectExif({ latitude: 0, longitude: -181 });
    assert.equal(exif, null);
  });

  it("rejects exact 0/0 (Atlantic null-island)", () => {
    const exif = projectExif({ latitude: 0, longitude: 0 });
    assert.equal(exif, null);
  });

  it("accepts 0/0-adjacent legitimate coords", () => {
    const exif = projectExif({ latitude: 0, longitude: 0.001 });
    assert.deepEqual(exif, { lat: 0, lng: 0.001 });
  });

  it("rejects non-numeric coords (string lat from a malformed parse)", () => {
    const exif = projectExif({ latitude: "35.6586" as unknown as number, longitude: 139.7454 });
    assert.equal(exif, null);
  });

  it("rejects only one of lat / lng (never half a fix)", () => {
    const exif = projectExif({ latitude: 35.6586 });
    assert.equal(exif, null);
  });

  it("rejects NaN / Infinity coords", () => {
    assert.equal(projectExif({ latitude: NaN, longitude: 0 }), null);
    assert.equal(projectExif({ latitude: 0, longitude: Number.POSITIVE_INFINITY }), null);
  });
});

describe("projectExif — orientation guard", () => {
  it("accepts orientation 1-8", () => {
    for (let i = 1; i <= 8; i++) {
      const exif = projectExif({ DateTimeOriginal: TAKEN_AT_RAW, Orientation: i });
      assert.equal(exif?.orientation, i);
    }
  });

  it("rejects out-of-range orientation", () => {
    const exif = projectExif({ DateTimeOriginal: TAKEN_AT_RAW, Orientation: 9 });
    assert.equal(exif?.orientation, undefined);
  });
});

describe("projectExif — empty / null returns", () => {
  it("returns null when no useful fields are present", () => {
    assert.equal(projectExif({}), null);
  });

  it("returns null when only ignored fields are present", () => {
    assert.equal(projectExif({ ImageWidth: 4032, ImageHeight: 3024 }), null);
  });

  it("ignores empty-string camera fields", () => {
    assert.equal(projectExif({ Make: "", Model: "" }), null);
  });
});

describe("readPhotoExif — file-system + parser injection", () => {
  it("returns null when the file does not exist", async () => {
    const result = await readPhotoExif("/does/not/exist.jpg");
    assert.equal(result, null);
  });

  it("returns null when the parser throws (corrupt JPEG)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "exif-test-"));
    const filePath = path.join(dir, "corrupt.jpg");
    writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]));
    try {
      const result = await readPhotoExif(filePath, () => Promise.reject(new Error("malformed")));
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the parser yields no useful fields", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "exif-test-"));
    const filePath = path.join(dir, "scrubbed.jpg");
    writeFileSync(filePath, Buffer.from([0xff, 0xd8]));
    try {
      const result = await readPhotoExif(filePath, () => Promise.resolve({}));
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flows the parser output through projectExif", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "exif-test-"));
    const filePath = path.join(dir, "good.jpg");
    writeFileSync(filePath, Buffer.from([0xff, 0xd8]));
    try {
      const result = await readPhotoExif(filePath, () => Promise.resolve({ latitude: 35.6586, longitude: 139.7454, Make: "Apple" }));
      assert.deepEqual(result, { lat: 35.6586, lng: 139.7454, make: "Apple" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
