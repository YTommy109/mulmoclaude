# Spotify plugin (read-only v1) — issue #1162

User の Spotify listening data (お気に入り / playlists / 最近聞いた曲) を mulmoclaude 内で扱える plugin を追加する。memory (`interest/music.md`) や calendar との cross-reference、`presentChart` でのジャンル可視化など、**他機能と組み合わせて初めて活きる**用途を想定。

## 確定した設計判断

1. **Plugin の置き場所**: `packages/spotify-plugin/` (runtime plugin、bookmarks-plugin と同形)。**built-in `src/plugins/spotify/` ではない**。
2. **Host 側に実装を入れない**: Spotify 固有のコードは plugin package に閉じる。Host には generic OAuth callback endpoint を 1 つ足すだけ (= 将来の OAuth-using plugin で再利用可能なインフラ)。
3. **Token + Client ID の置き場所**: `runtime.files.config` 経由で `~/mulmoclaude/config/plugins/@mulmoclaude/spotify-plugin/{tokens,client}.json`。
4. **Spotify Developer App の登録**: User 各自が Spotify dashboard で app を登録 → Client ID を plugin View の "Configure" フォーム or 直接 `client.json` に貼る。共有 client_id にしない理由は redirect URI の port 制約 / rate limit / プライバシ。
5. **Setup guide の置き場所**: `docs/tips/spotify-setup.{md,en.md}`。

## Scope (v1, read-only)

LLM-facing は kind discriminated union 1 ツール `manageSpotify`:

```ts
manageSpotify({ kind: "connect", redirectUri })   // PR 1
manageSpotify({ kind: "oauthCallback", code, state, error })  // PR 1, host が生成
manageSpotify({ kind: "status" })                 // PR 1
manageSpotify({ kind: "diagnose" })               // PR 1
manageSpotify({ kind: "configure", clientId })    // PR 2 (View からのみ)
manageSpotify({ kind: "liked",          limit?: 50 })   // PR 2
manageSpotify({ kind: "playlists" })                    // PR 2
manageSpotify({ kind: "playlistTracks", playlistId, limit?: 100 })  // PR 2
manageSpotify({ kind: "recent",         limit?: 50 })   // PR 2
manageSpotify({ kind: "nowPlaying" })                   // PR 2
```

## File layout

```text
packages/spotify-plugin/
  package.json / vite.config.ts / tsconfig.json / eslint.config.mjs
  src/
    index.ts            # definePlugin entry — handler dispatched on kind
    definition.ts       # TOOL_DEFINITION
    schemas.ts          # Zod parsers (TokensSchema / ClientConfigSchema / DispatchArgs)
    types.ts            # SpotifyTokens / SpotifyError / RefreshResponseFields
    oauth.ts            # PKCE + in-memory pending-auth store
    tokens.ts           # read/write tokens.json + client.json via runtime.files.config
    client.ts           # Spotify Web API client (proactive refresh + 401 retry)
    time.ts             # local ONE_SECOND_MS / ONE_MINUTE_MS (no host imports)
    vue.ts              # PR 1: stub (no View). PR 2: Connect / Configure / status UI
    View.vue            # PR 2
    Preview.vue         # PR 2

server/api/routes/runtime-plugin.ts   # 既存 + 新ルート 1 つ追加 (generic OAuth callback)
server/index.ts                       # bearer-auth exempt regex 拡張のみ
docs/tips/spotify-setup.{md,en.md}
docs/plugin-runtime.md                # OAuth-using plugin recipe を追加
```

## OAuth (Authorization Code + PKCE)

1. View で「Connect Spotify」 → `runtime.dispatch({ kind: "connect", redirectUri })` を呼ぶ。`redirectUri` は View が `${window.location.origin}/api/plugins/runtime/${encodeURIComponent(pkg)}/oauth/callback` で組み立て
2. Plugin が PKCE `code_verifier` + 単発の `state` を生成、in-memory に保存、authorize URL を返す
3. View が `window.location.href = authorizeUrl` でブラウザを Spotify 同意画面に遷移
4. 同意後、Spotify は `redirectUri` (= 上記の callback URL) にブラウザを redirect
5. **Host の generic OAuth callback endpoint** (`GET /api/plugins/runtime/:pkg/oauth/callback`) が browser を受ける
   - URL から `:pkg` を取り出して runtime registry に照会
   - `plugin.execute({}, { kind: "oauthCallback", code, state, error })` を呼ぶ
6. Plugin が `state` を検証 → `code + code_verifier` で token endpoint を叩いて access + refresh を取得 → `runtime.files.config` に `tokens.json` 保存 → pubsub `connected` を publish → `{ html, message }` を返す
7. Host が plugin の `html` (もしくは fallback) をブラウザに render

Access token は 1h、refresh token は永続。`client.ts` の `spotifyApi(...)` が proactive (expiry leeway 30s) + 401 reactive で 1 回だけ refresh → retry。2 回目の 401 は `auth_expired` として user に reconnect を促す。

Scope (最小):
- `playlist-read-private`
- `user-library-read`
- `user-read-currently-playing`
- `user-read-recently-played`

