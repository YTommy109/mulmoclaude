# Start MulmoClaude — 開発者確認用メモ

> このファイルは Claude に読まれません。SKILL.md の内容を日本語で確認するためのものです。

## Step 1: 事前チェック

1. `package.json` の `name` が `mulmoclaude` であることを確認。違えば中断
2. ポート 5173 が空いているか確認（`lsof -i :5173 -sTCP:LISTEN`）。使用中なら案内
3. Docker チェック（`.env` に `DISABLE_SANDBOX=1` があればスキップ。なければ `docker info` で起動確認、未起動なら `open -a Docker`）

## Step 2: 開発サーバー起動

ユーザーに別ターミナルで `yarn dev` を実行してもらい、`[server] listening port=3001` が出たら `open http://localhost:5173` でブラウザを開く。

起動に失敗した場合は `/setup-mulmoclaude` のハマりポイント表を参照。
