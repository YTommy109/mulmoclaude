# feat: X OAuth 2.0 ブックマーク取得（Sources フェッチャー方式）

## 背景

現在の X 連携は App-Only Bearer Token（`X_BEARER_TOKEN`）による公開データ読み取りのみ。
ユーザー固有データ（ブックマーク等）を取得するには OAuth 2.0 User Context が必要。

### ユーザーの最終ゴール

```
X でブックマーク → 定期取得 → Wiki に登録 → 未読セッションで確認
```

本プランは「OAuth 2.0 対応 + Sources フェッチャーとしてブックマーク取得」をカバーする。
Wiki 登録・未読セッション連携は次フェーズ。

## 方針: Sources システムに乗せる

X ブックマークを独立した MCP ツールとして作るのではなく、
既存の **Sources パイプライン**（RSS, GitHub, arXiv と同列）にフェッチャーを追加する。

### この方式のメリット

- 差分取得（cursor）、アーカイブ、日次サマリー、dedup が既存パイプラインで動く
- `manageSource` ツールでソース登録・削除・一覧がそのまま使える
- スケジュール設定（`hourly` / `daily` / `weekly` / `on-demand`）も既存の仕組み
- ストレージも既存の `data/sources/` 以下に統一される

### データの保存先

```
~/mulmoclaude/data/sources/
  x-bookmarks.md                  ← ソース定義（frontmatter）
  _state/x-bookmarks.json         ← cursor（最終取得 tweet ID）、取得状態
  _archive/x-bookmarks/
    2026-04.md                     ← 月別アーカイブ
```

## 現状

| ツール | 認証方式 | できること |
|---|---|---|
| `readXPost` | App-Only Bearer Token | URL/ID で公開ポスト1件取得 |
| `searchX` | App-Only Bearer Token | キーワードで公開ポスト検索 |

### 関連ファイル（Sources システム）

| ファイル | 役割 |
|---|---|
| `server/workspace/sources/types.ts` | `Source`, `SourceState`, `FetcherKind`, `SourceItem` 型定義 |
| `server/workspace/sources/fetchers/index.ts` | フェッチャーレジストリ（`registerFetcher`, `getFetcher`） |
| `server/workspace/sources/fetchers/registerAll.ts` | 全フェッチャーの side-effect import |
| `server/workspace/sources/fetchers/rss.ts` | RSS フェッチャー（実装パターンの参考） |
| `server/workspace/sources/pipeline/index.ts` | パイプライン（fetch → dedup → archive → persist） |
| `server/workspace/sources/taxonomy.ts` | カテゴリ分類（25種） |

### 関連ファイル（X API・環境変数）

| ファイル | 役割 |
|---|---|
| `server/agent/mcp-tools/x.ts` | 既存 X ツール（`readXPost`, `searchX`） |
| `server/system/env.ts` | 環境変数の一元管理 |

## API コスト

X API は 2026年2月から **Pay-per-use**（従量課金）。Free tier はない。

| 操作 | 課金単位 | 単価 |
|---|---|---|
| 読み取り（Owned Reads = 自分のデータ） | 返却リソース数 | $0.001 / 件 |
| 読み取り（通常） | 返却リソース数 | $0.005 / 件 |

- ブックマーク一覧取得は Owned Reads（$0.001/件）と想定
- 24時間 UTC 内の同一リソースは重複課金なし（deduplication）
- 事前にクレジット購入が必要（X Developer Console）

### コスト最小化: max_results を小さく保つ

API は返却されたリソース数で課金される。「既知 ID で打ち切り」はクライアント側の処理なので、
API が返した件数がそのまま課金対象になる。

```
初回:     max_results=100 → 100件返却 → $0.10（100 × $0.001）
翌日:     max_results=10  → 10件返却  → $0.01（うち新着3件、既知7件）
変化なし: max_results=10  → 10件返却  → $0.01（全て既知、新着なし）
```

定期取得では `max_results` を小さく設定（10〜20）してコストを抑える。
新着が `max_results` を超えそうな場合のみページネーションで追加取得する。

## 設計

### 認証方式

- **Phase 1（本プラン）**: 手動で OAuth 2.0 Access Token を取得し `.env` に設定
- **Phase 2（将来）**: Settings 画面から OAuth 認可フロー / 自動 Token リフレッシュ

### 環境変数

`server/system/env.ts` に追加：

```env
# 既存（App-Only — 変更なし）
X_BEARER_TOKEN=AAAA...

# 新規（OAuth 2.0 User Context）
X_USER_ACCESS_TOKEN=xxxx
X_USER_REFRESH_TOKEN=xxxx    # Token 更新用（Phase 1 では手動更新）
X_USER_CLIENT_ID=xxxx        # Token 取得/更新スクリプトで使用
X_USER_CLIENT_SECRET=xxxx    # Token 取得/更新スクリプトで使用
```

### 新規フェッチャー: `x-bookmarks`

`server/workspace/sources/fetchers/x-bookmarks.ts` を新規作成。
既存の RSS フェッチャー（`rss.ts`）と同じ4フェーズパターンに従う。

#### フェッチャーの動作

```
Phase 1: HTTP Fetch
  → GET /2/users/me で自分の user ID を取得（初回のみ、キャッシュ可能）
  → GET /2/users/:id/bookmarks で一覧取得
  → Authorization: Bearer <X_USER_ACCESS_TOKEN>

Phase 2: Parse
  → JSON レスポンスからツイートデータを抽出

Phase 3: Normalize & Filter
  → SourceItem[] に変換
  → cursor の last_seen_id と比較、既知 ID が出たら打ち切り

Phase 4: Advance Cursor
  → 最新の tweet ID で cursor を更新
```

