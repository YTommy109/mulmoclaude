# @mulmobridge/chatwork

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Chatwork bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Polls unread messages from each room the bot is a member of via the Chatwork REST API, forwards them to MulmoClaude, and posts replies back. Outbound-only — **no public URL needed**.

## Setup

### 1. Get an API token

1. Log into Chatwork.
2. Go to **My → Service Integration → API Token**.
3. Copy the token.

### 2. Add the bot to rooms

Invite the Chatwork user (whose API token you're using) to the rooms where you want it to respond. A dedicated bot account is recommended.

### 3. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
CHATWORK_API_TOKEN=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/chatwork

# With real MulmoClaude
CHATWORK_API_TOKEN=... \
npx @mulmobridge/chatwork
```

Send a message in any room the bot is in — you'll get a reply.

## Environment variables

| Variable                     | Required | Default | Description |
|------------------------------|----------|---------|-------------|
| `CHATWORK_API_TOKEN`         | yes      | —       | API token from My → Service Integration |
| `CHATWORK_ALLOWED_ROOMS`     | no       | (all)   | CSV of room_ids the bot should listen in. Empty = every room the bot is a member of |
| `CHATWORK_POLL_INTERVAL_SEC` | no       | `5`     | Poll interval in seconds (min 2). Chatwork's rate limit is 300 req / 5 min shared across the token |
| `MULMOCLAUDE_AUTH_TOKEN`     | no       | auto    | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL`        | no       | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. On startup the bridge calls `GET /me` to learn the bot's own `account_id` (used to filter out self-posts).
2. Every `CHATWORK_POLL_INTERVAL_SEC` it iterates over the target rooms (`CHATWORK_ALLOWED_ROOMS` if set, else `GET /rooms`) and calls `GET /rooms/{id}/messages?force=0` — the `force=0` form only returns unread messages and marks them as read.
3. For each unread message not authored by the bot, the bridge strips Chatwork markup (`[To:…]`, `[qt]…[/qt]`, `[info]…[/info]`, etc.) from the body and forwards the plain text to MulmoClaude, keying on `room_id` as `externalChatId`.
4. Replies are posted back via `POST /rooms/{id}/messages`, chunked at ~40 000 chars.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/me returned unexpected shape` or 401 | Token missing / revoked | Regenerate from My → Service Integration |
| `403 Forbidden` on send | Token account isn't in the room | Invite the bot user into the room |
| Rate limit errors | Too many rooms × too-short poll interval | Increase `CHATWORK_POLL_INTERVAL_SEC` or restrict `CHATWORK_ALLOWED_ROOMS` |

## Security notes

- The API token grants full read/write as the token holder. Treat like a password.
- Use a dedicated Chatwork bot account — revoking the token then won't affect your personal access.
- Without `CHATWORK_ALLOWED_ROOMS`, the bridge reads every room the bot is a member of. Restrict as needed for personal-data rooms.
- Long replies are posted as a single sequence of messages — Chatwork doesn't thread, so chunks arrive as consecutive posts.
