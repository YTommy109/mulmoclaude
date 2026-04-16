// @package-contract — see ./types.ts
//
// Express middleware factory for the transport chat bridge.
// `createChatService(deps)` returns a Router you mount with
// `app.use(createChatService(deps))`. All host-app dependencies
// arrive through `deps`; the module has no direct imports from
// `../routes/…`, `../roles.js`, `../session-store/…`, or `../logger/…`
// so it can be lifted into a standalone npm package without
// internal edits. See #269 / #305.

import { Router } from "express";
import type { Request, Response } from "express";
import { API_ROUTES } from "../../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../../src/types/events.js";
import { createChatStateStore } from "./chat-state.js";
import { createCommandHandler } from "./commands.js";
import type { ChatServiceDeps, OnSessionEventFn } from "./types.js";

// ── Types ────────────────────────────────────────────────────

interface ChatRequestBody {
  text: string;
}

interface ChatRequestParams {
  transportId: string;
  externalChatId: string;
}

interface ConnectRequestBody {
  chatSessionId: string;
}

interface ConnectRequestParams {
  transportId: string;
  externalChatId: string;
}

// ── Constants ────────────────────────────────────────────────

const REPLY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Inlined (not imported from `../utils/httpError.js`) so the module
// has no outbound dependency on the host app's utility modules.
// See `@package-contract` in ./types.ts.
const badRequest = (res: Response, error: string) =>
  res.status(400).json({ error });
const notFound = (res: Response, error: string) =>
  res.status(404).json({ error });

// ── Factory ──────────────────────────────────────────────────

export function createChatService(deps: ChatServiceDeps): Router {
  const { startChat, onSessionEvent, loadAllRoles, getRole, defaultRoleId } =
    deps;
  const logger = deps.logger;
  const store = createChatStateStore({
    transportsDir: deps.transportsDir,
    logger,
  });
  const handleCommand = createCommandHandler({
    loadAllRoles,
    getRole,
    resetChatState: store.resetChatState,
  });

  const router = Router();

  // POST /api/chat/:transportId/:externalChatId — send text, get a reply.
  router.post(
    API_ROUTES.chatService.message,
    async (
      req: Request<ChatRequestParams, unknown, ChatRequestBody>,
      res: Response,
    ) => {
      const { transportId, externalChatId } = req.params;
      const text =
        typeof req.body?.text === "string" ? req.body.text.trim() : "";

      if (!text) {
        badRequest(res, "text is required");
        return;
      }

      logger.info("chat-service", "message received", {
        transportId,
        externalChatId,
        textLength: text.length,
      });

      let chatState = await store.getChatState(transportId, externalChatId);
      if (!chatState) {
        const defaultRole = getRole(defaultRoleId);
        chatState = await store.resetChatState(
          transportId,
          externalChatId,
          defaultRole.id,
        );
      }

      const commandResult = await handleCommand(text, transportId, chatState);
      if (commandResult) {
        res.json({ reply: commandResult.reply });
        return;
      }

      const result = await startChat({
        message: text,
        roleId: chatState.roleId,
        chatSessionId: chatState.sessionId,
      });

      if (result.kind === "error") {
        const status = result.status ?? 500;
        if (status === 409) {
          // Session busy — tell the bridge to retry.
          res.status(409).json({
            reply: "A previous message is still being processed. Please wait.",
          });
          return;
        }
        logger.error("chat-service", "startChat failed", {
          transportId,
          externalChatId,
          error: result.error,
        });
        res.status(status).json({ reply: `Error: ${result.error}` });
        return;
      }

      try {
        const reply = await collectAgentReply(
          onSessionEvent,
          chatState.sessionId,
        );
        await store.setChatState(transportId, {
          ...chatState,
          updatedAt: new Date().toISOString(),
        });
        res.json({ reply });
      } catch (err) {
        logger.error("chat-service", "reply collection failed", {
          transportId,
          externalChatId,
          error: String(err),
        });
        res.status(500).json({ reply: "Error: failed to collect agent reply" });
      }
    },
  );

  // POST /api/chat/:transportId/:externalChatId/connect — reassign
  // the active session pointer for a transport chat.
  router.post(
    API_ROUTES.chatService.connect,
    async (
      req: Request<ConnectRequestParams, unknown, ConnectRequestBody>,
      res: Response,
    ) => {
      const { transportId, externalChatId } = req.params;
      const chatSessionId =
        typeof req.body?.chatSessionId === "string"
          ? req.body.chatSessionId.trim()
          : "";

      if (!chatSessionId) {
        badRequest(res, "chatSessionId is required");
        return;
      }

      const updated = await store.connectSession(
        transportId,
        externalChatId,
        chatSessionId,
      );
      if (!updated) {
        notFound(res, "No chat state found for this transport");
        return;
      }

      res.json({ ok: true });
    },
  );

  return router;
}

// Startable independent of the host app — `startChat` is the only
// outward call, and it's a plain function reference from deps.
// Keeping this helper free of closure over deps (taking
// `onSessionEvent` as a parameter) means future packaging doesn't
// need to re-capture anything.
function collectAgentReply(
  onSessionEvent: OnSessionEventFn,
  chatSessionId: string,
): Promise<string> {
  return new Promise((resolve) => {
    const textChunks: string[] = [];

    const timer = setTimeout(() => {
      unsubscribe();
      resolve(
        textChunks.join("") ||
          "The request timed out before a reply was generated.",
      );
    }, REPLY_TIMEOUT_MS);

    const unsubscribe = onSessionEvent(chatSessionId, (event) => {
      const type = event.type as string;

      if (type === EVENT_TYPES.text) {
        textChunks.push(event.message as string);
      }

      if (type === EVENT_TYPES.error) {
        clearTimeout(timer);
        unsubscribe();
        resolve(`Error: ${event.message as string}`);
      }

      if (type === EVENT_TYPES.sessionFinished) {
        clearTimeout(timer);
        unsubscribe();
        resolve(
          textChunks.join("") ||
            "The assistant completed the request but produced no text reply.",
        );
      }
    });
  });
}

export type {
  ChatServiceDeps,
  StartChatFn,
  OnSessionEventFn,
} from "./types.js";
