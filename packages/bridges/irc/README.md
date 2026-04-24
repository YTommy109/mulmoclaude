# @mulmobridge/irc

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

IRC bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Connects to any IRC server (Libera.Chat, OFTC, self-hosted, etc.).

## Setup

No API keys or bot registration needed — just pick a nickname and connect.

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
IRC_SERVER=irc.libera.chat \
IRC_NICK=mulmo-bot \
IRC_CHANNELS=#your-channel \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/irc

# With real MulmoClaude
IRC_SERVER=irc.libera.chat \
IRC_NICK=mulmo-bot \
IRC_CHANNELS=#your-channel \
npx @mulmobridge/irc
```

## How it works

- **In channels**: the bot responds only when mentioned (`mulmo-bot: what is 2+2?`)
- **In private messages**: the bot responds to everything

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `IRC_SERVER` | Yes | e.g. `irc.libera.chat` |
| `IRC_NICK` | Yes | Bot nickname |
| `IRC_CHANNELS` | Yes | CSV of channels (e.g. `#mulmo,#test`) |
| `IRC_PORT` | No | Default: 6697 (TLS) or 6667 (plain) |
| `IRC_TLS` | No | `true` (default) or `false` |
| `IRC_PASSWORD` | No | NickServ or server password |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |
| `IRC_BRIDGE_DEFAULT_ROLE` | No | Role id to seed new bridge sessions with (e.g. `coder`, `general`). Applied ONLY when a irc session first appears — once the user switches role via `/role <id>` the session's own role wins. Unknown role ids silently fall back to the server's default with a warn log. |
| `BRIDGE_DEFAULT_ROLE` | No | Same as above but shared across every bridge. Transport-specific `IRC_BRIDGE_DEFAULT_ROLE` wins when both are set. |

## Ecosystem

Part of the [`@mulmobridge/*`](https://www.npmjs.com/~mulmobridge) package family.

**Shared libraries:**

- [`@mulmobridge/client`](https://www.npmjs.com/package/@mulmobridge/client) — socket.io client library used by every bridge below
- [`@mulmobridge/protocol`](https://www.npmjs.com/package/@mulmobridge/protocol) — wire types and constants
- [`@mulmobridge/chat-service`](https://www.npmjs.com/package/@mulmobridge/chat-service) — server-side relay + session store
- [`@mulmobridge/relay`](https://www.npmjs.com/package/@mulmobridge/relay) — Cloudflare Workers webhook proxy
- [`@mulmobridge/mock-server`](https://www.npmjs.com/package/@mulmobridge/mock-server) — mock server for local bridge development

**Bridges** (one npm package per platform):

- [`@mulmobridge/bluesky`](https://www.npmjs.com/package/@mulmobridge/bluesky) — Bluesky DMs over atproto
- [`@mulmobridge/chatwork`](https://www.npmjs.com/package/@mulmobridge/chatwork) — Chatwork (Japanese business chat)
- [`@mulmobridge/cli`](https://www.npmjs.com/package/@mulmobridge/cli) — interactive terminal bridge
- [`@mulmobridge/discord`](https://www.npmjs.com/package/@mulmobridge/discord) — Discord bot via Gateway
- [`@mulmobridge/email`](https://www.npmjs.com/package/@mulmobridge/email) — IMAP poll + SMTP reply, threading preserved
- [`@mulmobridge/google-chat`](https://www.npmjs.com/package/@mulmobridge/google-chat) — Google Chat via MulmoBridge relay
- [`@mulmobridge/irc`](https://www.npmjs.com/package/@mulmobridge/irc) — IRC (Libera, Freenode, custom)  ← **this package**
- [`@mulmobridge/line`](https://www.npmjs.com/package/@mulmobridge/line) — LINE Messaging API via MulmoBridge relay
- [`@mulmobridge/line-works`](https://www.npmjs.com/package/@mulmobridge/line-works) — LINE Works (enterprise LINE)
- [`@mulmobridge/mastodon`](https://www.npmjs.com/package/@mulmobridge/mastodon) — Mastodon DMs + mentions
- [`@mulmobridge/matrix`](https://www.npmjs.com/package/@mulmobridge/matrix) — Matrix / Element
- [`@mulmobridge/mattermost`](https://www.npmjs.com/package/@mulmobridge/mattermost) — Mattermost
- [`@mulmobridge/messenger`](https://www.npmjs.com/package/@mulmobridge/messenger) — Facebook Messenger via MulmoBridge relay
- [`@mulmobridge/nostr`](https://www.npmjs.com/package/@mulmobridge/nostr) — Nostr NIP-04 encrypted DMs
- [`@mulmobridge/rocketchat`](https://www.npmjs.com/package/@mulmobridge/rocketchat) — Rocket.Chat
- [`@mulmobridge/signal`](https://www.npmjs.com/package/@mulmobridge/signal) — Signal via signal-cli-rest-api
- [`@mulmobridge/slack`](https://www.npmjs.com/package/@mulmobridge/slack) — Slack Socket Mode
- [`@mulmobridge/teams`](https://www.npmjs.com/package/@mulmobridge/teams) — Microsoft Teams via Bot Framework
- [`@mulmobridge/telegram`](https://www.npmjs.com/package/@mulmobridge/telegram) — Telegram bot
- [`@mulmobridge/twilio-sms`](https://www.npmjs.com/package/@mulmobridge/twilio-sms) — SMS via Twilio Programmable Messaging
- [`@mulmobridge/viber`](https://www.npmjs.com/package/@mulmobridge/viber) — Viber Public Account bots
- [`@mulmobridge/webhook`](https://www.npmjs.com/package/@mulmobridge/webhook) — generic HTTP webhook bridge
- [`@mulmobridge/whatsapp`](https://www.npmjs.com/package/@mulmobridge/whatsapp) — WhatsApp Cloud API via MulmoBridge relay
- [`@mulmobridge/xmpp`](https://www.npmjs.com/package/@mulmobridge/xmpp) — XMPP / Jabber
- [`@mulmobridge/zulip`](https://www.npmjs.com/package/@mulmobridge/zulip) — Zulip


## License

MIT