#### Cursor 設計

```typescript
const XBOOKMARKS_CURSOR_KEY = "xbookmarks_last_seen_id";

// cursor に保存する値
{ "xbookmarks_last_seen_id": "1234567890" }  // 最新の tweet ID
```

tweet ID は時系列順（Snowflake ID）なので、ID 比較で新旧判定が可能。

#### SourceItem へのマッピング

```typescript
// X API レスポンス → SourceItem
{
  id: `x-bookmark-${tweet.id}`,
  title: `@${author.username}: ${tweet.text.slice(0, 80)}`,
  url: `https://x.com/${author.username}/status/${tweet.id}`,
  publishedAt: tweet.created_at,      // ツイートの投稿日時
  summary: tweet.text,
  content: formatTweet(tweet, author), // 既存の formatTweet() を再利用
  categories: [],                      // ソース定義のカテゴリを継承
  sourceSlug: "x-bookmarks",
}
```

#### fetchXUser 関数

`server/agent/mcp-tools/x.ts` の既存 `fetchX()` と分離：

```typescript
// App-Only（既存ツール用 — 変更なし）
async function fetchX(path: string): Promise<XApiResponse>

// User Context（フェッチャーから呼ぶ）
export async function fetchXUser(path: string): Promise<XApiResponse>
```

差分は `Authorization` ヘッダーに使うトークンのみ。
フェッチャーから使うため `export` する。

### ソース登録の例

```markdown
---
slug: x-bookmarks
title: X Bookmarks
url: https://x.com
fetcherKind: x-bookmarks
fetcherParams: {}
schedule: daily
categories: [personal]
maxItemsPerFetch: 100
addedAt: "2026-04-23T00:00:00Z"
---

X（Twitter）のブックマーク保存一覧を定期取得する。
```

ユーザーは `manageSource` ツールで登録するか、手動でファイルを作成できる。

### Token 取得スクリプト

`scripts/x-oauth.ts` — ユーザーが1回実行して Access Token を取得するヘルパー。

```
$ npx tsx scripts/x-oauth.ts

1. ブラウザが開きます。X にログインして「許可」を押してください。
2. Token を取得しました:
   X_USER_ACCESS_TOKEN=xxxx
   X_USER_REFRESH_TOKEN=xxxx
   ↑ .env にコピーしてください。
```

仕組み:
- `X_USER_CLIENT_ID` + `X_USER_CLIENT_SECRET` を `.env` から読む
- ローカルに一時 HTTP サーバーを立てる（コールバック受信用）
- PKCE (S256) フローで認可 URL を生成 → ブラウザを開く
- コールバックで認可コード受信 → Access Token + Refresh Token に交換
- コンソールに出力して終了

### Token リフレッシュスクリプト

Access Token の有効期限は2時間。期限切れ時に手動で再取得が必要。

```
$ npx tsx scripts/x-oauth-refresh.ts
新しい Access Token を取得しました。.env を更新してください。
```

## 実装ステップ

### Step 1: 型定義の拡張

- [ ] `server/workspace/sources/types.ts` の `FETCHER_KINDS` に `"x-bookmarks"` を追加

### Step 2: 環境変数追加

- [ ] `server/system/env.ts` に `xUserAccessToken`, `xUserRefreshToken`, `xUserClientId`, `xUserClientSecret` を追加

### Step 3: fetchXUser 関数

- [ ] `server/agent/mcp-tools/x.ts` に `fetchXUser()` を追加して export
- [ ] `getMyUserId()` ヘルパーを追加（user ID キャッシュ付き）

### Step 4: x-bookmarks フェッチャー

- [ ] `server/workspace/sources/fetchers/x-bookmarks.ts` を新規作成
  - `SourceFetcher` インターフェース実装
  - cursor による差分取得ロジック
  - `normalizeToSourceItems()` 純粋関数
  - `updateCursor()` 純粋関数
  - `registerFetcher()` 呼び出し
- [ ] `server/workspace/sources/fetchers/registerAll.ts` に `import "./x-bookmarks.js"` を追加

### Step 5: Token 取得スクリプト

- [ ] `scripts/x-oauth.ts` — 初回認可フロー
- [ ] `scripts/x-oauth-refresh.ts` — Token リフレッシュ

### Step 6: テスト

- [ ] `test/sources/test_xBookmarksFetcher.ts` — フェッチャーのユニットテスト
  - normalize / cursor 更新の純粋関数テスト
  - API モック使用

### Step 7: ドキュメント

- [ ] `.env.example` に新しい環境変数を追記
- [ ] README の X 連携セクションに OAuth 2.0 セットアップ手順を追記

## スコープ外（次フェーズ）

- Settings 画面からの OAuth フロー
- 自動 Token リフレッシュ（サーバー側で Refresh Token を使って自動更新）
- `x-likes` フェッチャー（いいね一覧取得）
- Wiki 登録フロー（Sources アーカイブ → Wiki ページ変換）
- 未読セッション連携

## X Developer Portal の前提条件

ユーザーが事前に設定しておく必要があるもの:

1. X Developer Portal でアプリ作成済み
2. OAuth 2.0 設定で **Callback URL** を登録（例: `http://localhost:9876/callback`）
3. **Type of App** = "Web App"（Confidential client）
4. 必要な Scopes を有効化: `bookmark.read`, `tweet.read`, `users.read`
5. Pay-per-use クレジットを購入済み