## エラー UX

dispatch 共通レスポンス:

```ts
type SpotifyResult =
  | { ok: true; message: string; data?: ...; html?: string }
  | { ok: false; error: ErrorKind; message: string; instructions?: string; html?: string };

type ErrorKind =
  | "client_id_missing"      // client.json なし
  | "not_connected"          // tokens.json なし
  | "auth_expired"           // refresh が 4xx
  | "unknown_state"          // state 検証失敗 (CSRF / 期限切れ)
  | "redirect_uri_mismatch"  // token exchange 失敗 (Spotify 側 dashboard 不一致)
  | "rate_limited"           // 429
  | "spotify_api_error"      // 5xx / その他
```

`instructions` は user に見せる日本語 (PR 2 で i18n 対応)。LLM への system prompt に「ok=false なら instructions を verbatim で relay」を 1 行追加 (PR 2)。

## Phasing (3 PR)

### PR 1: OAuth surface (this PR)

- `packages/spotify-plugin/` scaffold + plugin source (definePlugin entry, OAuth helpers, token persistence, API client)
- `server/api/routes/runtime-plugin.ts` に generic OAuth callback ルート追加
- `server/index.ts` の bearer-auth exempt regex 拡張
- `docs/tips/spotify-setup.{md,en.md}` (5-step Dashboard 手順)
- `docs/plugin-runtime.md` に OAuth-using plugin recipe 節追加
- Unit tests: oauth (PKCE / state / TTL sweep) / tokens (round-trip / merge) / client (401 retry / proactive refresh / Retry-After parsing)
- Integration test: host's generic OAuth callback endpoint dispatches to plugin
- Manual smoke: build + ledger install + curl で connect → ブラウザで consent → tokens.json が書かれる

**目安**: 800-1000 行 (前回の `server/spotify/` 版と同程度、ただし host を汚さない)

### PR 2: View + 残りの kind

- `packages/spotify-plugin/src/{View,Preview}.vue` + `vue.ts` 完成
  - 接続状態 UI (setup_required / not_connected / connected / auth_expired)
  - "Configure" form for clientId
  - "Connect Spotify" ボタン (redirectUri 組み立て + dispatch)
  - 接続済み時はリスト UI (liked / recent / playlists タブ)
- `kind: liked / playlists / playlistTracks / recent / nowPlaying / configure` の handler 追加
- ETag-based cache for `liked` / `playlists` (`runtime.files.config/cache/`)
- LLM system prompt 微調整 (`ok=false` 時の instructions relay)

**目安**: 800-1200 行

### PR 3: Memory との連携

- `manageAutomations` で「月初に Spotify listening summary を memory に書く」routine を提供
- LLM が `recent + liked` を取得 → ジャンル / アーティスト / mood を要約 → `conversations/memory/interest/music.md` に append
- skill / role 例追加

**目安**: 200-300 行

## Out of scope (将来 PR)

- Write actions (`addToLiked` / `createPlaylist` / `addToPlaylist`) — `presentForm` で confirm
- Playback control (`play` / `pause` / `next`) — Premium + active device 必須
- Apple Music — MusicKit JS の Music User Token 経路、別 issue

## Test 方針

- **Unit (plugin-side)**: `runtime` を fake にして全分岐をカバー (`runtime.fetch` モック / `files.config` を tmpdir 経由)
- **Integration (host-side)**: `test/api/routes/test_runtime_oauth_callback.ts` で generic endpoint が registered plugin に dispatch することを assert
- **Manual smoke**: setup guide 通りに Dashboard 登録 → connect → tokens.json 書き込みを目視
- **i18n**: PR 2 で plugin 側 `lang/` ディレクトリを追加 (host の 8-locale lockstep には乗らない、plugin 内完結)

## Risks

- **Spotify API rate limit**: per-app 単位。User 各自登録なら個人 quota だが、polling 頻度は控えめに (recent は cache しない、liked / playlists は ETag)
- **Token rotation**: refresh token は不変が普通だが Spotify が rotate する可能性。`mergeRefreshResponse` で「response に refresh_token があれば上書き、なければ既存値維持」の防御
- **Redirect URI port 変更**: User が `--port` を変えたら Spotify dashboard 側も書き換え必要 → setup guide で明記
- **Plugin 自身の URL を知らない**: View が `window.location.origin` から組み立て、`redirectUri` を `connect` 時に plugin に渡す ── plugin runtime には `endpoints.oauthCallbackUrl` を expose しない (gui-chat-protocol を太らせない)

## Success criteria

- [ ] Host コードに Spotify 固有のリテラルが 1 つも入っていない (generic OAuth callback ルート + bearer-auth regex のみ)
- [ ] User が setup guide 通りに 5 分で接続できる
- [ ] LLM が `manageSpotify({ kind: "liked", limit: 20 })` を呼んでリストを返せる (PR 2)
- [ ] エラー全状態で `instructions` が日本語で出る
- [ ] PR 3 完了後、月次 cron で `interest/music.md` が自動更新される
