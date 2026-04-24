---
name: setup-ollama-local
description: Interactively guide Claude Code + Ollama local LLM setup on Mac — install, model pull, env switch, and verification. Respond in the user's language.
allowed-tools: Read, Bash, Glob, Grep
---

# Setup Claude Code × Ollama（ローカル LLM）

Mac 上で Claude Code を Ollama のローカル LLM に接続するセットアップをガイドする。普段はクラウド Claude（Subscription）を使い、必要な時だけローカルに切り替える運用を前提とする。

## 重要な前提知識

- Ollama **v0.14.0 以降**で Anthropic Messages API 互換が追加された
- 3B クラスの小型モデルではテキスト出力のみ可能（ツール呼び出しは動かない）
- Function Calling 対応モデル（Gemma 4、gpt-oss 等）なら一定レベルのエージェント動作が期待できる

## Step 1: Ollama の確認・インストール

### 1-1. インストール済みかチェック

```bash
which ollama && ollama --version
```

- **インストール済み**: バージョンが **v0.14.0 以上**であることを確認。古い場合はアップデートを案内
- **未インストール**: 以下のいずれかを案内
  - 公式インストーラー（推奨）: https://ollama.com/download/mac
  - Homebrew: `brew install ollama`

### 1-2. Ollama サーバの起動確認

```bash
curl -s http://localhost:11434/api/tags | head -c 200
```

- **応答あり**: サーバ起動済み → Step 2 へ
- **応答なし**: 起動方法を案内
  - 公式インストーラー版: メニューバーの Ollama アイコンをクリック
  - Homebrew 版: `brew services start ollama` または `ollama serve`

## Step 2: Claude Code の確認

```bash
which claude && claude --version
```

- **インストール済み**: Step 3 へ
- **未インストール**: インストール方法を案内（npm / 公式スクリプト / Homebrew）
  - npm（推奨）: `npm install -g @anthropic-ai/claude-code`
  - 公式スクリプト: `curl -fsSL https://claude.ai/install.sh | sh`
  - Homebrew: `brew install anthropic/tap/claude-code`

## Step 3: モデルの選択とダウンロード

ユーザーの Mac のメモリ量と用途を確認してから推奨モデルを提示する。

### メモリ別おすすめ

| メモリ | おすすめモデル | サイズ | Tool Calling | 用途 |
|--------|---------------|--------|-------------|------|
| 8-16GB | `qwen2.5-coder:7b` | 4.7GB | ○ | コード生成の相棒 |
| 16GB | `qwen2.5-coder:14b` | 9GB | ○ | コーディング上位 |
| 16GB | `gemma4:e4b` | ~3GB | ◎ | 軽量エージェント実験 |
| 24GB+ | `gemma4:26b` | ~15GB | ◎ | **Function Calling 強、バランス良** |
| 24GB+ | `gpt-oss:20b` | 13GB | ◎ | OpenAI オープンウェイト、推論系 |

> ポイント: エージェント機能（Skill / MCP / ツール呼び出し）を試すなら `gemma4:26b` か `gpt-oss:20b` が第一候補。3B クラスでは Skill はほぼ動かない。

### ダウンロード

ユーザーが選んだモデルを pull する。まずは軽量版で動作確認するのも推奨。

```bash
ollama pull <選択したモデル>
```

確認:

```bash
ollama list
```

## Step 4: ローカル接続テスト

### 4-1. 環境変数セット（一時的）

**このターミナルセッションだけ**の一時切り替え。ウィンドウを閉じればクラウドに戻る。

```bash
export ANTHROPIC_AUTH_TOKEN="ollama"
export ANTHROPIC_API_KEY=""
export ANTHROPIC_BASE_URL="http://localhost:11434"
```

各環境変数の役割:

| 環境変数 | 値 | 目的 |
|----------|-----|------|
| `ANTHROPIC_AUTH_TOKEN` | `"ollama"` | Ollama モードを有効化 |
| `ANTHROPIC_API_KEY` | `""`（空） | クラウド用キーを無効化（干渉防止） |
| `ANTHROPIC_BASE_URL` | `http://localhost:11434` | 接続先をローカルに変更 |

### 4-2. Claude Code をローカルモデルで起動

ユーザーに別ターミナルで以下を実行してもらう（`!` プレフィックスを使う）:

```
! ANTHROPIC_AUTH_TOKEN="ollama" ANTHROPIC_API_KEY="" ANTHROPIC_BASE_URL="http://localhost:11434" claude --model <選択したモデル>
```

起動できたら簡単な質問（例: 「Hello, what model are you?」）で動作確認する。

## Step 5: クラウドへの戻し方を案内

ローカルモードは **そのターミナルだけ** なので:

1. **ターミナルを閉じて開き直す**だけで OK
2. または明示的に環境変数を削除:
   ```bash
   unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
   ```

## Step 6: エイリアス設定（オプション）

ユーザーが希望する場合、`~/.zshrc` にエイリアスを追加する提案をする。

```bash
# ローカル Ollama に切り替え
alias claude-local='ANTHROPIC_AUTH_TOKEN="ollama" ANTHROPIC_API_KEY="" ANTHROPIC_BASE_URL="http://localhost:11434" claude'
```

追加後:
```bash
source ~/.zshrc
```

使い方:
```bash
claude-local --model gemma4:26b   # ローカル
claude                            # 通常はクラウド
```

## Key pitfalls to highlight

- Ollama のバージョンが **v0.14.0 未満**だと Anthropic API 互換がない — 必ずバージョン確認
- `ANTHROPIC_API_KEY` を空にしないと既存のクラウド用キーが干渉する場合がある
- 3B クラスのモデルでは JSON 形式のツール呼び出しを正しく生成できず、ファイル作成等が失敗する
- Function Calling 対応モデルでも Anthropic の tool use 形式に完全最適化されてはいないため、複雑な Skill チェーンは不安定
- 大きいモデル（20B+）はメモリを圧迫する — `ps aux | grep ollama` や Activity Monitor でモニタリングを案内
- `.zshrc` や `.bashrc` に `export ANTHROPIC_BASE_URL=...` を恒久的に書くと通常のクラウド利用が壊れる — エイリアスのみ推奨

## 参考リンク（ユーザーに共有してよいもの）

- Ollama Claude Code 連携: https://docs.ollama.com/integrations/claude-code
- Ollama Anthropic 互換ブログ: https://ollama.com/blog/claude
- Claude Code 公式: https://code.claude.com/docs/en/overview
