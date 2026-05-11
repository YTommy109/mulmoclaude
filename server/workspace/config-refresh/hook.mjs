#!/usr/bin/env node
// Auto-refresh hook (#1283) — runs after every Claude CLI Write / Edit.
// If the affected file is a SKILL.md or the scheduler tasks.json,
// POST /api/config/refresh on the parent server so changes activate
// without a manual restart. Everything else is a fast no-op.
//
// THIS FILE IS THE SOURCE OF TRUTH copied into
// `<workspace>/.claude/hooks/config-refresh.mjs` by
// `server/workspace/config-refresh/provision.ts` on every server start.
// Edits here propagate via the normal launcher build/release path.
//
// Kept self-contained: no imports from `src/` or `server/` because the
// hook executes inside Claude CLI's process space, which doesn't share
// our module resolver. Plain ESM with Node-builtin imports only.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Resolve workspace root + sidecar files. `CLAUDE_PROJECT_DIR` is set
// by Claude CLI to the workspace root the hook fired against; falling
// back to `~/mulmoclaude` keeps the script robust when run outside CLI
// context (test harness etc).
const WORKSPACE = process.env.CLAUDE_PROJECT_DIR ?? path.join(homedir(), "mulmoclaude");
const TOKEN_PATH = path.join(WORKSPACE, ".session-token");
const PORT_PATH = path.join(WORKSPACE, ".server-port");
// In Docker mode the parent server lives on the host's 127.0.0.1
// which the container can't reach via plain loopback. The Docker
// spawn plumbing sets MULMOCLAUDE_HOST=host.docker.internal so
// fetch() resolves to the host server. Outside Docker (or when the
// var is unset) we fall back to the loopback address.
const SERVER_HOST = process.env.MULMOCLAUDE_HOST ?? "127.0.0.1";

// File paths we care about. Matched against the absolute path the
// CLI delivered in `tool_input.file_path` / `tool_response.filePath`.
const PATTERNS = [
  /[\\/]\.claude[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/, // <ws>/.claude/skills/<slug>/SKILL.md
  /[\\/]config[\\/]scheduler[\\/]tasks\.json$/, // <ws>/config/scheduler/tasks.json
];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function extractFilePath(payload) {
  if (!payload || typeof payload !== "object") return "";
  const toolInput = payload.tool_input;
  if (toolInput && typeof toolInput === "object" && typeof toolInput.file_path === "string") return toolInput.file_path;
  const toolResponse = payload.tool_response;
  if (toolResponse && typeof toolResponse === "object" && typeof toolResponse.filePath === "string") return toolResponse.filePath;
  return "";
}

function readSidecar(filePath) {
  try {
    return readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

// `.server-port` is hand-written by the parent server on each
// startup. Parse it as a strict integer in [1, 65535] before
// interpolating into the URL — a crafted file value like
// `80@attacker.example` would otherwise change the request
// authority and exfiltrate the bearer token off-host. Same
// hardening as `wiki-history` hook's `readPortSafe` (Codex
// review on PR #1284).
function readPortSafe() {
  const raw = readSidecar(PORT_PATH);
  if (!raw) return null;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

(async () => {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return;
  }

  const filePath = extractFilePath(payload);
  if (!filePath) return;
  if (!PATTERNS.some((pattern) => pattern.test(filePath))) return;

  const port = readPortSafe();
  const token = readSidecar(TOKEN_PATH);
  if (!port || !token) return;

  // PostToolUse hooks block Claude CLI's tool turn until the script
  // exits. Without a timeout, a slow / hung parent server (refresh
  // deadlock, GC pause, or an unrelated long-running route holding
  // the loop) would leave the hook waiting on the socket and the
  // user's Write/Edit appearing frozen. 2 s is plenty — the refresh
  // is fire-and-forget anyway; if the server can't respond inside
  // that, the file is already on disk and the next restart picks it
  // up. (CodeRabbit review on PR #1284.)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    await fetch(`http://${SERVER_HOST}:${port}/api/config/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch {
    // Server might be restarting / unreachable / timed out — silent
    // fail is fine; the file is on disk and the next manual restart
    // picks it up.
  } finally {
    clearTimeout(timer);
  }
})();
