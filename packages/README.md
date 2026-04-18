# MulmoBridge — Open Bridge Protocol for AI Agents

MulmoBridge is an open protocol and package ecosystem for connecting **any messaging platform** to **any AI agent backend** via socket.io.

While developed alongside [MulmoClaude](https://github.com/receptron/mulmoclaude), the packages are designed to be **backend-agnostic** — you can wire them to Claude Code, OpenAI, a custom LLM pipeline, or any system that can process a text message and return a reply.

## Concept

Most AI chat applications are monolithic: the UI, the agent logic, and the messaging transport are tightly coupled. MulmoBridge separates these concerns into a layered architecture:

```text
┌───────────────────────────────────────────────────────┐
│  Messaging Platforms                                  │
|  (Telegram, LINE, Slack, Discord, CLI, Web, ...)      │
└───────────────┬───────────────────────────────────────┘
                │  socket.io  /ws/chat
┌───────────────▼───────────────────────────────────────┐
│  @mulmobridge/chat-service                            │
│  (Express + socket.io server, DI-pure)                │
│  Handles: auth, relay, push, session state            │
└───────────────┬───────────────────────────────────────┘
                │  startChat(params) → result
┌───────────────▼───────────────────────────────────────┐
│  Your AI Agent Backend                                │
│  (Claude Code, OpenAI, LangChain, custom, ...)        │
└───────────────────────────────────────────────────────┘
```

**Bridges** are lightweight processes (~100-200 lines) that translate between a messaging platform's API and the MulmoBridge socket.io protocol. The `@mulmobridge/client` library handles all the socket.io boilerplate, so a new bridge is just the platform adapter.

## Packages

| Package | Description | npm |
|---|---|---|
| [@mulmobridge/protocol](./protocol/) | Wire protocol types and constants (`EVENT_TYPES`, `Attachment`, socket event names) | [![npm](https://img.shields.io/npm/v/@mulmobridge/protocol)](https://www.npmjs.com/package/@mulmobridge/protocol) |
| [@mulmobridge/chat-service](./chat-service/) | Server-side chat service — Express + socket.io, DI-pure factory. Mount on any Express app | [![npm](https://img.shields.io/npm/v/@mulmobridge/chat-service)](https://www.npmjs.com/package/@mulmobridge/chat-service) |
| [@mulmobridge/client](./client/) | Shared socket.io client library for bridges — connection, auth, send/receive, MIME utils | [![npm](https://img.shields.io/npm/v/@mulmobridge/client)](https://www.npmjs.com/package/@mulmobridge/client) |
| [@mulmobridge/cli](./cli/) | Interactive terminal bridge — talk to your agent from the command line | [![npm](https://img.shields.io/npm/v/@mulmobridge/cli)](https://www.npmjs.com/package/@mulmobridge/cli) |
| [@mulmobridge/telegram](./telegram/) | Telegram bot bridge — long-polling, photo support, chat-ID allowlist | [![npm](https://img.shields.io/npm/v/@mulmobridge/telegram)](https://www.npmjs.com/package/@mulmobridge/telegram) |

## Quick Start

### Use with MulmoClaude (default)

```bash
# Start the MulmoClaude server
yarn dev

# In another terminal — talk from CLI
npx @mulmobridge/cli@latest

# Or connect a Telegram bot
TELEGRAM_BOT_TOKEN=your-token TELEGRAM_ALLOWED_CHAT_IDS=123 \
  npx @mulmobridge/telegram@latest
```

### Use with your own backend

The chat-service is a DI-pure factory — inject your own agent function:

```typescript
import express from "express";
import { createServer } from "http";
import { createChatService } from "@mulmobridge/chat-service";

const app = express();
const server = createServer(app);

const chatService = createChatService({
  // Your agent — receives a message, returns a reply
  startChat: async ({ text, attachments, roleId }) => {
    const reply = await myAgent.run(text);
    return { reply };
  },
  // Minimal deps (see chat-service README for full interface)
  onSessionEvent: () => {},
  loadAllRoles: async () => [{ id: "default", name: "Assistant" }],
  getRole: async () => ({ id: "default", name: "Assistant" }),
  defaultRoleId: "default",
  transportsDir: "/tmp/transports",
  logger: console,
});

app.use(chatService.router);
chatService.attachSocket(server);
server.listen(3001);
```

Now any MulmoBridge client (CLI, Telegram, or your own) can connect.

## Writing a New Bridge

A bridge is a small program that:

1. Connects to the chat-service via `@mulmobridge/client`
2. Listens for messages on its platform
3. Forwards them to the chat-service and delivers the reply

```typescript
import { createBridgeClient } from "@mulmobridge/client";

const client = createBridgeClient({ transportId: "my-platform" });

// When your platform receives a message:
const ack = await client.send(chatId, text);
if (ack.ok) {
  await sendReplyToMyPlatform(chatId, ack.reply);
}

// Server → bridge async push:
client.onPush((ev) => {
  sendReplyToMyPlatform(ev.chatId, ev.message);
});
```

See the [Bridge Protocol](../docs/bridge-protocol.md) for the full wire-level contract, and the [CLI bridge](./cli/src/index.ts) (~50 lines) as a minimal reference implementation.

### Non-Node bridges

The protocol is just socket.io 4.x — any language with a socket.io client can implement a bridge. See [bridge-protocol.md](../docs/bridge-protocol.md) for the raw event contract without the TypeScript helpers.

## Relation to MulmoClaude

[MulmoClaude](https://github.com/receptron/mulmoclaude) is a GUI chat application powered by Claude Code. The `@mulmobridge/*` packages were extracted from MulmoClaude to make the messaging layer reusable:

- **MulmoClaude uses these packages** — the server imports `@mulmobridge/chat-service` and `@mulmobridge/protocol`, the bridge scripts use `@mulmobridge/client`
- **The packages don't depend on MulmoClaude** — they work with any Express app and any agent backend
- **MIT licensed** — the packages are MIT (the main MulmoClaude app is AGPL)

This separation means you can build your own AI chat application using the MulmoBridge protocol, or connect MulmoBridge-compatible bridges to a completely different backend.

## Directory Structure

```text
packages/
  protocol/       ← shared types + constants (zero deps)
  chat-service/   ← server-side Express + socket.io service
  client/         ← bridge-side socket.io client + utilities
  cli/            ← reference bridge: interactive terminal
  telegram/       ← production bridge: Telegram bot
```

## License

All packages are MIT licensed. See individual package directories for details.
