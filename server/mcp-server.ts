/**
 * Standalone MCP stdio server — spawned by the Claude CLI via --mcp-config.
 * Bridges Claude's tool calls to our server endpoints and pushes ToolResults
 * back to the active frontend SSE stream via the session registry.
 */

const SESSION_ID = process.env.SESSION_ID ?? "";
const PORT = process.env.PORT ?? "3001";
const PLUGIN_NAMES = (process.env.PLUGIN_NAMES ?? "")
  .split(",")
  .filter(Boolean);
const ROLE_IDS = (process.env.ROLE_IDS ?? "").split(",").filter(Boolean);
const BASE_URL = `http://localhost:${PORT}`;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  endpoint?: string; // absent for tools handled specially (e.g. switchRole)
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
          enum: [
            "show",
            "add",
            "delete",
            "update",
            "check",
            "uncheck",
            "clear_completed",
          ],
          description: "Action to perform.",
        },
        text: {
          type: "string",
          description: "Item text or partial text to find.",
        },
        newText: {
          type: "string",
          description: "For 'update' only: replacement text.",
        },
      },
      required: ["action"],
    },
    endpoint: "/api/todos",
  },
  presentDocument: {
    name: "presentDocument",
    description: "Display a document in markdown format.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title for the document" },
        markdown: {
          type: "string",
          description: "The markdown content to display.",
        },
      },
      required: ["title", "markdown"],
    },
    endpoint: "/api/present-document",
  },
  presentSpreadsheet: {
    name: "presentSpreadsheet",
    description:
      "Display an Excel-like spreadsheet with formulas and calculations.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title for the spreadsheet" },
        sheets: {
          type: "array",
          description:
            "Sheets to render. Each has a name and 2D array of cells.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              data: {
                type: "array",
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      v: {
                        oneOf: [{ type: "string" }, { type: "number" }],
                        description:
                          "Cell value or formula (string starting with '=')",
                      },
                      f: {
                        type: "string",
                        description:
                          "Format code, e.g. '$#,##0.00', '#,##0', '0.00%', 'MM/DD/YYYY'",
                      },
                    },
                    required: ["v"],
                  },
                },
              },
            },
            required: ["name", "data"],
          },
        },
      },
      required: ["title", "sheets"],
    },
    endpoint: "/api/present-spreadsheet",
  },
  createMindMap: {
    name: "createMindMap",
    description:
      "Create or update an interactive mind map to visualize ideas and their relationships.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "create",
            "add_node",
            "delete_node",
            "connect",
            "update",
            "rebalance",
          ],
          description:
            "Action: create (new map), add_node, delete_node, connect (link two nodes), update, rebalance (recalculate layout)",
        },
        title: {
          type: "string",
          description: "Title of the mind map (required for create)",
        },
        centralIdea: {
          type: "string",
          description: "Central concept (required for create)",
        },
        ideas: {
          type: "array",
          items: { type: "string" },
          description: "Initial branch ideas (for create)",
        },
        parentNodeId: {
          type: "string",
          description: "Parent node ID (for add_node)",
        },
        newIdea: {
          type: "string",
          description: "New idea text (for add_node)",
        },
        nodeIdToDelete: {
          type: "string",
          description: "Node ID to delete (for delete_node)",
        },
        fromNodeId: {
          type: "string",
          description: "Source node ID (for connect)",
        },
        toNodeId: {
          type: "string",
          description: "Target node ID (for connect)",
        },
        connectionLabel: {
          type: "string",
          description: "Optional connection label",
        },
        existingMap: {
          type: "object",
          description:
            "Current mind map state (for update/add_node/connect/rebalance)",
        },
      },
      required: ["action"],
    },
    endpoint: "/api/mindmap",
  },
  generateImage: {
    name: "generateImage",
    description:
      "Generate an image based on the prompt and display it. Be descriptive and specify concrete details in the prompt. Each call generates one image.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A detailed prompt describing the image to generate",
        },
      },
      required: ["prompt"],
    },
    endpoint: "/api/generate-image",
  },
  putQuestions: {
    name: "putQuestions",
    description:
      "Present a set of multiple choice questions to test the user's knowledge or abilities. Each question should have 2-6 answer choices.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional title for the quiz" },
        questions: {
          type: "array",
          description: "Array of multiple choice questions",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              choices: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 6,
              },
              correctAnswer: {
                type: "number",
                description: "0-based index of correct answer",
              },
            },
            required: ["question", "choices"],
          },
          minItems: 1,
        },
      },
      required: ["questions"],
    },
    endpoint: "/api/quiz",
  },
  presentForm: {
    name: "presentForm",
    description:
      "Create a structured form to collect information from the user. Supports text, textarea, radio, dropdown, checkbox, date, time, and number fields.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "text",
                  "textarea",
                  "radio",
                  "dropdown",
                  "checkbox",
                  "date",
                  "time",
                  "number",
                ],
              },
              label: { type: "string" },
              description: { type: "string" },
              required: { type: "boolean" },
              placeholder: { type: "string" },
              choices: { type: "array", items: { type: "string" } },
            },
            required: ["id", "type", "label"],
          },
        },
      },
      required: ["fields"],
    },
    endpoint: "/api/form",
  },
  openCanvas: {
    name: "openCanvas",
    description:
      "Open a drawing canvas for the user to create drawings, sketches, or diagrams.",
    inputSchema: { type: "object", properties: {}, required: [] },
    endpoint: "/api/canvas",
  },
  generateHtml: {
    name: "generateHtml",
    description:
      "Generate a complete, standalone HTML page using AI. Be descriptive about layout, styling, interactivity, colors, and functionality.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed description of the desired HTML page.",
        },
      },
      required: ["prompt"],
    },
    endpoint: "/api/generate-html",
  },
  editHtml: {
    name: "editHtml",
    description:
      "Edit the currently displayed HTML page. Describe the modifications needed; the current HTML will be updated automatically.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Detailed description of the modifications to make.",
        },
      },
      required: ["prompt"],
    },
    endpoint: "/api/edit-html",
  },
  present3d: {
    name: "present3d",
    description:
      "Display interactive 3D visualizations using the full ShapeScript language with expressions, variables, control flow, and functions.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title for the 3D visualization",
        },
        script: {
          type: "string",
          description:
            "ShapeScript code defining the 3D scene. Supports primitives (cube, sphere, cylinder, cone, torus), CSG operations (union, difference, intersection), transformations (position, rotation, size), materials (color, opacity), variables, for-loops, if/else, and math functions like sin/cos.",
        },
      },
      required: ["title", "script"],
    },
    endpoint: "/api/present3d",
  },
  editImage: {
    name: "editImage",
    description:
      "Edit or transform the currently selected image based on a prompt. The user must have an image selected in the sidebar. Use for style transfer, modifications, or transformations of existing images.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "A detailed description of the edits or transformation to apply to the image",
        },
      },
      required: ["prompt"],
    },
    endpoint: "/api/edit-image",
  },
  switchRole: {
    name: "switchRole",
    description:
      "Switch to a different AI role, resetting the conversation context. Use when the user's request is better served by another role.",
    inputSchema: {
      type: "object",
      properties: {
        roleId: {
          type: "string",
          enum: ROLE_IDS,
          description: "The ID of the role to switch to.",
        },
      },
      required: ["roleId"],
    },
  },
};

const tools = PLUGIN_NAMES.map((name) => ALL_TOOLS[name]).filter(Boolean);

function respond(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "switchRole") {
    await fetch(`${BASE_URL}/api/internal/switch-role?session=${SESSION_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: args.roleId }),
    });
    return `Switching to ${args.roleId} role`;
  }

  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const res = await fetch(`${BASE_URL}${tool.endpoint}?session=${SESSION_ID}`, {
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
            result: {
              content: [{ type: "text", text: String(err) }],
              isError: true,
            },
          });
        });
    } else if (method === "ping") {
      respond({ jsonrpc: "2.0", id, result: {} });
    }
    // notifications/initialized and other notifications: no response needed
  }
});

process.stdin.on("end", () => process.exit(0));
