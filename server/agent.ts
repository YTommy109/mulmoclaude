import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Role } from "../src/config/roles.js";
import { ROLES } from "../src/config/roles.js";

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "text"; message: string }
  | { type: "tool_result"; result: unknown }
  | { type: "switch_role"; roleId: string }
  | { type: "error"; message: string };

// Plugin names that have a corresponding MCP tool definition in mcp-server.ts
const MCP_PLUGINS = new Set([
  "manageTodoList",
  "presentDocument",
  "presentSpreadsheet",
  "createMindMap",
  "generateImage",
  "switchRole",
  "putQuestions",
  "presentForm",
  "openCanvas",
  "generateHtml",
  "editHtml",
  "editImage",
  "present3d",
]);

export async function* runAgent(
  message: string,
  role: Role,
  workspacePath: string,
  sessionId: string,
  port: number,
): AsyncGenerator<AgentEvent> {
  const systemPrompt = [
    role.prompt,
    `Workspace directory: ${workspacePath}`,
    `Today's date: ${new Date().toISOString().split("T")[0]}`,
  ].join("\n\n");

  const activePlugins = role.availablePlugins.filter((p) => MCP_PLUGINS.has(p));

  // Write temp MCP config if there are plugins to expose
  const mcpConfigPath = join(tmpdir(), `mulmoclaude-mcp-${sessionId}.json`);
  let hasMcp = false;

  if (activePlugins.length > 0) {
    hasMcp = true;
    const mcpConfig = {
      mcpServers: {
        mulmoclaude: {
          command: join(process.cwd(), "node_modules/.bin/tsx"),
          args: [join(process.cwd(), "server/mcp-server.ts")],
          env: {
            SESSION_ID: sessionId,
            PORT: String(port),
            PLUGIN_NAMES: activePlugins.join(","),
            ROLE_IDS: ROLES.map((r) => r.id).join(","),
          },
        },
      },
    };
    await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  }

  const mcpToolNames = activePlugins.map((p) => `mcp__mulmoclaude__${p}`);
  const allowedTools = [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    ...mcpToolNames,
  ];

  const args = [
    "-p",
    message,
    "--output-format",
    "stream-json",
    "--verbose",
    "--system-prompt",
    systemPrompt,
    "--allowedTools",
    allowedTools.join(","),
  ];

  if (hasMcp) {
    args.push("--mcp-config", mcpConfigPath);
  }

  const proc = spawn("claude", args, {
    cwd: workspacePath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrOutput = "";
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
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "assistant") {
        yield { type: "status", message: "Thinking..." };
      } else if (event.type === "result" && typeof event.result === "string") {
        yield { type: "text", message: event.result };
      }
    }
  }

  const exitCode = await new Promise<number>((resolve) =>
    proc.on("close", resolve),
  );

  if (hasMcp) unlink(mcpConfigPath).catch(() => {});

  if (exitCode !== 0) {
    yield {
      type: "error",
      message: stderrOutput || `claude exited with code ${exitCode}`,
    };
  }
}
