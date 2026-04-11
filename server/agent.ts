import { spawn } from "child_process";
import { mkdir, writeFile, unlink } from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { isDockerAvailable } from "./docker.js";
import { refreshCredentials, isAuthError } from "./credentials.js";
import type { Role } from "../src/config/roles.js";
import { loadAllRoles } from "./roles.js";
import { buildSystemPrompt } from "./agent/prompt.js";
import {
  getActivePlugins,
  buildMcpConfig,
  buildCliArgs,
} from "./agent/config.js";
import {
  parseStreamEvent,
  type AgentEvent,
  type RawStreamEvent,
} from "./agent/stream.js";

interface AgentRunResult {
  events: AgentEvent[];
  stderrOutput: string;
  exitCode: number;
}

/**
 * Check whether any collected events or stderr indicate a 401 auth error.
 * The Claude CLI may report the error via stderr, via a "text" result event,
 * or via an "error" event on stdout.
 */
function hasAuthFailure(result: AgentRunResult): boolean {
  if (isAuthError(result.stderrOutput)) return true;
  for (const event of result.events) {
    if (
      (event.type === "text" || event.type === "error") &&
      isAuthError(event.message)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Spawn the claude CLI and collect all events and exit info.
 * This is the inner execution that does NOT handle retries.
 */
async function execAgent(
  args: string[],
  useDocker: boolean,
  workspacePath: string,
): Promise<AgentRunResult> {
  const toDockerPath = (p: string) => p.replace(/\\/g, "/");
  const extraHosts: string[] =
    process.platform === "linux"
      ? ["--add-host", "host.docker.internal:host-gateway"]
      : [];

  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  const projectRoot = process.cwd();
  const proc = useDocker
    ? spawn(
        "docker",
        [
          "run",
          "--rm",
          "--cap-drop",
          "ALL",
          "--user",
          `${uid}:${gid}`,
          "-e",
          "HOME=/home/node",
          "-v",
          `${toDockerPath(projectRoot)}/node_modules:/app/node_modules:ro`,
          "-v",
          `${toDockerPath(projectRoot)}/server:/app/server:ro`,
          "-v",
          `${toDockerPath(projectRoot)}/src:/app/src:ro`,
          "-v",
          `${toDockerPath(workspacePath)}:/home/node/mulmoclaude`,
          "-v",
          `${toDockerPath(homedir())}/.claude:/home/node/.claude`,
          "-v",
          `${toDockerPath(homedir())}/.claude.json:/home/node/.claude.json`,
          ...extraHosts,
          "mulmoclaude-sandbox",
          "claude",
          ...args,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      )
    : spawn("claude", args, {
        cwd: workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
      });

  const events: AgentEvent[] = [];
  let stderrOutput = "";

  try {
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let event: RawStreamEvent;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        for (const agentEvent of parseStreamEvent(event)) {
          events.push(agentEvent);
        }
      }
    }

    const exitCode = await new Promise<number>((resolve) =>
      proc.on("close", resolve),
    );

    return { events, stderrOutput, exitCode };
  } finally {
    if (!proc.killed) proc.kill();
  }
}

export async function* runAgent(
  message: string,
  role: Role,
  workspacePath: string,
  sessionId: string,
  port: number,
  claudeSessionId?: string,
  pluginPrompts?: Record<string, string>,
  systemPrompt?: string,
): AsyncGenerator<AgentEvent> {
  const activePlugins = getActivePlugins(role);
  const hasMcp = activePlugins.length > 0;
  const useDocker = await isDockerAvailable();

  const containerWorkspacePath = "/home/node/mulmoclaude";
  const fullSystemPrompt = buildSystemPrompt({
    role,
    workspacePath: useDocker ? containerWorkspacePath : workspacePath,
    pluginPrompts,
    systemPrompt,
  });

  // Compute MCP config paths — host path for writing/cleanup,
  // arg path for what gets passed to the claude CLI (container path if docker).
  let mcpConfigHostPath: string;
  let mcpConfigArgPath: string;
  if (useDocker) {
    const mcpConfigDir = join(workspacePath, ".mulmoclaude");
    await mkdir(mcpConfigDir, { recursive: true });
    mcpConfigHostPath = join(mcpConfigDir, `mcp-${sessionId}.json`);
    mcpConfigArgPath = `/home/node/mulmoclaude/.mulmoclaude/mcp-${sessionId}.json`;
  } else {
    mcpConfigHostPath = join(tmpdir(), `mulmoclaude-mcp-${sessionId}.json`);
    mcpConfigArgPath = mcpConfigHostPath;
  }

  if (hasMcp) {
    const mcpConfig = buildMcpConfig({
      sessionId,
      port,
      activePlugins,
      roleIds: loadAllRoles().map((r) => r.id),
      useDocker,
    });
    await writeFile(mcpConfigHostPath, JSON.stringify(mcpConfig, null, 2));
  }

  const args = buildCliArgs({
    systemPrompt: fullSystemPrompt,
    activePlugins,
    claudeSessionId,
    message,
    mcpConfigPath: hasMcp ? mcpConfigArgPath : undefined,
  });

  try {
    let result = await execAgent(args, useDocker, workspacePath);

    // On macOS sandbox, if the CLI failed with a 401 auth error, try to
    // auto-refresh credentials from macOS Keychain and retry once.
    // The auth error may surface via stderr, a "text" result event, or an
    // "error" event — so we check all of them.
    if (useDocker && process.platform === "darwin" && hasAuthFailure(result)) {
      console.log(
        "[sandbox] Authentication error detected — refreshing credentials and retrying...",
      );
      const refreshed = await refreshCredentials();
      if (refreshed) {
        result = await execAgent(args, useDocker, workspacePath);
      }
    }

    for (const event of result.events) {
      yield event;
    }

    if (result.exitCode !== 0) {
      yield {
        type: "error",
        message:
          result.stderrOutput || `claude exited with code ${result.exitCode}`,
      };
    }
  } finally {
    if (hasMcp) unlink(mcpConfigHostPath).catch(() => {});
  }
}
