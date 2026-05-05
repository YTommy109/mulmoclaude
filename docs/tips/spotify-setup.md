# Spotify セットアップ手順

mulmoclaude の Spotify plugin を有効にするには、Spotify Developer Dashboard で **自分の app を 1 つ登録**する必要があります(所要 3-5 分)。Discord / Telegram bridge と同じ流儀で、user 各自が登録する方式を取っています ── 共有 client_id だと redirect URI のポート指定や rate limit 共有でハマりやすいためです。

## 必要なもの

- Spotify アカウント (Free でも OK)
- mulmoclaude を動かしているポート(デフォルト `3001`、`--port` で変えている場合はその値)

## 手順

### 1. Spotify Developer Dashboard でアプリを作成

[https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) を開いて、Spotify アカウントでログインしてください。

「**Create app**」ボタンを押して、フォームに以下を入力:

- **App name**: 任意 (例: `MulmoClaude (local)`)
- **App description**: 任意 (例: `Personal listening data integration`)
- **Redirect URIs**: `http://127.0.0.1:3001/api/spotify/callback` を **追加して保存**(ポートが 3001 でない場合はその値に置き換え)
- **Which API/SDKs are you planning to use?**: **Web API** をチェック
- 利用規約に同意して「Save」

> **注意**: Redirect URI は **完全一致**で照合されます。`localhost` ではなく `127.0.0.1` を使ってください。Spotify は `http://127.0.0.1` および `http://[::1]` の loopback redirect だけは HTTPS を要求しません。

### 2. Client ID をコピー

作成したアプリのページで「**Settings**」を開くと **Client ID** が表示されます(`Client secret` は PKCE フローでは使わないので無視で OK)。長い英数字列をコピーしてください。

### 3. mulmoclaude の `.env` に追加

`~/mulmoclaude/.env` ファイルを開いて(なければ新規作成)、以下の行を追加:

```
SPOTIFY_CLIENT_ID=ここにペースト
```

### 4. mulmoclaude を再起動

mulmoclaude のサーバを再起動すると、Spotify plugin が `SPOTIFY_CLIENT_ID` を読み込みます。

### 5. 接続

mulmoclaude のチャットで「Spotify を接続して」と言うか、Spotify plugin の View にある「Connect Spotify」ボタンを押すと、Spotify の同意画面が開きます。許可すると、認可情報が `~/mulmoclaude/config/spotify/tokens.json` に保存され、以降の API 呼び出しで自動的に使われます。

## トラブルシューティング

### `INVALID_CLIENT: Invalid redirect URI`

Spotify Dashboard に登録した Redirect URI と、mulmoclaude が動いているポートが一致していません。

1. mulmoclaude の起動ログでポート番号を確認(例: `listening port=3099`)
2. Dashboard の Settings で Redirect URIs に `http://127.0.0.1:<その番号>/api/spotify/callback` を追加
3. Save → mulmoclaude チャットで再度「Spotify 接続」を試す

`--port` を切り替える場合は、よく使うポート(3001 / 3099 など)をまとめて登録しておくと楽です。

### `INVALID_CLIENT: Invalid client`

`SPOTIFY_CLIENT_ID` の値が違います。Dashboard の Client ID をもう一度コピーして、`.env` を上書きしてから mulmoclaude を再起動してください。

### Token が古くなった / 接続が切れた

`~/mulmoclaude/config/spotify/tokens.json` を削除してから「Connect Spotify」をやり直してください。Spotify が refresh token を rotate した、scope を変えたい、別の Spotify アカウントに切り替えたい、いずれの場合もこれで OK です。

### クライアント ID は安全に扱える?

PKCE フローを使っているので Client Secret はそもそも持ちません。Client ID 単体は **公開しても問題ない**情報ですが、念のため `.env` を git に commit しないでください(mulmoclaude の `.gitignore` は標準で `.env` を除外しています)。

## 何が取れる?

read-only v1 では以下が取れます:

- お気に入り(Liked Songs)
- Playlists 一覧 / 各 playlist のトラック
- 最近聞いた曲(直近 50 曲、Spotify API の上限)
- 今再生中の曲

Playback 制御(再生 / 一時停止 / スキップ)や書き込み(Liked に追加 / playlist 作成)は別 PR で対応予定です。

## 関連ドキュメント

- 設計: `plans/feat-spotify-plugin.md`
- 実装 issue: [#1162](https://github.com/receptron/mulmoclaude/issues/1162)
- 公式ドキュメント: [Spotify Web API Authorization Guide](https://developer.spotify.com/documentation/web-api/concepts/authorization)
