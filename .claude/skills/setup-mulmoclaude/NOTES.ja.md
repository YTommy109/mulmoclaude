# Setup MulmoClaude — 開発者確認用メモ

> このファイルは Claude に読まれません。SKILL.md の内容を日本語で確認するためのものです。

## Step 1: README の手順に従ってセットアップ

README.md の Installation セクションを読み、手順をユーザーに案内する（`yarn install` → `.env`）。

## Step 2: ポート 5173 の空き確認

```bash
lsof -i :5173 -sTCP:LISTEN
```

- **空き**: そのまま進む
- **使用中**: PID と起動コマンドを表示。「既に MulmoClaude が動作中かもしれません。動作中なら Step 4 のブラウザオープンに直接進めます。停止したい場合は該当ターミナルで `Ctrl+C` を押してください」と案内

## Step 3: Docker チェック

1. `.env` に `DISABLE_SANDBOX=1` があればスキップ
2. `which docker` が無ければ README の Docker セクションを案内
3. `docker info` で起動確認。動いていなければ `open -a Docker` で起動し待機

## Step 4: 開発サーバー起動

ユーザーに**別ターミナル**で `yarn dev` を実行してもらう（Claude のバックグラウンドプロセスにしない — Ctrl+C で止められるようにするため）。

> `[server] ... INFO  [server] listening port=3001` が出たら起動完了。`[client] ➜ Local: http://localhost:5173/` だけではまだバックエンドが準備中。

起動したら `open http://localhost:5173` でブラウザを開き、General ロールが表示されれば成功。

## よくあるハマりポイント

| 症状 | 原因 | 対処 |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: @mulmobridge/...` | `yarn install` 未実行 or 不完全 | `yarn install` を再実行 |
| `[sandbox] ... not found.` | ホストで `claude` 未認証 or 認証期限切れ | `claude` を一度起動して認証 |
| 起動が無言で止まる | macOS TCC ダイアログがバックグラウンドに隠れている | Docker のフォルダアクセス許可ダイアログを確認 |
| `EADDRINUSE :5173` | ポート競合 | 競合プロセスを停止 |
| Vite が pending で固まる | lockfile 変更後の依存再最適化 | `rm -rf node_modules/.vite && yarn dev` |
