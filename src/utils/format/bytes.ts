// Human-readable byte sizes for the UI (file sizes, attachment
// previews, etc.). Centralised so the same byte count never displays
// as different rounded forms across views (#1309).
//
// Boundaries are powers of 1024 (KiB / MiB / GiB), matching how
// operating systems report file sizes; binary thresholds are the
// expected convention for desktop file-size UI even though SI uses
// 1000-based prefixes.

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;

export interface FormatBytesOptions {
  /** Decimal places for KB and above. Defaults to 1. Bytes (B) are
   *  always shown as integers. */
  decimals?: number;
}

export function formatBytes(bytes: number, opts: FormatBytesOptions = {}): string {
  const decimals = opts.decimals ?? 1;
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < KiB) return `${bytes} B`;
  if (bytes < MiB) return `${(bytes / KiB).toFixed(decimals)} KB`;
  if (bytes < GiB) return `${(bytes / MiB).toFixed(decimals)} MB`;
  return `${(bytes / GiB).toFixed(decimals)} GB`;
}
