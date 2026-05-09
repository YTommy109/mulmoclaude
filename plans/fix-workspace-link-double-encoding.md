# Fix: workspace link double-encoding on multibyte filenames

## 症状

Claude が assistant メッセージに markdown リンク記法でワークスペース内ファイルへのリンクを書いたとき、リンク先ファイル名に日本語などのマルチバイト文字が含まれているとクリックしても Files タブで 404 になる。

例:

```markdown
[2026-04-作業報告書.md](artifacts/documents/work-reports/2026-04-作業報告書.md)
```

クリック後の URL（実機 + Playwright で確認）:

```
/files/artifacts/documents/work-reports/2026-04-%25E4%25BD%259C%25E6%25A5%25AD%25E5%25A0%25B1%25E5%2591%258A%25E6%259B%25B8.md
```

`%25E4%25BD%259C` は `%E4%BD%9C`（"作"）の `%` を再エスケープしたもの。

API:

```
GET /api/files/content?path=artifacts%2F...%2F2026-04-%25E4%25BD%259C...md
→ 404
```

## 原因

1. `marked.parse` が markdown リンク記法を `<a href>` 化する際、URL を percent-encode する（`%E4%BD%9C...`）
2. `src/utils/path/workspaceLinkRouter.ts` の `classifyWorkspacePath` は href をデコードせず素通しで `{ kind: "file", path }` を返す
3. `src/App.vue` の `navigateToWorkspacePath` が `target.path.split("/")` で配列化して `pathMatch` に渡す
4. vue-router がそれを **もう一度** percent-encode → `%E4%BD%9C` が `%25E4%25BD%259C` に

## 修正方針

`classifyWorkspacePath` の入口で `decodeURIComponent` を 1 回かける（safe decode）。

- 入力が裸のパス（ASCII / マルチバイトそのまま）→ decode しても変わらない（冪等）
- 入力が encoded（`%E4%BD%9C...`）→ decode して "作..." になる
- 不正な percent シーケンスで `decodeURIComponent` が throw した場合は元の値を使う（フォールバック）

これにより呼び出し元 4 箇所すべてに同じ修正が効く:

- `src/App.vue` (`navigateToWorkspacePath`)
- `src/plugins/wiki/components/WikiPageBody.vue`
- `src/plugins/textResponse/View.vue` (`openLinksInNewTab`)
- `src/utils/notification/dispatch.ts`

## テスト

`test/utils/path/test_workspaceLinkRouter.ts` に encoded 入力ケースを追加:

- percent-encoded 日本語ファイルパス → decoded path で `{ kind: "file", path }` を返す
- percent-encoded wiki page slug → 正しく `{ kind: "wiki", slug }` を返す
- 不正な percent シーケンス → throw せずフォールバック（元のパスを workspace 相対として扱う）
- 既存の裸パスケース（ASCII / マルチバイト）は引き続き通る

## 動作確認

Playwright で:

1. `/chat/<sessionId>?result=<resultId>` でリンク `[2026-04-作業報告書.md](artifacts/...)` を表示
2. クリック → URL が `/files/artifacts/.../2026-04-%E4%BD%9C...md`（**1 回エンコード**）になる
3. md viewer でファイル内容が表示される（404 にならない）

## スコープ外

- LLM レスポンスに自動でリンクを埋め込む話（プロンプト誘導 / autolink 後処理）→ 別 issue
