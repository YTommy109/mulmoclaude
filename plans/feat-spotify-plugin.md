# Spotify plugin (read-only v1) — issue #1162

User の Spotify listening data (お気に入り / playlists / 最近聞いた曲) を mulmoclaude 内で扱える plugin を追加する。memory (`interest/music.md`) や calendar との cross-reference、`presentChart` でのジャンル可視化など、**他機能と組み合わせて初めて活きる**用途を想定。

## 確定した設計判断 (issue #1162 で確認済み)

1. **Token + cache の置き場所**: `~/mulmoclaude/config/spotify/` に同居 (tokens.json + cache/{liked,playlists}.json)。User の backup 単位が同じ。
2. **Spotify Developer App の登録**: User 各自が Spotify dashboard で app を登録し、Client ID を `.env` に貼る。Telegram / LINE bridge と同じ流儀。Per-user で redirect URI の port 制約 / rate limit / プライバシ全部解決。
3. **Setup guide の置き場所**: `docs/tips/spotify-setup.{md,en.md}`。Obsidian / Bedrock / Claude Code × Ollama と並ぶ。

## Scope (v1, read-only)

LLM-facing は kind discriminated union 1 ツール:

```ts
manageSpotify({ kind: "liked",          limit?: 50 })
manageSpotify({ kind: "playlists" })
manageSpotify({ kind: "playlistTracks", playlistId, limit?: 100 })
manageSpotify({ kind: "recent",         limit?: 50 })  // API 上限
manageSpotify({ kind: "nowPlaying" })
manageSpotify({ kind: "status" })       // 接続状態のみ
manageSpotify({ kind: "diagnose" })     // 設定切り分け用
```

## File layout

```
src/plugins/spotify/
  meta.ts          # META: toolName / apiNamespace / apiRoutes / workspaceDirs
  definition.ts    # ToolDefinition + Zod 型
  index.ts         # REGISTRATION
  View.vue         # 接続 UI / リスト表示
  Preview.vue      # tool-result preview
server/api/routes/spotify.ts   # 4 endpoints (dispatch / connect / callback / status)
server/spotify/
  client.ts        # apiCall + 401 自動 refresh
  tokens.ts        # tokens.json read/write
  oauth.ts         # PKCE + state generation
  config.ts        # SPOTIFY_CLIENT_ID 取得 + redirect URI 組み立て
docs/tips/spotify-setup.md
docs/tips/spotify-setup.en.md
```

Plugin META:

```ts
META = definePluginMeta({
  toolName: "manageSpotify",
  apiNamespace: "spotify",
  mcpDispatch: "dispatch",
  apiRoutes: {
    dispatch: { method: "POST", path: "" }, // POST /api/spotify
    connect: { method: "GET", path: "/connect" },
    callback: { method: "GET", path: "/callback" },
    status: { method: "GET", path: "/status" },
  },
  workspaceDirs: {
    spotifyConfig: "config/spotify",
  },
});
```

## OAuth (Authorization Code + PKCE)

1. View で「Connect Spotify」 → `GET /api/spotify/connect`
2. Server が `code_verifier` + `state` を生成、in-memory に保存、`https://accounts.spotify.com/authorize?...` URL を返す
3. ブラウザが Spotify の同意画面に遷移 → 同意後 `redirect_uri = http://127.0.0.1:<port>/api/spotify/callback?code=...&state=...` に戻る
4. Server が `state` を検証 → `code + verifier` で token endpoint を叩いて access + refresh を取得
5. `~/mulmoclaude/config/spotify/tokens.json` に保存。pubsub で `spotify:connected` を publish
6. View が pubsub を受けて接続済み UI に切り替え

Access token の TTL は 1h、refresh token は永続。`server/spotify/client.ts` は **401 を見たら自動 refresh して再試行**。

Scope (最小):

- `user-library-read`
- `user-read-recently-played`
- `user-read-currently-playing`
- `playlist-read-private`

## エラー UX (4 状態)

dispatch 共通レスポンス:

```ts
type SpotifyError =
  | { ok: false; error: "client_id_missing";     instructions: string; setupGuide: string }
  | { ok: false; error: "not_connected";         instructions: string; connectUrl: string }
  | { ok: false; error: "auth_expired";          instructions: string; connectUrl: string }
  | { ok: false; error: "client_id_invalid";     instructions: string; setupGuide: string }
  | { ok: false; error: "redirect_uri_mismatch"; instructions: string; redirectUri: string }
  | { ok: false; error: "rate_limited";          instructions: string; retryAfterSec: number }
  | { ok: true;  data: ... };
```

