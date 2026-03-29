import { randomUUID } from "crypto";
import { Router, Request, Response } from "express";
import { getRole } from "../../src/config/roles.js";
import { runAgent } from "../agent.js";
import { registerSession, removeSession, pushToSession } from "../sessions.js";
import { workspacePath } from "../workspace.js";

const router = Router();
const PORT = Number(process.env.PORT) || 3001;

// Called by the MCP server to push a ToolResult into the active SSE stream
router.post("/internal/tool-result", (req: Request, res: Response) => {
  const { session } = req.query as { session: string };
  const pushed = pushToSession(session, { type: "tool_result", result: req.body });
  res.json({ ok: pushed });
});

router.post("/agent", async (req: Request, res: Response) => {
  const { message, roleId } = req.body as { message: string; roleId: string };

  if (!message || !roleId) {
    res.status(400).json({ error: "message and roleId are required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sessionId = randomUUID();
  registerSession(sessionId, send);
  const role = getRole(roleId);

  try {
    for await (const event of runAgent(message, role, workspacePath, sessionId, PORT)) {
      send(event);
    }
    send({ type: "status", message: "Done" });
  } catch (err) {
    send({ type: "error", message: String(err) });
  } finally {
    removeSession(sessionId);
    res.end();
  }
});

export default router;
