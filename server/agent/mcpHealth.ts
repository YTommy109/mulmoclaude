// Pre-flight check for stdio MCP servers wired up via `npx -y <pkg>`.
//
// Background: catalog entries (or hand-edited mcp.json entries) pin a
// community npm package by name. If the package doesn't exist on the
// registry — e.g. a TODO(reviewer) was never resolved before merge —
// `npx -y <missing-pkg>` returns 404 and the MCP server silently
// fails to start. From the agent's perspective the tool just isn't
// available, so Claude falls back to whatever generic tool (usually
// `WebSearch`) covers the same domain — confusing for the user who
// can see the entry as "enabled" in Settings.
//
// This module runs fire-and-forget per agent invocation, hits
// `npm view <pkg>` in a child process (cached after first lookup),
// and emits a single `log.warn` for each entry whose package isn't
// resolvable. We don't block the spawn — the warn is the only
// product. Cache lifetime is the server process; restart to re-check.

import { spawn } from "node:child_process";
import type { McpServerSpec } from "../../src/config/mcpTypes.js";
import { log } from "../system/logger/index.js";

const NPM_VIEW_TIMEOUT_MS = 5_000;
const npmViewCache = new Map<string, "exists" | "missing">();

// Resolve the npm package name from a stdio spec when the command is
// `npx [-y] <pkg>` or similar. Strips an optional `@version` suffix
// (`spotify-mcp@latest` → `spotify-mcp`, `@scope/pkg@1.0` → `@scope/pkg`).
// Returns null when the command isn't recognisably an npx invocation.
export function extractNpxPackage(command: string, args?: readonly string[]): string | null {
  // Accept any path ending in `/npx` (e.g. workspace-local node_modules) or the bare name.
  const looksLikeNpx = command === "npx" || command.endsWith("/npx") || command.endsWith("\\npx");
  if (!looksLikeNpx) return null;
  if (!args || args.length === 0) return null;
  let pkg: string | undefined;
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    pkg = arg;
    break;
  }
  if (!pkg) return null;
  // Strip @version suffix. lastIndexOf because scoped packages start with @.
  const versionAt = pkg.lastIndexOf("@");
  if (versionAt > 0) return pkg.substring(0, versionAt);
  return pkg;
}

async function checkNpmPackage(pkg: string): Promise<"exists" | "missing"> {
  const cached = npmViewCache.get(pkg);
  if (cached) return cached;

  return new Promise((resolve) => {
    const proc = spawn("npm", ["view", pkg, "name"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      // On timeout assume the package exists — better to skip the
      // warn than to spam false positives when offline / slow network.
      proc.kill();
      resolve("exists");
    }, NPM_VIEW_TIMEOUT_MS);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      const result: "exists" | "missing" = code === 0 ? "exists" : "missing";
      npmViewCache.set(pkg, result);
      resolve(result);
    });
    proc.on("error", () => {
      // npm binary itself missing — not a per-package issue, don't cache.
      clearTimeout(timer);
      resolve("exists");
    });
  });
}

// Walk every enabled stdio server, extract the npx package name, and
// log a warn for any that resolve 404. Fire-and-forget: callers ignore
// the returned promise.
export async function validateStdioPackages(userServers: Record<string, McpServerSpec>): Promise<void> {
  const checks: Promise<void>[] = [];
  for (const [serverId, spec] of Object.entries(userServers)) {
    if (spec.type !== "stdio") continue;
    if (spec.enabled === false) continue;
    const pkg = extractNpxPackage(spec.command, spec.args);
    if (!pkg) continue;
    checks.push(
      checkNpmPackage(pkg).then((status) => {
        if (status === "missing") {
          log.warn("mcp", "stdio package not found on npm — server will fail to spawn", {
            serverId,
            package: pkg,
          });
        }
      }),
    );
  }
  await Promise.all(checks);
}
