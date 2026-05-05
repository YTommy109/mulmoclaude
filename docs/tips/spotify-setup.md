# Spotify セットアップ手順

mulmoclaude の Spotify plugin (`@mulmoclaude/spotify-plugin`) を使うには、Spotify Developer Dashboard で **自分の app を 1 つ登録**する必要があります(所要 3-5 分)。Discord / Telegram bridge と同じ流儀で、user 各自が登録する方式を取っています ── 共有 client_id だと redirect URI のポート指定や rate limit 共有でハマりやすいためです。

## 必要なもの

- Spotify アカウント (Free でも OK)
- mulmoclaude を動かしているポート(デフォルト `3001`、`--port` で変えている場合はその値)

## 手順

### 1. Spotify Developer Dashboard でアプリを作成

[https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) を開いて、Spotify アカウントでログインしてください。

「**Create app**」ボタンを押して、フォームに以下を入力:

- **App name**: 任意 (例: `MulmoClaude (local)`)
- **App description**: 任意 (例: `Personal listening data integration`)
- **Redirect URIs**: `http://127.0.0.1:3001/api/plugins/runtime/oauth-callback/spotify` を **追加して保存**(ポートが 3001 でない場合はその値に置き換え)
- **Which API/SDKs are you planning to use?**: **Web API** をチェック
- 利用規約に同意して「Save」

> **注意**: Redirect URI は **完全一致**で照合されます。`localhost` ではなく `127.0.0.1` を使ってください。Spotify は `http://127.0.0.1` および `http://[::1]` の loopback redirect だけは HTTPS を要求しません。URL 末尾の `spotify` は plugin が宣言した OAuth callback alias で、`OAUTH_CALLBACK_ALIAS` 名前付き export で plugin 自身が決めています。

### 2. Client ID をコピー

作成したアプリのページで「**Settings**」を開くと **Client ID** が表示されます(`Client secret` は PKCE フローでは使わないので無視で OK)。長い英数字列をコピーしてください。

### 3. mulmoclaude に Client ID を渡す

普段は plugin View の「Configure」フォームで貼り付けるのがいちばん簡単です(View が ~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin/client.json に書き出します)。手で書きたい場合:

```bash
# %40 = '@'、%2F = '/' の URL-encoded 形式。runtime.files.config が
# package 名を encodeURIComponent して 1 セグメントの directory 名にする
# 仕様なので、@scope/name の literal な階層構造ではなく、encoded 名で
# 1 階層になる点に注意。
mkdir -p ~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin
cat > ~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin/client.json <<'EOF'
{
  "clientId": "ここにペースト"
}
EOF
```

### 4. mulmoclaude を再起動

mulmoclaude のサーバを再起動すると、Spotify plugin が `client.json` を読みます。

### 5. 接続

mulmoclaude のチャットで「Spotify を接続して」と頼むと、LLM が `manageSpotify({ kind: "connect", redirectUri: "..." })` を呼んで Spotify の同意画面 URL を返します。許可すると、認可情報が `~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin/tokens.json` に保存され、以降の API 呼び出しで自動的に使われます。

## トラブルシューティング

### `INVALID_CLIENT: Invalid redirect URI`

Spotify Dashboard に登録した Redirect URI と、mulmoclaude が動いているポートが一致していません。

1. mulmoclaude の起動ログでポート番号を確認(例: `listening port=3099`)
2. Dashboard の Settings で Redirect URIs に `http://127.0.0.1:<その番号>/api/plugins/runtime/oauth-callback/spotify` を追加
3. Save → 再度「Spotify 接続」を試す

`--port` を切り替える場合は、よく使うポート(3001 / 3099 など)をまとめて登録しておくと楽です。

### `INVALID_CLIENT: Invalid client`

`client.json` の値が違います。Dashboard の Client ID をもう一度コピーして、`client.json` を上書きしてから mulmoclaude を再起動してください。

### Token が古くなった / 接続が切れた

`~/mulmoclaude/config/plugins/%40mulmoclaude%2Fspotify-plugin/tokens.json` を削除してから「Connect Spotify」をやり直してください。Spotify が refresh token を rotate した、scope を変えたい、別の Spotify アカウントに切り替えたい、いずれの場合もこれで OK です。

### クライアント ID は安全に扱える?

PKCE フローを使っているので Client Secret はそもそも持ちません。Client ID 単体は **公開しても問題ない**情報ですが、念のため `client.json` を git に commit しないでください(workspace ディレクトリは標準で git 外です)。

## 何が取れる?

| 機能 | Free / Open | Premium |
|---|---|---|
| お気に入り (Liked Songs) | ✓ | ✓ |
| Playlists 一覧 / 各 playlist のトラック | ✓ | ✓ |
| 最近聞いた曲 (直近 50 曲、Spotify API の上限) | ✓ | ✓ |
| 今再生中の曲 (表示のみ) | ✓ | ✓ |
| Search (track / artist / album / playlist) | ✓ | ✓ |
| デバイス一覧 (`getDevices`) | ✓ | ✓ |
| **再生制御 (play / pause / next / prev / seek / volume / transferPlayback)** | ✗ | ✓ |

再生制御は **Spotify Premium が必須**です(Spotify Web API 側の制限)。Free / Open アカウントの場合、View 上では Player Controls は隠され、LLM 経由で `play` 等を呼んでも `premium_required` エラーが返ります。

Liked への追加・削除、playlist 作成、編集は別 PR で対応予定です。

## 既存接続の再認可 (PR 3 以降)

PR 3 で OAuth scope を 2 個追加 (`user-read-playback-state`, `user-modify-playback-state`) しました。PR 1 / 2 のみで接続済みのユーザは再生制御を呼ぶと `403 Insufficient client scope` が返るので、View の「Reconnect」(または `tokens.json` 削除 → 再 Connect) で再認可してください。

## 関連ドキュメント

- 設計: `plans/feat-spotify-plugin.md`
- Plugin 実装: `packages/spotify-plugin/`
- 実装 issue: [#1162](https://github.com/receptron/mulmoclaude/issues/1162)
- Plugin runtime ドキュメント: [`docs/plugin-runtime.md`](../plugin-runtime.md)
- 公式: [Spotify Web API Authorization Guide](https://developer.spotify.com/documentation/web-api/concepts/authorization)
