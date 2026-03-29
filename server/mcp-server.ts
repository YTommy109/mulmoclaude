/**
 * Standalone MCP stdio server — spawned by the Claude CLI via --mcp-config.
 * Bridges Claude's tool calls to our server endpoints and pushes ToolResults
 * back to the active frontend SSE stream via the session registry.
 */

const SESSION_ID = process.env.SESSION_ID ?? "";
const PORT = process.env.PORT ?? "3001";
const PLUGIN_NAMES = (process.env.PLUGIN_NAMES ?? "").split(",").filter(Boolean);
const BASE_URL = `http://localhost:${PORT}`;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  endpoint: string;
}

const ALL_TOOLS: Record<string, ToolDef> = {
  manageTodoList: {
    name: "manageTodoList",
    description:
      "Manage a todo list — show items, add, update, check/uncheck, or delete. Use whenever the user mentions tasks, todos, or things to remember.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["show", "add", "delete", "update", "check", "uncheck", "clear_completed"],
          description: "Action to perform.",
        },
        text: { type: "string", description: "Item text or partial text to find." },
        newText: { type: "string", description: "For 'update' only: replacement text." },
      },
      required: ["action"],
    },
    endpoint: "/api/todos",
  },
};

const tools = PLUGIN_NAMES.map((name) => ALL_TOOLS[name]).filter(Boolean);

function respond(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const res = await fetch(`${BASE_URL}${tool.endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const result = await res.json();

  // Push visual ToolResult to the frontend via the session
  const toolResult = {
    toolName: name,
    uuid: `${SESSION_ID}-${name}`,
    ...result,
  };
  await fetch(`${BASE_URL}/api/internal/tool-result?session=${SESSION_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toolResult),
  });

  return result.message ?? "Done";
}

let buffer = "";

process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    const { id, method, params } = msg as {
      id?: unknown;
      method: string;
      params?: Record<string, unknown>;
    };

    if (method === "initialize") {
      respond({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mulmoclaude", version: "1.0.0" },
        },
      });
    } else if (method === "tools/list") {
      respond({
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      });
    } else if (method === "tools/call") {
      const { name, arguments: toolArgs } = (params ?? {}) as {
        name: string;
        arguments: Record<string, unknown>;
      };
      handleToolCall(name, toolArgs ?? {})
        .then((text) => {
          respond({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text }] },
          });
        })
        .catch((err: unknown) => {
          respond({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: String(err) }], isError: true },
          });
        });
    } else if (method === "ping") {
      respond({ jsonrpc: "2.0", id, result: {} });
    }
    // notifications/initialized and other notifications: no response needed
  }
});

process.stdin.on("end", () => process.exit(0));
