import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../workspace.js";

const router = Router();

const MAX_PREVIEW_BYTES = 1024 * 1024; // 1 MB — text content embedded in JSON
const MAX_RAW_BYTES = 50 * 1024 * 1024; // 50 MB — cap for binary streaming
const HIDDEN_DIRS = new Set([".git"]);

// Files whose basename exactly matches one of these is refused by
// every file-API endpoint. Used to keep workspace secrets
// (credentials, API keys, SSH / TLS private keys) off the HTTP
// surface. Compared against `path.basename(...).toLowerCase()`.
const SENSITIVE_BASENAMES = new Set([
  "credentials.json",
  // Claude Code credentials file written by server/credentials.ts.
  ".npmrc",
  ".htpasswd",
  "id_rsa",
  "id_ecdsa",
  "id_ed25519",
  "id_dsa",
]);

// File extensions whose contents are almost always secret. Compared
// against `path.extname(...).toLowerCase()`. Note: `.env` is matched
// separately below because `path.extname(".env")` returns "" —
// dotfiles with no second extension don't carry an extname.
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".crt"]);

// Decide whether `relPath` names a file whose contents should NEVER
// be served by the file API. Applied in three places:
//
// 1. `resolveSafe` returns null for sensitive paths so every
//    endpoint (content, raw, anything future) rejects them with a
//    generic 400.
// 2. `buildTree` filters them out of `/files/tree`, so the file
//    explorer never lists them in the first place.
// 3. The `.env` blocklist below is what keeps `/files/content`
//    from leaking credentials on a matching-name lookup.
//
// Exported so `test/routes/test_filesRoute.ts` can pin the matching
// rules down table-driven — regressions here silently reopen a
// credential-exfil surface.
export function isSensitivePath(relPath: string): boolean {
  const base = path.basename(relPath).toLowerCase();
  if (SENSITIVE_BASENAMES.has(base)) return true;
  // `.env` and every `.env.<something>` variant
  // (`.env.local`, `.env.production`, ...). The startsWith check
  // is scoped to `.env` to avoid false-positives on names like
  // `.environment-notes` — we only match `.env` exact or
  // `.env.<suffix>`.
  if (base === ".env") return true;
  if (base.startsWith(".env.")) return true;
  const ext = path.extname(base);
  if (SENSITIVE_EXTENSIONS.has(ext)) return true;
  return false;
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".jsonl",
  ".ndjson",
  ".yaml",
  ".yml",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".vue",
  ".html",
  ".htm",
  ".css",
  ".csv",
  ".log",
  // `.env` intentionally removed — see `isSensitivePath` below.
  // It used to be here, making `/files/content?path=.env` return
  // the workspace credentials as JSON text over an open CORS
  // endpoint. The file API now refuses sensitive paths outright;
  // this set is kept for genuine plain-text previews only.
  ".gitignore",
  ".sh",
  ".py",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".oga",
  ".flac",
  ".aac",
]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".ogv": "video/ogg",
};

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedMs?: number;
  children?: TreeNode[];
}

interface ErrorResponse {
  error: string;
}

interface FileContentText {
  kind: "text";
  path: string;
  content: string;
  size: number;
  modifiedMs: number;
}

interface FileContentMeta {
  kind: "image" | "pdf" | "audio" | "video" | "binary" | "too-large";
  path: string;
  size: number;
  modifiedMs: number;
  message?: string;
}

type FileContentResponse = FileContentText | FileContentMeta;

type ContentKind = "text" | "image" | "pdf" | "audio" | "video" | "binary";

function classify(filename: string): ContentKind {
  const ext = path.extname(filename).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  // Files with no extension (e.g. README, LICENSE) — treat as text
  if (!ext) return "text";
  return "binary";
}

// Realpath of the workspace, computed once at module load. Using the
// realpath defeats symlink-based escapes — `path.resolve` + `startsWith`
// alone is insufficient because a symlink inside the workspace could
// point at `/etc/passwd` and still pass the prefix check.
const workspaceReal = fs.realpathSync(workspacePath);

function resolveSafe(relPath: string): string | null {
  const normalized = path.normalize(relPath || "");
  const resolved = path.resolve(workspaceReal, normalized);
  let resolvedReal: string;
  try {
    resolvedReal = fs.realpathSync(resolved);
  } catch {
    return null;
  }
  if (
    resolvedReal !== workspaceReal &&
    !resolvedReal.startsWith(workspaceReal + path.sep)
  ) {
    return null;
  }
  // Reject paths that traverse a hidden directory (e.g. `.git/config`).
  // buildTree already hides these from the listing, but the URL endpoints
  // are reachable directly so they need their own check.
  const relativeFromWorkspace = path.relative(workspaceReal, resolvedReal);
  if (relativeFromWorkspace) {
    for (const seg of relativeFromWorkspace.split(path.sep)) {
      if (HIDDEN_DIRS.has(seg)) return null;
    }
  }
  // Reject workspace-sensitive filenames outright. `isSensitivePath`
  // matches on the basename so it catches `.env`, `id_rsa`, and
  // friends regardless of which directory they sit in.
  if (isSensitivePath(resolvedReal)) return null;
  return resolvedReal;
}

interface ByteRange {
  start: number;
  end: number;
}

