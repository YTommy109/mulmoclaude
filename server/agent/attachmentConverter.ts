// Converts non-native attachment types into content blocks that
// Claude can consume. Called by `buildUserMessageLine` before
// assembling the JSON message line.
//
// Supported conversions:
//   text/*           → decode UTF-8 → text block
//   application/json, .xml, .yaml, .toml, .csv → same (text)
//   application/vnd...wordprocessingml (docx) → mammoth → text block
//   application/vnd...spreadsheetml (xlsx) → xlsx → CSV text block
//   application/vnd...presentationml (pptx) → libreoffice → PDF doc block (Docker only)
//
// Each converter returns an array of content blocks (usually one).
// Returns null when the type is not convertible — the caller skips it.

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import type { Attachment } from "@mulmobridge/protocol";

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

// ── Plain text ────────────────────────────────────────────────

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/html",
  "text/xml",
  "text/markdown",
  "text/yaml",
  "text/x-yaml",
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/toml",
]);

function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || TEXT_MIME_TYPES.has(mime);
}

function decodeBase64Text(data: string): string {
  return Buffer.from(data, "base64").toString("utf-8");
}

// ── DOCX ──────────────────────────────────────────────────────

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function convertDocx(data: string): Promise<string> {
  const buf = Buffer.from(data, "base64");
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value;
}

// ── XLSX ──────────────────────────────────────────────────────

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function convertXlsx(data: string): string {
  const buf = Buffer.from(data, "base64");
  const workbook = XLSX.read(buf, { type: "buffer" });
  const parts: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (workbook.SheetNames.length > 1) {
      parts.push(`## Sheet: ${name}\n\n${csv}`);
    } else {
      parts.push(csv);
    }
  }
  return parts.join("\n\n");
}

// ── PPTX (Docker/libreoffice only) ───────────────────────────

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function isLibreOfficeAvailable(): boolean {
  try {
    execFileSync("libreoffice", ["--version"], {
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function convertPptxToPdf(data: string): Buffer | null {
  if (!isLibreOfficeAvailable()) return null;

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pptx-"));
  const inputPath = path.join(tmpDir, "input.pptx");
  const outputPath = path.join(tmpDir, "input.pdf");

  try {
    writeFileSync(inputPath, Buffer.from(data, "base64"));
    execFileSync(
      "libreoffice",
      ["--headless", "--convert-to", "pdf", "--outdir", tmpDir, inputPath],
      { stdio: "ignore", timeout: 60_000 },
    );
    return readFileSync(outputPath);
  } catch {
    return null;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Public API ────────────────────────────────────────────────

function textBlock(att: Attachment, content: string): ContentBlock[] {
  const label = att.filename ? `[File: ${att.filename}]\n\n` : "";
  return [{ type: "text", text: `${label}${content}` }];
}

async function tryConvertDocx(att: Attachment): Promise<ContentBlock[] | null> {
  try {
    return textBlock(att, await convertDocx(att.data));
  } catch {
    return null;
  }
}

function tryConvertXlsx(att: Attachment): ContentBlock[] | null {
  try {
    return textBlock(att, convertXlsx(att.data));
  } catch {
    return null;
  }
}

function tryConvertPptx(att: Attachment): ContentBlock[] {
  const pdfBuf = convertPptxToPdf(att.data);
  if (!pdfBuf) {
    const name = att.filename ?? "presentation.pptx";
    return [
      {
        type: "text",
        text: `[PPTX file "${name}" attached but cannot be converted — LibreOffice is not available. Run in Docker sandbox mode for PPTX support.]`,
      },
    ];
  }
  return [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfBuf.toString("base64"),
      },
    },
  ];
}

/**
 * Convert an attachment into content blocks Claude can consume.
 * Returns null if the MIME type is not convertible (caller skips).
 */
export async function convertAttachment(
  att: Attachment,
): Promise<ContentBlock[] | null> {
  if (isTextMime(att.mimeType))
    return textBlock(att, decodeBase64Text(att.data));
  if (att.mimeType === DOCX_MIME) return tryConvertDocx(att);
  if (att.mimeType === XLSX_MIME) return tryConvertXlsx(att);
  if (att.mimeType === PPTX_MIME) return tryConvertPptx(att);
  return null;
}

/** MIME types that can be converted (for UI accept list). */
export const CONVERTIBLE_MIME_TYPES = [
  // Text
  "text/plain",
  "text/csv",
  "text/html",
  "text/xml",
  "text/markdown",
  "text/yaml",
  "application/json",
  "application/xml",
  "application/toml",
  // Office
  DOCX_MIME,
  XLSX_MIME,
  PPTX_MIME,
] as const;

export function isConvertibleMime(mime: string): boolean {
  return (
    isTextMime(mime) ||
    mime === DOCX_MIME ||
    mime === XLSX_MIME ||
    mime === PPTX_MIME
  );
}
