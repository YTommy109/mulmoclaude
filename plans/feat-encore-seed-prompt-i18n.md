# feat: Encore plugin-seeded chat prompts を i18n で多言語化 (#1545)

## 背景 / 問題

Encore プラグインの top-bar ランチャー（`/encore` ダッシュボード）から起動できる導線は、英文の seed prompt をユーザーの最初の発話として注入してチャットを開始する。

seed prompt は LLM の最初の user turn になり、**応答言語のアンカー**になる。普段の手入力チャットで日本語が返るのは「ユーザーが日本語を打っているから」に過ぎず、`personal`/`ENCORE_SEED_ROLE_ID` の system prompt に「ユーザーの言語で返す」指示は無く、`server/agent/` 側で locale を LLM に渡してもいない。そのため英文 seed を注入すると、

- skill 風カードに英文がそのまま表示される
- LLM の応答まで英語化することがある

skill 起動（`/foo`）が英語化しないのは、seed が短いスラッシュコマンドのみで**英文の本文を注入しない**ため。つまり原因は「seed があること」ではなく「**英文プロンプト本文を seed していること**」。

## 方針: ランタイム翻訳ではなく静的 i18n

role の suggested queries は頻繁に追加・変更されるので LLM ランタイム翻訳（`/api/translation/translate` + Haiku）を使っている。一方この seed prompt は**ほぼ変わらない**ため、あらかじめ 8 言語訳を持っておく（vue-i18n の `src/lang/*.ts`）方が、初回レイテンシも LLM コストも無く決定的で良い（PR #1562 のレビューコメントでの合意）。

## 対象スコープ

seed prompt 注入箇所は 3 つある:

| # | 起点 | ハンドラ | 性質 | 本 PR |
|---|---|---|---|---|
| 1 | `+ Add` ボタン | `startSetupChat` | 静的・短い・クリック起点（locale 既知） | ✅ 実装 |
| 2 | obligation のチャットアイコン | `startObligationChat` | 動的（displayName 埋め込み）・クリック起点 | ✅ 実装 |
| 3 | 通知ベル | `resolveNotification`（`reconcile.ts` の `buildSeedPrompt`） | 長い LLM 指示プロンプト・reconcile（スケジュール実行）時に生成し ticket に保存 | ⏭ 別 issue（後述） |

#1/#2 はクリック起点でブラウザ locale が既知なので、フロントで翻訳済み文字列を組み立てて送るだけで済む。

## 実装（#1 / #2）

### フロント: `src/plugins/encore/EncoreDashboard.vue`

- `useI18n()` から `locale` も取得。
- `localizedSeed(compose)` ヘルパー: `locale === "en"` のときは `undefined` を返し、それ以外は `compose()` の翻訳文字列を返す（`useTranslatedQueries` と同じ「en はスキップ」ポリシー）。
- `startSetupChat()`: body に `seedPrompt: localizedSeed(() => t("encoreDashboard.seedPrompts.setup"))` を追加。
- `startChatForObligation(obligationId, displayName)`: 引数に `displayName` を追加し、`seedPrompt: localizedSeed(() => t("encoreDashboard.seedPrompts.obligation", { displayName, obligationId }))` を送る。テンプレートの呼び出しも `item.dsl.displayName` を渡すよう更新。

### サーバ: `server/encore/handlers/{startSetupChat,startObligationChat}.ts`

- それぞれの zod スキーマに `seedPrompt: z.string().min(1).optional()` を追加。
- `startChat({ message })` に渡す値を `args.seedPrompt ?? <英語の正本>` に変更。
- 英語の正本（`SETUP_SEED_PROMPT` 定数 / `buildSeedPrompt`）は**フォールバックとして残す**。`en` ロケールはフロントが `seedPrompt` を送らないため、`en` パスは引き続きサーバ側の定数が source of truth（クライアントのエコーバックに依存しない）。

### i18n: `src/lang/*.ts`（8 locale）

- `encoreDashboard.seedPrompts: { setup, obligation }` を全 locale に追加。
- `en.ts` の `setup` はサーバ `SETUP_SEED_PROMPT` とバイト一致（i18n の source of truth）。
- `obligation` は `{displayName}` / `{obligationId}` プレースホルダを各 locale で verbatim 維持。
- ブランド/ツール名（`Encore` / `DSL` / `defineEncore` / `obligationId`）は英語のまま。
- displayName の囲みは ASCII エスケープ `\"` か CJK 角括弧「」を使用し、`de.ts` を壊す typographic quote（`„` / `“` = U+201E/U+201C）は使わない。

### テスト: `test/lang/test_encore_seed_prompts.ts`

副作用ゼロ（`startChat` を呼ばない）で次を検証:
- 全 locale に `seedPrompts.setup`（非空）/ `seedPrompts.obligation` が存在し、obligation は両プレースホルダを保持。
- `en.ts` の `setup` がサーバ `SETUP_SEED_PROMPT` と一致（en パスの drift 防止）。

dispatch のハンドラ自体（`startChat` 経由）はセッションファイル書き込み + エージェント起動の副作用があり、`test_encore_dispatch.ts` も意図的にテストしていないため、ここでも呼ばない。

## トレードオフ / セキュリティ

- クライアントが seed prompt 本文を送る形になるが、seed は**ユーザー自身の最初のチャット発話**であり信頼境界をまたがない（通常チャットでユーザーが任意の文を打つのと同じ）。サーバの英語定数はフォールバックとして残るので堅牢性も維持。

## #3（通知ベル）を別 issue にする理由

#3 の `buildSeedPrompt` は **reconcile（スケジュール実行）時に生成**され ticket に保存される。その時刻にブラウザは居らず、サーバは locale を知らない（locale は `VITE_LOCALE` / `navigator.languages` 由来でサーバ未永続）。さらに中身の大半は `manageEncore` の呼び方・JSON 例などの **LLM 向け指示**で、8 言語に訳すと指示精度が落ちるリスクがある。

→ #3 は「翻訳」よりも、**locale を system prompt に注入して応答言語だけ揃える**方式が安全（プロンプト本文は英語のまま据え置き、`ENCORE_SEED_ROLE_ID` の system prompt に「The user's preferred language is `<locale>`」を埋め込む）。これは Encore に限らず plugin-seeded chat 全般に効く汎用対応でもある。

本 PR 発行後に #3 を別 issue として起票する。

## 完了条件

- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` がすべて通る
- [ ] `yarn test`（`test_encore_seed_prompts.ts` 含む）が通る
- [ ] PR 発行 → `/codex-cross-review` 収束
- [ ] #3 の follow-up issue 起票
