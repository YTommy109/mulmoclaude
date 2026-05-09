// Thin wrapper around `exifr` for the photo-location capture flow
// (#1222 PR-A).
//
// Why a wrapper:
//   - `exifr.parse(...)` returns `unknown`-shaped data; everything
//     except a tight allow-list is noise. Centralise the projection
//     so the hook stays simple and the sidecar shape is the single
//     source of truth.
//   - exifr throws on malformed input. Tested call sites convert
//     "no exif" / "corrupt jpeg" / "wrong mime" to a `null` return
//     so the post-save hook never has to try/catch.
//
// Output is shape-compatible with `mapControl({ action: "addMarker",
// lat, lng })` so the LLM (and any future view) can pass the
// extracted coords straight to the Google Map plugin without a
// reshape (#1227).

import { readFile } from "fs/promises";
import exifr from "exifr";

/** Extracted, projected EXIF fields. All optional — most photos have
 *  some subset. Persisted as the sidecar JSON shape; consumers can
 *  rely on `lat` + `lng` being absent together (never one without
 *  the other). */
export interface PhotoExif {
  /** Latitude in WGS84 decimal degrees. */
  lat?: number;
  /** Longitude in WGS84 decimal degrees. */
  lng?: number;
  /** GPS altitude in metres above sea level. */
  altitude?: number;
  /** ISO 8601 capture timestamp (UTC). exifr normalises any of the
   *  three EXIF date fields (DateTimeOriginal / DateTime /
   *  CreateDate) to a JS Date — we serialise to ISO for storage. */
  takenAt?: string;
  /** Camera make (e.g. "Apple"). */
  make?: string;
  /** Camera model (e.g. "iPhone 15 Pro"). */
  model?: string;
  /** Lens model (e.g. "iPhone 15 Pro back triple camera"). */
  lens?: string;
  /** Image orientation (1-8 per the EXIF spec) — useful when a
   *  later view renders the photo without going through a tag-aware
   *  decoder. */
  orientation?: number;
}

const VALID_LAT_MIN = -90;
const VALID_LAT_MAX = 90;
const VALID_LNG_MIN = -180;
const VALID_LNG_MAX = 180;

const PARSE_OPTIONS = {
  // exifr's "tiff" group covers DateTime / Make / Model / Orientation;
  // "exif" covers DateTimeOriginal / Lens; "gps" covers latitude /
  // longitude / altitude. Skip the rest (XMP, IPTC, ICC, thumbnails)
  // — they bloat the parse and we don't store any of it.
  tiff: true,
  exif: true,
  gps: true,
  xmp: false,
  iptc: false,
  icc: false,
  jfif: false,
  ihdr: false,
  // Skip thumbnail extraction — exifr otherwise allocates a Buffer
  // per parse for the thumbnail bytes, which we never read.
  pick: ["DateTimeOriginal", "CreateDate", "DateTime", "Make", "Model", "LensModel", "Orientation", "latitude", "longitude", "GPSAltitude"] as string[],
};

/** Validate a `(lat, lng)` pair. exifr occasionally surfaces 0/0
 *  for photos with a zeroed-out GPS block (sometimes seen on Android
 *  exports where the user opted out mid-stream); treating 0/0 as
 *  "no fix" avoids a useless pin in the middle of the Atlantic. */
function isValidCoord(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < VALID_LAT_MIN || lat > VALID_LAT_MAX) return false;
  if (lng < VALID_LNG_MIN || lng > VALID_LNG_MAX) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

function pickString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickDate(raw: Record<string, unknown>): string | undefined {
  // Prefer DateTimeOriginal (when the shutter fired) over DateTime
  // (last edit) and CreateDate (file creation). exifr returns a
  // JS Date when the field is parseable; otherwise a string.
  const candidate = raw.DateTimeOriginal ?? raw.CreateDate ?? raw.DateTime;
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    return candidate.toISOString();
  }
  return undefined;
}

function pickOrientation(raw: Record<string, unknown>): number | undefined {
  const value = raw.Orientation;
  return typeof value === "number" && value >= 1 && value <= 8 ? value : undefined;
}

/** Lower-level parser injection point. Tests pass a fake to avoid
 *  needing a real JPEG fixture; production paths default to exifr. */
export type ExifParser = (buf: Buffer) => Promise<unknown>;

const defaultParser: ExifParser = (buf) => exifr.parse(buf, PARSE_OPTIONS);

/** Parse a photo file and project the fields we care about. Returns
 *  `null` when the file has no parseable EXIF (screenshots, scrubbed
 *  uploads, non-image MIME types, malformed JPEG). Never throws. */
export async function readPhotoExif(absPath: string, parser: ExifParser = defaultParser): Promise<PhotoExif | null> {
  let raw: unknown;
  try {
    const buf = await readFile(absPath);
    raw = await parser(buf);
  } catch {
    // Includes both fs errors (handler should have ensured the file
    // exists) and exifr "couldn't find any EXIF data" rejections.
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  return projectExif(raw as Record<string, unknown>);
}

/** Coords + altitude. exifr surfaces `latitude` / `longitude` /
 *  `GPSAltitude` from the GPS group. */
function pickGps(record: Record<string, unknown>): Pick<PhotoExif, "lat" | "lng" | "altitude"> {
  const out: Pick<PhotoExif, "lat" | "lng" | "altitude"> = {};
  if (isValidCoord(record.latitude, record.longitude)) {
    out.lat = record.latitude as number;
    out.lng = record.longitude as number;
  }
  if (typeof record.GPSAltitude === "number" && Number.isFinite(record.GPSAltitude)) {
    out.altitude = record.GPSAltitude;
  }
  return out;
}

/** Camera identification — Make / Model / LensModel. Empty strings
 *  drop out (exifr returns `""` for tags present but blank). */
function pickCamera(record: Record<string, unknown>): Pick<PhotoExif, "make" | "model" | "lens"> {
  const out: Pick<PhotoExif, "make" | "model" | "lens"> = {};
  const make = pickString(record, "Make");
  if (make) out.make = make;
  const model = pickString(record, "Model");
  if (model) out.model = model;
  const lens = pickString(record, "LensModel");
  if (lens) out.lens = lens;
  return out;
}

/** Pure projection: take the raw exifr output and pluck the fields
 *  we keep. Exported separately so the hook can run a fake parser
 *  result through the same shaping in tests. */
export function projectExif(record: Record<string, unknown>): PhotoExif | null {
  const takenAt = pickDate(record);
  const orientation = pickOrientation(record);
  const result: PhotoExif = {
    ...pickGps(record),
    ...pickCamera(record),
    ...(takenAt !== undefined ? { takenAt } : {}),
    ...(orientation !== undefined ? { orientation } : {}),
  };
  // No useful fields — caller treats the same as "no exif" so the
  // sidecar isn't created with an empty object.
  return Object.keys(result).length === 0 ? null : result;
}

/** True when the MIME type is one exifr can read. Image-only — video
 *  EXIF (MP4 / MOV) is out of scope for PR-A. HEIC is included
 *  because iOS still emits it as the default camera format. */
export function isExifSupportedMime(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return (
    lower === "image/jpeg" || lower === "image/png" || lower === "image/heic" || lower === "image/heif" || lower === "image/tiff" || lower === "image/webp"
  );
}
