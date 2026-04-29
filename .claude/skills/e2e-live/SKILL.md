---
name: e2e-live
description: 実 Claude API を叩く総合テスト（全カテゴリ）を実行する。リリース前ではなく、定期的に手動で回して回帰を検出するための skill。`yarn dev` が起動済みであることが前提。
---

## 前提

- `yarn dev` を別ターミナルで起動済み（`http://localhost:5173` が応答する）
- Claude 認証済み（`claude login` 済み or `ANTHROPIC_API_KEY` 設定済み）
- `e2e-live` ディレクトリのテストは実 LLM を呼ぶため、API 利用枠を消費する

## 実行

```bash
yarn test:e2e:live
```

## デバッグ時（QA が画面で動作を見たい場合）

```bash
HEADED=1 yarn test:e2e:live
```

Chromium ウィンドウが開き、`slowMo: 200ms` で動作が目で追える。

## 結果の確認

- 進捗: ターミナル（`list` reporter）でリアルタイム表示
- 詳細: `playwright-report-live/index.html`（失敗時は自動オープン）
- 動画リプレイ: `npx playwright show-trace test-results-live/<spec>/trace.zip`
- 失敗時の動画: `test-results-live/<spec>/video.webm`

## 失敗時の対応

各失敗はカテゴリ・シナリオ ID（L-01 〜 L-30）に紐づいている。`plans/feat-e2e-live.md` の Appendix に内部バグ ID（B-XX）との対応表があるので、回帰したバグを特定できる。

## カテゴリ別の skill

特定カテゴリだけ走らせたい場合は以下を使用：

- `/e2e-live-media` — 画像 / PDF / 動画
- `/e2e-live-roles` — ロール別 sample query（未実装）
- `/e2e-live-session` — セッション / 履歴（未実装）
- `/e2e-live-wiki` — Wiki / Router（未実装）
- `/e2e-live-ui` — UI / 通知 / プラグイン（未実装）
- `/e2e-live-skills` — Skill / Tool（未実装）
- `/e2e-live-docker` — Docker 環境特有（未実装）