// Parse an HTTP Range header of the form `bytes=START-END` or
// `bytes=-SUFFIX`. Returns null for malformed or unsatisfiable ranges
// so the caller can respond 416. We deliberately reject multi-range
// requests (`bytes=0-99,200-299`) since browsers don't issue them for
// media playback and supporting them would complicate the response.
function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startStr);
  const end = endStr === "" ? size - 1 : Number(endStr);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || end >= size) return null;
  return { start, end };
}

// If the read stream errors mid-flight (file deleted, disk error,
// permissions changed), surface a clean failure to the client instead
// of leaving the connection hanging.
function pipeWithErrorHandling(
  stream: fs.ReadStream,
  res: Response<ErrorResponse>,
): void {
  stream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    res.status(500).json({ error: `Failed to read file: ${err.message}` });
  });
  stream.pipe(res);
}

function readDirSafe(absPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function statSafe(absPath: string): fs.Stats | null {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
}

function buildTree(absPath: string, relPath: string): TreeNode {
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) {
    return {
      name: path.basename(absPath),
      path: relPath,
      type: "file",
      size: stat.size,
      modifiedMs: stat.mtimeMs,
    };
  }
  const entries = readDirSafe(absPath);
  const children: TreeNode[] = [];
  for (const entry of entries) {
    if (HIDDEN_DIRS.has(entry.name)) continue;
    // Hide sensitive files (`.env`, `id_rsa`, `*.pem`, etc.) from
    // the tree so they don't even show up in the file explorer
    // for the user to click on. `resolveSafe` would refuse them
    // too, but keeping them out of the listing is cleaner.
    if (!entry.isDirectory() && isSensitivePath(entry.name)) continue;
    if (entry.isSymbolicLink()) continue; // avoid escaping the workspace
    const childAbs = path.join(absPath, entry.name);
    const childRel = relPath ? path.join(relPath, entry.name) : entry.name;
    const childStat = statSafe(childAbs);
    if (!childStat) continue;
    children.push(buildTree(childAbs, childRel));
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    name: relPath ? path.basename(relPath) : "",
    path: relPath,
    type: "dir",
    modifiedMs: stat.mtimeMs,
    children,
  };
}

router.get(
  "/files/tree",
  (
    _req: Request<object, unknown, unknown, object>,
    res: Response<TreeNode | ErrorResponse>,
  ) => {
    try {
      const tree = buildTree(workspaceReal, "");
      res.json(tree);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to read workspace: ${message}` });
    }
  },
);

interface PathQuery {
  path?: string;
}

router.get(
  "/files/content",
  (
    req: Request<object, unknown, unknown, PathQuery>,
    res: Response<FileContentResponse | ErrorResponse>,
  ) => {
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!relPath) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const absPath = resolveSafe(relPath);
    if (!absPath) {
      res.status(400).json({ error: "Path outside workspace" });
      return;
    }
    const stat = statSafe(absPath);
    if (!stat) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (!stat.isFile()) {
      res.status(400).json({ error: "Not a file" });
      return;
    }

    const meta = {
      path: relPath,
      size: stat.size,
      modifiedMs: stat.mtimeMs,
    };

    // Anything past the binary stream cap is "too-large" regardless of
    // type — even images/PDFs, since the client would have to fetch
    // them via /files/raw which enforces the same limit.
    if (stat.size > MAX_RAW_BYTES) {
      res.json({
        kind: "too-large",
        ...meta,
        message: `File too large to preview (${stat.size} bytes)`,
      });
      return;
    }

    const kind = classify(absPath);
    if (
      kind === "image" ||
      kind === "pdf" ||
      kind === "audio" ||
      kind === "video"
    ) {
      res.json({ kind, ...meta });
      return;
    }
    if (kind === "binary") {
      res.json({
        kind: "binary",
        ...meta,
        message: "Binary file — preview not supported",
      });
      return;
    }
    if (stat.size > MAX_PREVIEW_BYTES) {
      res.json({
        kind: "too-large",
        ...meta,
        message: `Text file too large to preview (${stat.size} bytes)`,
      });
      return;
    }
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to read file: ${message}` });
      return;
    }
    res.json({ kind: "text", ...meta, content });
  },
);

router.get(
  "/files/raw",
  (
    req: Request<object, unknown, unknown, PathQuery>,
    res: Response<ErrorResponse>,
  ) => {
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!relPath) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const absPath = resolveSafe(relPath);
    if (!absPath) {
      res.status(400).json({ error: "Path outside workspace" });
      return;
    }
    const stat = statSafe(absPath);
    if (!stat) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (!stat.isFile()) {
      res.status(400).json({ error: "Not a file" });
      return;
    }
    if (stat.size > MAX_RAW_BYTES) {
      res.status(413).json({
        error: `File too large to stream (${stat.size} bytes, limit ${MAX_RAW_BYTES})`,
      });
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", mime);

    // Range support is required for `<video>` playback (Safari refuses
    // to play media without 206 responses) and for seek-past-buffered
    // in `<audio>`. When no Range header is sent we fall through to
    // the existing full-file pipe.
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, stat.size);
      if (!range) {
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        res.status(416).json({ error: "Range not satisfiable" });
        return;
      }
      res.status(206);
      res.setHeader(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${stat.size}`,
      );
      res.setHeader("Content-Length", String(range.end - range.start + 1));
      pipeWithErrorHandling(
        fs.createReadStream(absPath, { start: range.start, end: range.end }),
        res,
      );
      return;
    }

    res.setHeader("Content-Length", String(stat.size));
    pipeWithErrorHandling(fs.createReadStream(absPath), res);
  },
);

export default router;
