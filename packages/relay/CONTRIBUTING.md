# Adding a new platform to the Relay

This guide explains how to add support for a new messaging platform
(e.g., Slack, Discord, WhatsApp) to the MulmoBridge Relay.

## Architecture

```text
Platform (LINE/Telegram/Slack/...)
     ↓ webhook / WS / polling
┌──────────────────────────────────────────┐
│  Cloudflare Worker (index.ts)            │
│    ├→ /webhook/<platform>  (webhook mode)│
│    ├→ polling loop         (polling mode)│
│    └→ WS connection        (persistent)  │
│                                          │
│  Platform Plugin (webhooks/<platform>.ts) │
│    ├→ verify signature / auth            │
│    ├→ parse → RelayMessage[]             │
│    └→ sendResponse() back to platform    │
│                                          │
│  Durable Object (durable-object.ts)      │
│    ├→ WS server for MulmoClaude          │
│    ├→ message queue (offline storage)    │
│    └→ route responses via plugin         │
└──────────────────────────────────────────┘
     ↕ WebSocket (wss://)
MulmoClaude (user's computer)
```

## Connection modes

| Mode | How it works | Examples |
|------|-------------|----------|
| `webhook` | Platform sends HTTP POST to our URL | LINE, Messenger, Google Chat |
| `polling` | We fetch updates from platform API | Telegram (alternative) |
| `persistent` | We maintain a WS/SSE connection | Slack Socket Mode, Discord Gateway, Mattermost |

## Step-by-step: adding a webhook platform

### 1. Create the plugin file

Create `src/webhooks/<platform>.ts`:

```typescript
import { PLATFORMS, type RelayMessage, type Env } from "../types.js";
import {
  registerPlatform,
  CONNECTION_MODES,
  type PlatformPlugin,
} from "../platform.js";

const myPlugin: PlatformPlugin = {
  name: PLATFORMS.myPlatform,  // Add to PLATFORMS first
  mode: CONNECTION_MODES.webhook,
  webhookPath: "/webhook/my-platform",

  isConfigured(env: Env): boolean {
    return !!env.MY_PLATFORM_SECRET;
  },

  async handleWebhook(
    request: Request,
    body: string,
    env: Env,
  ): Promise<RelayMessage[]> {
    // 1. Verify signature/auth
    // 2. Parse body into RelayMessage[]
    // 3. Return messages
  },

  async sendResponse(
    chatId: string,
    text: string,
    env: Env,
    replyToken?: string,
  ): Promise<void> {
    // Call the platform's API to send a reply
  },
};

registerPlatform(myPlugin);
```

### 2. Add the platform to PLATFORMS

In `src/types.ts`, add your platform:

```typescript
export const PLATFORMS = {
  // ...existing
  myPlatform: "my-platform",
} as const;
```

### 3. Import in index.ts and durable-object.ts

Add a side-effect import:

```typescript
import "./webhooks/my-platform.js";
```

### 4. Add tests

Create `test/test_<platform>.ts` with:
- Signature verification (valid + invalid)
- Message parsing (text, empty, unsupported types)
- isConfigured check

### 5. Update README and docs

- Add env vars to README's "Configure secrets" section
- Add webhook URL to the table
- Update health endpoint example output

## Step-by-step: adding a polling/persistent platform

For platforms like Slack (Socket Mode) or Discord (Gateway):

1. Set `mode: CONNECTION_MODES.persistent` (or `polling`)
2. Set `webhookPath: null`
3. Implement `startIngestion()` instead of `handleWebhook()`
4. The relay will call `startIngestion()` on startup for configured platforms

```typescript
async startIngestion(
  env: Env,
  onMessage: (msg: RelayMessage) => Promise<void>,
): Promise<() => void> {
  // Connect to platform's WS/polling API
  // When a message arrives, call onMessage()
  // Return a cleanup function
}
```

> Note: Durable Objects have execution time limits. For persistent
> connections, use the Alarm API for periodic keep-alive or consider
> running the ingestion in a separate Worker.

## Relationship to MulmoBridge packages

The **Relay** and the **Bridge packages** (`@mulmobridge/line`,
`@mulmobridge/telegram`, etc.) serve different purposes:

| | Relay | Bridge package |
|---|---|---|
| Runs on | Cloudflare Workers (cloud) | User's computer (local) |
| Connection | Platform → Relay → WS → MulmoClaude | Platform → Bridge → socket.io → MulmoClaude |
| Offline | Messages queued | Messages lost |
| Public URL | Permanent (workers.dev) | Requires ngrok |
| Multi-platform | One relay handles all | One process per platform |

**When to use which:**
- **Relay**: Production use, stable setup, offline queuing needed
- **Bridge**: Quick testing, development, Telegram (polling mode = no URL needed)

The Relay uses the same message format (`RelayMessage`) as the bridge
packages' internal protocol, so they can coexist. A user can run
some platforms via the Relay and others via local bridge processes.

## Security checklist for new platforms

- [ ] Signature/auth verification (HMAC, JWT, secret header, etc.)
- [ ] Timing-safe comparison for secrets
- [ ] Input validation (reject non-text messages gracefully)
- [ ] Response error handling (check API response.ok)
- [ ] Rate limiting (Cloudflare Workers built-in or custom)
- [ ] Message size limits (chunk long responses)
- [ ] No API tokens in logs or error messages
