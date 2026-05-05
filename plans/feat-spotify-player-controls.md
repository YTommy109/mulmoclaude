# Spotify Player Controls (PR 3 of #1162)

PR 1 と PR 2 で OAuth + listening data まで揃ったので、PR 3 で **再生制御** (Player API) を追加する。Premium ユーザ限定機能なので Free ユーザでもクラッシュ・誤解しないように UX を設計する。

## スコープ (PR 3)

### dispatch kinds (新規 — LLM-callable)

| kind | endpoint | scope | 備考 |
|---|---|---|---|
| `play` | `PUT /v1/me/player/play` | `user-modify-playback-state` | optional `contextUri` (playlist/album) or `trackUris[]` |
| `pause` | `PUT /v1/me/player/pause` | 同 | |
| `next` | `POST /v1/me/player/next` | 同 | |
| `previous` | `POST /v1/me/player/previous` | 同 | |
| `seek` | `PUT /v1/me/player/seek?position_ms=N` | 同 | |
| `setVolume` | `PUT /v1/me/player/volume?volume_percent=N` | 同 | 0–100 |
| `transferPlayback` | `PUT /v1/me/player` (body: `{device_ids}`) | 同 | デバイス切替 |
| `getDevices` | `GET /v1/me/player/devices` | `user-read-playback-state` | 利用可能デバイス一覧 |

### Premium 判定

- 新エンドポイント呼び出し: `GET /v1/me` → `product: "premium" | "free" | "open"`
- 取得タイミング: `status` 呼び出し時に lazy fetch (キャッシュは `tokens.json` に `productCachedAt` で 24h 有効)
- `status` レスポンスに `isPremium: boolean` フィールドを追加
- View が `isPremium === false` のとき Player タブを **disabled** にし、"Spotify Premium required" 注意書きを表示
- LLM 側: tool description に "Playback controls require Spotify Premium" を明記、`play` 等の handler が `productCachedAt` を見て `{ ok: false, error: "premium_required", message: "Spotify Premium が必要です" }` を即返す

### 必要な追加 scope

OAuth 接続時に request する scope を拡張:

```ts
const SPOTIFY_SCOPES = [
  // 既存 (PR 1):
  "playlist-read-private",
  "user-library-read",
  "user-read-currently-playing",
  "user-read-recently-played",
  // PR 3 で追加:
  "user-modify-playback-state",  // play/pause/next/prev/seek/volume/transfer
  "user-read-playback-state",    // getDevices
];
```

**マイグレーション**: 既存接続済みユーザは新 scope なしの古い token を持っている。`status` は動くが `play` 等で 403 が返る → handler が "scope_missing — please reconnect" エラーで View に reconnect を促す。

### View 変更

- 新タブ "Player" (Now Playing と同居 or 置換)
  - 上半分: 現在再生中曲のカード (PR 2 既存)
  - 下半分 (Premium のみ): Play/Pause toggle, Prev / Next, Volume slider, Device 切替 dropdown
- Free ユーザは下半分が grey out + "Premium required" バッジ
- 接続済 + Premium だが No Active Device のとき: "Open Spotify on a device to enable playback" メッセージ + getDevices で取得した device 一覧を表示してクリックで transferPlayback

### Preview.vue 変更

なし（再生制御は副作用系で表示するデータがない、`play` 等の結果は `{ ok: true, message: "Playing X" }` で十分）

## スコープ外 (将来の PR)

| 機能 | endpoint | 想定 PR |
|---|---|---|
| Liked add/remove | `PUT/DELETE /v1/me/tracks?ids=` | PR 4 (`user-library-modify` scope 追加) |
| Playlist 作成/編集 | `POST /v1/users/{id}/playlists` 等 | PR 5 |
| ~~Search~~ | ~~`GET /v1/search`~~ | ✓ 完了 (PR #1168) |
| Audio analysis | `GET /v1/audio-features/{id}` | PR 7+ (推薦 / クラスタリング用) |

## 実装順 (1 PR 内)

1. **schemas.ts**: `SPOTIFY_KINDS` に 8 個追加 (play/pause/next/previous/seek/setVolume/transferPlayback/getDevices)、`LLM_CALLABLE_KINDS` も拡張、`DispatchArgsSchema` の discriminated union に追加
2. **definition.ts**: parameters に `volumePercent` / `positionMs` / `deviceIds` / `contextUri` / `trackUris` を追加
3. **profile.ts** (新規): `/v1/me` を呼んで `product` をキャッシュ。`getProductFresh(deps)` / `isPremium(deps)` / `clearProductCache(files)`
4. **playback.ts** (新規): 8 kinds の handler. Premium gate を関数の入口に入れる
5. **index.ts** dispatcher に 8 kinds 追加。`status` を拡張して `isPremium` を含める
6. **scope 拡張**: `index.ts` の `SPOTIFY_SCOPES` に 2 個追加
7. **View.vue**: Player タブ追加 + Premium gate UI
8. **lang/{en,ja}.ts**: 新規 i18n キー (player controls / premium required / no active device)
9. **tests**: profile cache、premium gate、各 kind の endpoint + status code を mock で確認
10. **doc**: `docs/tips/spotify-setup.md` に "Premium 不要 / 必要" 表を追加、`plans/done/feat-spotify-plugin.md` に PR 3 完了マーク

## オープンな設計判断

1. **Player タブを Now Playing と分けるか統合するか** → 統合 (Now Playing カードの下に Premium のときだけ Controls を生やす) のが自然そう。Free ユーザは Now Playing は見れる、Controls だけ消える。
2. **`play` の引数**: `contextUri` (playlist/album/show を再生) と `trackUris[]` (個別 track を queue) を両方サポートするか、片方だけか → Spotify API は両方サポート。LLM が「お気に入りから 5 曲流して」をやるには `trackUris[]` が便利。両方入れる。
3. **デバイス選択 UX**: 自動で最初のデバイスを選ぶ vs 必ずユーザに選ばせる → 接続済デバイスが 1 つなら自動、複数なら dropdown で選ばせる。
4. **再生状態の polling 頻度** → polling しない。Refresh ボタンで `getCurrentlyPlaying` + `getDevices` を再 fetch。WebSocket は Spotify 側にないので polling しか手がないが、~3 秒間隔で自動 polling は API quota とバッテリ的に重い。Refresh 押してもらう方針。
5. **エラー UX**: Spotify が "No active device" を返したとき (404) → エラーバナー + デバイス選択 UI を出す。`play` のとき特に重要。

## テスト

- profile cache TTL (24h)、cache hit / miss の挙動
- Premium gate: free ユーザが `play` を呼ぶと `premium_required` エラー
- 各 kind の URL + method + body 形状
- `transferPlayback` の `play: true` (再生継続) 動作
- `setVolume` の 0-100 範囲外
- 401 retry-once は client.ts 側で既存テスト済 — 再テスト不要

## マイグレーション/既存ユーザ

- PR 3 をマージしても既存ユーザの `tokens.json` に追加 scope は入らない
- `play` 等を呼ぶと Spotify が `403 Insufficient client scope` を返す
- Plugin がそれを検出 → `{ ok: false, error: "scope_missing", message: "新しい権限の追加が必要です。Connect をやり直してください。" }`
- View が "Reconnect" ボタンを目立つ場所に出す
