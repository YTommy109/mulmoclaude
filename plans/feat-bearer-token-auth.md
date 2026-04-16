# Bearer token auth for all HTTP server-client endpoints (#272 Phase 1)

## Motivation

Every `/api/*` endpoint is currently reachable from any local process on the
same machine: other users' programs, malicious web pages (via CORS-less fetch
to `localhost:3001`), any browser tab. The existing `csrfGuard` only blocks
cross-origin *browser* calls; CLI / server-to-server requests with no `Origin`
header pass through. That's intentional (bridges need to work) but leaves
local-process isolation broken.

Bearer token auth closes this gap: only clients that know the
per-startup-generated token can reach `/api/*`.

## Scope — Phase 1 only

Covered in this PR:

1. Server-side token generation (per startup, random 32-byte hex, file-backed)
2. `bearerAuth` Express middleware on `/api/*`
3. Token file lifecycle (write on start, delete on graceful shutdown)
4. Vue client reads token from `<meta>` tag injected into `index.html`
5. Dev: Vite plugin injects token via `transformIndexHtml`
6. Prod: Express serves `client/index.html` with token substituted at request time
7. `src/utils/api.ts` already has `setAuthToken()` scaffolding (#279) — wire it
   up from `src/main.ts` bootstrap
8. Unit tests + E2E smoke test (401 on missing token)
9. Docs in `docs/developer.md`

**Deferred to follow-up PRs:**
- Phase 2: bridges/cli integration (env var `MULMOCLAUDE_AUTH_TOKEN` or read
  token file directly). Issue #272 step 7.
- Phase 3: token rotation endpoint, bridge/UI token split, `.env` override for
  fixed test tokens.

## Design decisions

**(1) Token delivery to Vue**: Vite plugin `transformIndexHtml` hook reads
`<workspace>/.session-token` at each request and injects
`<meta name="mulmoclaude-auth" content="TOKEN">`. Production uses a custom
Express route on `GET /` (and the SPA fallback `GET *`) that reads
`client/index.html`, substitutes the placeholder, and sends.

Rationale vs. alternatives:
- An auth-exempt `/api/auth/bootstrap` endpoint would defeat bearer auth: any
  local process could fetch it first, steal the token, then use it.
- Reverse-proxying Vite through Express breaks HMR and the `:5173` dev
  experience developers already rely on.

**(2) Token file location**: `<workspace>/.session-token` under
`WORKSPACE_FILES.sessionToken`. Hidden dotfile at the workspace root, mode
`0600`. Same workspace (not `~/.mulmoclaude/...`) so bridges can locate it
via the already-known workspace path.

**(3) File lifecycle**:

| Event | Action |
|---|---|
| Server start | Generate new token, atomic-write to file (mode 0600) |
| Vue page load / reload / new tab | Vite plugin re-reads file, re-injects meta |
| HMR | No file I/O — Vue keeps token in memory, SPA never reloads |
| Bridge start (Phase 2) | Reads same file |
| `SIGINT` / `SIGTERM` | Best-effort `unlink` |
| Crash / `kill -9` | File may remain. Harmless — next startup overwrites; old token no longer matches the new in-memory one, so stolen stale tokens fail 401. |

**(4) CSRF + Bearer layering**: `csrfGuard` (origin check) stays as-is.
Bearer auth is a second layer. Both must pass for `/api/*`. CSRF guard
catches drive-by web attacks that arrive with a cross-origin `Origin` header;
bearer guard catches local processes that bypass browser CORS entirely.

**(5) `/api/health` stays auth-protected.** The health check is a server-
internal diagnostic; there's no reason to expose it unauthenticated. If a
future use case needs a ping endpoint (e.g. process supervisor), it goes at a
different path and has its own review.

**(6) No `as` casts.** `setAuthToken()` in `src/utils/api.ts` already has the
right types. The Vite plugin and middleware use narrow explicit types.

## File plan

| File | Kind | Purpose |
|---|---|---|
| `server/auth/token.ts` | new | `getCurrentToken()`, `generateAndWriteToken()`, `deleteTokenFile()` |
| `server/auth/bearerAuth.ts` | new | Express middleware |
| `server/workspace-paths.ts` | edit | Add `WORKSPACE_FILES.sessionToken` + `WORKSPACE_PATHS.sessionToken` |
| `server/index.ts` | edit | Generate on startup, apply middleware, register shutdown handlers, prod HTML route |
| `index.html` | edit | Add `<meta name="mulmoclaude-auth" content="__MULMOCLAUDE_AUTH_TOKEN__">` placeholder |
| `vite.config.ts` | edit | `transformIndexHtml` plugin that reads token file |
| `src/main.ts` | edit | Read meta tag, call `setAuthToken()` |
| `src/utils/api.ts` | no change | Already has `setAuthToken` + header injection |
| `test/server/test_auth_token.ts` | new | Token generation, file write/delete, idempotency |
| `test/server/test_bearerAuth.ts` | new | Middleware: valid token → next, missing/mismatched → 401 |
| `e2e/tests/auth.spec.ts` | new | Smoke: page loads, token is present in meta, fetch succeeds |
| `docs/developer.md` | edit | Auth section |

## Testing

**Unit** (`node:test`):
- `test_auth_token.ts`: `generateAndWriteToken` produces 64-char hex; file
  exists with mode `0600` on POSIX; second call rotates; `deleteTokenFile`
  unlinks; unlink is idempotent (missing file OK).
- `test_bearerAuth.ts`: no Authorization header → 401; wrong Bearer → 401;
  correct Bearer → `next()` called with no args.

**E2E** (Playwright):
- Existing tests (mocked `/api/*`) must keep passing — Vite dev plugin
  fallback injects an empty token when file is missing, mocks don't check
  headers.
- New `auth.spec.ts`: page loads, `<meta name="mulmoclaude-auth">` is present
  and non-empty, mocked fetch sees an `Authorization: Bearer ...` header.

**Cross-platform**:
- `mode: 0o600` is a no-op on Windows — documented, acceptable for dev tool.
- File rename (atomic write) goes through `writeFileAtomic` which already
  handles the sibling-tmp pattern correctly on Windows.

## Rollout / compatibility

This PR is a **breaking change** for any bridge / external client that hits
`/api/*` without credentials. In this repo, only the Vue client and the
existing `bridges/cli` call `/api/*`; Phase 2 will fix the CLI bridge. Until
then, running the CLI bridge against this server will 401. Docs call this
out explicitly.

Existing users running `yarn dev` see no change — same endpoints, token
injected transparently.