`instructions` は user に見せる日本語 (i18n は v1 では英語フォールバックでも可)。LLM への system prompt に「ok=false なら instructions を verbatim で relay する」を 1 行追加。

## Phasing (3 PR)

### PR 1: Server-side OAuth + token persistence

- `server/spotify/{config,tokens,oauth,client}.ts`
- `server/api/routes/spotify.ts` の `connect / callback / status` 3 endpoints (dispatch はまだ skeleton のみ)
- workspace dir 作成 (`config/spotify/`)
- `docs/tips/spotify-setup.md` (+ en) を書く
- Unit test:
  - `tokens.ts` の read/write round-trip
  - `oauth.ts` の PKCE generation (code_verifier 形式 / state ランダム性)
  - `client.ts` の 401 → refresh → 再試行 (mock fetch)
  - `config.ts` の `getSpotifyClientId` + redirect URI 動的組み立て
- Integration: 手動で OAuth 流して tokens.json が生成されることを確認

**目安**: 600-800 行

### PR 2: Dispatch + 7 kind + plugin View

- `src/plugins/spotify/{meta,definition,index,View,Preview}.{ts,vue}`
- `server/api/routes/spotify.ts` の `POST /api/spotify` (dispatch) 完成
- 各 kind の handler (`liked / playlists / playlistTracks / recent / nowPlaying / status / diagnose`)
- ETag-based cache for `liked` / `playlists`
- View: 接続状態に応じた状態遷移 (setup_required / not_connected / connected / auth_expired / redirect_uri_mismatch)
- Preview: 直近の tool-result を要約表示
- i18n key 追加 (`pluginSpotify.*`) — 8 locale lockstep
- LLM system prompt に 1 行追加 (`ok=false` 時の instructions relay 方針)
- Test: dispatch の各 kind happy path + error path、View の状態遷移 (vitest 不要、unit でロジック分離)

**目安**: 800-1000 行

### PR 3: Memory との連携 (monthly schedule)

- `manageAutomations` で「月初に Spotify listening summary を memory に書く」routine を提供
- LLM が `recent + liked` を取得 → ジャンル / アーティスト / mood を要約 → `conversations/memory/interest/music.md` に append
- skill / role 例追加

**目安**: 200-300 行

## Out of scope (将来 PR)

- Write actions (`addToLiked` / `createPlaylist` / `addToPlaylist`) — `presentForm` で confirm を挟む
- Playback control (`play` / `pause` / `next`) — Premium + active device 必須で edge case が多い
- Apple Music — MusicKit JS の Music User Token 経路が必要、別 issue で

## Test 方針

- **Unit**: pure helper を全部 mock 化 (fetch / fs / Date.now)。`tokens.ts` / `oauth.ts` / `client.ts` で各分岐をカバー
- **Integration**: 手動で 1 度 OAuth を流して tokens.json を作る → CI には sealed token を出さない (test では mock 化)
- **Manual smoke**: README / setup guide 通りに dashboard 登録 → connect → liked / playlists / recent が表示されるかブラウザで確認
- **i18n**: `vue-tsc` が 8 locale lockstep を強制してくれるので key 追加漏れは型エラーで catch

## Risks

- **Spotify API rate limit**: per-app 単位。User 各自登録なら個人 quota だが、polling 頻度は控えめに (recent は cache しない、liked / playlists は ETag)
- **Token rotation**: refresh token は不変だが Spotify が将来 rotate する可能性 (現仕様では返らない)。`tokens.ts` で「response に refresh_token が含まれていれば上書き、なければ既存値維持」の防御
- **Redirect URI port 変更**: User が `--port` を変えたら Spotify dashboard 側も書き換え必要 → setup guide で明記
- **`.env` 紛失**: `SPOTIFY_CLIENT_ID` を消しても tokens.json は残るので接続表示のままになる → diagnose で client_id 状態を出すことで切り分け

## Success criteria

- [ ] User が setup guide 通りに 5 分で接続できる
- [ ] LLM が `manageSpotify({ kind: "liked", limit: 20 })` を呼んでリストを返せる
- [ ] エラー 4 状態すべてで `instructions` が日本語で出る
- [ ] `instructions` を LLM が verbatim で user に流せる (system prompt の 1 行で実現)
- [ ] PR 3 完了後、月次 cron で `interest/music.md` が自動更新される
