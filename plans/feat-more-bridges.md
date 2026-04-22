# feat: more bridges (Mastodon, Bluesky, Chatwork, XMPP, Rocket.Chat, Signal, Teams)

## Goal

Expand MulmoBridge to 7 more messaging platforms, in priority order of (1) ease of implementation, (2) usability, (3) user base. Ship each with a "standard" feature set and iterate on user feedback.

## Order

| # | Package | Connection | Public URL | Target batch |
|---|---|---|---|---|
| 1 | `@mulmobridge/mastodon` | WebSocket streaming + REST (outbound) | No | Batch A |
| 2 | `@mulmobridge/bluesky` | `@atproto/api` firehose + chat API (outbound) | No | Batch A |
| 3 | `@mulmobridge/chatwork` | Long-polling REST (outbound) | No | Batch B |
| 4 | `@mulmobridge/xmpp` | XMPP over TLS (outbound) | No | Batch B |
| 5 | `@mulmobridge/rocketchat` | Realtime API WebSocket + REST (outbound) | No | Batch C |
| 6 | `@mulmobridge/signal` | signal-cli REST wrapper (outbound) | No (daemon locally) | Batch C |
| 7 | `@mulmobridge/teams` | Bot Framework SDK (webhook) | Yes | Batch D (own PR) |

Batches A-C can each land as one PR. Teams gets its own PR because Azure AD setup dwarfs the code.

## Standard feature set

Every new bridge ships with:

- `TRANSPORT_ID` matching the package name (e.g., `mastodon`)
- `dotenv/config` for env-based config
- `createBridgeClient` + `chunkText` from `@mulmobridge/client`
- Per-platform text length chunking at the platform's native limit
- Allowlist via env var CSV (e.g., `MASTODON_ALLOWED_ACCTS=user@instance,…`). Empty → allow all
- Image attachment forwarding where the platform provides URLs (re-fetch + base64 encode, pass as `attachments[]`)
- Outbound-only connection — no tunnel / relay required
- `onPush` handler wired to platform send API
- Standard error logging with bridge prefix
- README.md with setup + troubleshooting + security note sections, mirroring existing bridges
- `tsconfig.json` extending `../../../config/tsconfig.packages.json`
- Listed in root `package.json` `build:packages`, `packages/README.md` table, `docs/mulmobridge-guide.*` guides

## Scope decisions (defaults)

- **DM-only** where DMs exist as a distinct concept (Mastodon, Bluesky). Mention / channel handling deferred to follow-ups based on feedback.
- **Direct `fetch` + `ws`** over SDKs where the API is simple REST + WebSocket (Mastodon, Chatwork, Rocket.Chat, Signal). Official SDKs adopted only when signing / protocol complexity justifies it (Bluesky → `@atproto/api`; XMPP → `@xmpp/client`; Teams → `botbuilder`).
- **No attachment upload back** to the platform in v0.1.0 — only receiving images from user → forwarding to MulmoClaude. Bot→platform image sends deferred.
- **No persistence** — bridges are stateless, matching the rest of the fleet.

## Milestones

- [ ] Plan doc committed (this file)
- [ ] Issue #XXX opened (meta, tracks all 7)
- [ ] Batch A: Mastodon + Bluesky — feat/bridges-batch-3
- [ ] Batch B: Chatwork + XMPP — feat/bridges-batch-4
- [ ] Batch C: Rocket.Chat + Signal — feat/bridges-batch-5
- [ ] Batch D: Teams — feat/bridge-teams (own PR, depends on Azure AD app setup)

## Open questions (resolve during batch, not before)

- **Multi-account**: users who want both their personal and work accounts simultaneously. Answer: run two bridge processes with different `TRANSPORT_ID` overrides. Document.
- **Rate-limit backoff**: current bridges mostly assume best-effort. Re-examine when we hit one in production.
- **Relay support**: Bluesky / Mastodon have no webhooks; not relevant. Chatwork has webhooks (optional). Teams *requires* webhooks — will need a new relay plugin.
