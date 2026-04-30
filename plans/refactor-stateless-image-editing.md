# 画像編集のサーバ側ステートレス化 — 実装プラン

## ゴール

`editImage` を「LLM がパスを渡す純粋関数」に作り直し、**「現在ユーザーが選択している画像」をサーバ（セッションストア）側で覚えるロジックを完全に削除する**。

副次効果として、`selectedImageData` が data URI を運ぶレガシー経路（貼り付け／ドロップ画像）も廃止。**`selectedImageData` という field 自体を消す。**

## 現状の問題（要約）

- `editImage` ツール定義は `prompt` だけを宣言しているが、サーバは `getSessionImageData(session)` で **session ストア**から「直近に user が送った画像」を引いて Gemini に渡している（`server/api/routes/image.ts:146`）。これは tool の入出力契約を守らない暗黙依存で、テスト性も低い。
- `selectedImageData` は 2 つの異なる用途を兼任している:
  1. Claude が user 入力として画像を「見る」ための multimodal attachment（`mergeAttachments` 経由、`server/api/routes/agent.ts:227, 241-253`）
  2. `editImage` が後で取り出す「編集対象画像」（session ストア経由）
- そのため値の形が **data URI と path のハイブリッド**になっており、`isImagePath()` で分岐しないと使えない（`server/api/routes/image.ts:158`）。
- 起源は「貼り付け／ドロップ画像はディスクに無いから data URI にせざるを得ない」だったが、canvas 経路はもう「開いた瞬間にディスクに保存 → 以降は path のみ」で動いており（`server/api/routes/plugins.ts:247-254`、`src/plugins/canvas/View.vue:151-159`）、**path 統一は既に半分達成済み**。あと一押し。

## ターゲット設計

```
[client]
 ├─ paste/drop 画像 → 送信時に POST /api/images で先にディスク保存 → path を取得
 ├─ サイドバーで既存 tool result を選択 → 既に path を持っている
 └─ どちらも path を pickedImagePath として保持

 chat 送信:
   POST /api/agent
   body: { message, roleId, chatSessionId, pickedImagePath?, attachments?, ... }
            ↑ data URI は 1 回も乗らない

[server]
 ├─ pickedImagePath があればファイルを読んで multimodal attachment に変換
 │  → Claude が画像を「見える」状態にする（用途 1）
 ├─ pickedImagePath を user message に hint として prepend:
 │     "[Selected image: artifacts/images/2026/04/abc.png]\n\n<本文>"
 │  → LLM は editImage 呼び出し時にこの path をそのまま渡せる（用途 2）
 └─ session ストアには pickedImagePath を保存しない（ステートレス）

 editImage tool:
   parameters: { prompt: string, imagePath: string }   ← LLM が path を渡す
   server: body.imagePath を safeResolve → ファイル読込 → Gemini
   session 参照は 0 行
```

**核心は「session に画像状態を持たせない」こと**。Claude が画像を「見る」用途も「編集する」用途も、両方ともリクエスト本体に乗ってきた path から派生する。

## 全体構成

| レイヤー | 仕事 |
|---|---|
| client `sendMessage` | paste/drop は事前 upload して path 化、`pickedImagePath` を確定 |
| `/api/agent` body | `selectedImageData` 廃止、`pickedImagePath` 追加（path のみ） |
| server `startChat` | path から attachment を作る、message に hint を prepend、session には保存しない |
| `editImage` tool | `imagePath` パラメータを LLM が渡す |
| server `/api/images/edit` | body の path を直接使う、session 参照削除 |
| session-store | `selectedImageData` field と `getSessionImageData` を全廃 |

各 stage は独立して merge できる順序で並べる。

---

## Stage 1: paste/drop 画像の事前 upload（path 化）

`selectedImageData` に **常に path が入る**ようにクライアントを揃える。サーバ側は何も変えない（`isImagePath()` 分岐がそのまま path 側に倒れるだけ）。

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/App.vue` (`sendMessage` 845-861 付近) | `fileSnapshot?.dataUrl` をそのまま渡す代わりに、`apiPost(API_ROUTES.image.upload, { imageData: fileSnapshot.dataUrl })` を await してから path を `selectedImageData` に渡す。upload 失敗時は `pastedFile.value = fileSnapshot` を戻して error toast |
| `src/components/ChatInput.vue` | （変更なし。data URI を作る責務は維持。upload は send 時。）|
| `src/utils/api.ts` 周辺 | upload helper に薄いラッパが要れば追加 |

`/api/images` (`server/api/routes/image.ts:188`) は既に POST で base64 を受けて path を返すので**サーバ側は無改修**。

### 受け入れ条件

- [ ] 画像を貼り付けて送信すると、`/api/agent` のリクエストボディに data URI ではなく `artifacts/images/YYYY/MM/<id>.png` 形式の path が乗っている（devtools Network で確認）
- [ ] `editImage` が貼り付け画像に対しても通る（`isImagePath()` 分岐が path 側に倒れる）
- [ ] upload 失敗時に「再度貼り付けてください」相当の UI フィードバック
- [ ] e2e の chat-paste 系テスト緑（無ければ最低 1 本追加）

### Out of scope

- `selectedImageData` の rename（stage 3）
- `editImage` のパラメータ追加（stage 2）

---

## Stage 2: `editImage` に `imagePath` パラメータ追加 — LLM が path を渡す

ツール契約に path を昇格させる。server は body の path を優先、無ければ従来の session fallback（移行期間のため一時併存）。

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/plugins/editImage/definition.ts:15-24` | `parameters` に `imagePath: { type: "string", description: "Workspace-relative path to the image to edit (e.g. artifacts/images/2026/04/abc.png)" }` を追加、`required: ["prompt", "imagePath"]` |
| `src/plugins/editImage/definition.ts:14` | `prompt` フィールド（LLM 向けガイダンス）を更新: 「会話履歴中の画像の path を `imagePath` に渡す」 |
| `src/plugins/editImage/index.ts:14-15` | `apiPost` に `args` をそのまま流す（既にそうなっているはずなので確認のみ） |
| `server/api/routes/image.ts:134-184` | `EditImageBody` に `imagePath` を追加。`req.body.imagePath` を優先、無ければ session fallback。fallback パスには deprecation warning ログ |
| `server/api/routes/image.ts:158` | `imagePath` が来たら path 系の分岐に直行（data URI 分岐はそのまま、stage 1 で実質死ぬので OK） |
| `server/agent/prompt.ts` | 「画像を編集するときは、その画像の workspace-relative path を `editImage` の `imagePath` に必ず渡す」旨の 1〜2 行追記 |

### 受け入れ条件

- [ ] LLM が `editImage({ prompt, imagePath })` を呼ぶ（実機で 3〜5 サンプル目視 + tool args ログ）
- [ ] body に `imagePath` が無い場合も従来通り（session fallback）動く
- [ ] パストラバーサル試行（`../../etc/passwd` 等）が `safeResolve()` で 400 になる
- [ ] canvas → アートスタイルボタン → editImage の動線が壊れていない（canvas は既に path を持つので、`sendTextMessage` で投げるテキストに path を含めれば LLM が拾う; どう含めるかは下記）

### canvas → editImage の path 受け渡し

`src/plugins/canvas/View.vue:133-135`:

```ts
const applyStyle = (style) => {
  props.sendTextMessage?.(`Turn my drawing on the canvas into a ${style.label} style image.`);
};
```

これを以下のように path 込みに:

```ts
const applyStyle = (style) => {
  props.sendTextMessage?.(
    `Turn the image at \`${imagePath.value}\` into a ${style.label} style image.`
  );
};
```

サイドバーで選択した generated image を edit する経路は、stage 3 の hint prepend で path が user message に乗るようになるのでそのまま動く。

---

## Stage 3: session 側の `selectedImageData` 全廃 + body field rename

session ストアから「選択画像」状態を完全削除。body の field 名も `selectedImageData` → `pickedImagePath` に rename（path 専用であることを名前で表現）。

### 変更ファイル（削除）

| ファイル | 削除内容 |
|---|---|
| `server/events/session-store/index.ts:34, 85, 93, 105, 417-419` | `ServerSession.selectedImageData` field、`getOrCreateSession` の opts.selectedImageData、`getSessionImageData` 関数本体 ＋ export |
| `server/api/routes/image.ts:3, 146-154` | `getSessionImageData` import 行、`session ?` ブロック、`No image is selected...` の 400 分岐 |
| `server/api/routes/agent.ts:114, 135, 162, 227, 241-253, 257-260, 265` | `StartChatParams.selectedImageData`、`mergeAttachments` の data URI 分岐、`AgentBody.selectedImageData`、関連コメント |
| `packages/chat-service/src/types.ts:44` | `StartChatParams.selectedImageData` field |
| `src/utils/agent/request.ts:13, 20, 46` | `selectedImageData` field |
| `test/events/test_session_store.ts` | `selectedImageData` を期待するアサーション削除 |
| `test/utils/agent/test_request.ts` | 同上 |

### 変更ファイル（追加・改修）

| ファイル | 変更内容 |
|---|---|
| `server/api/routes/agent.ts` `startChat` | (1) body の `pickedImagePath` を受け取り、`loadImageBase64()` で読んで `Attachment` を作って `attachments` に push; (2) `decoratedMessage` の頭に `[Selected image: ${pickedImagePath}]\n\n` を prepend して LLM に hint |
| `server/api/routes/agent.ts` `AgentBody` / `StartChatParams` | `pickedImagePath?: string` を追加（rename） |
| `src/utils/agent/request.ts` | `pickedImagePath?: string` を追加 |
| `src/App.vue:855` | `selectedImageData` → `pickedImagePath`、値は stage 1 で確定済みの path |
| `packages/chat-service/src/types.ts` | `pickedImagePath?: string` を追加（bridge protocol 互換性は major bump の判断要、下記 Open Question） |
| `server/api/routes/image.ts:138-184` | session fallback ブロック削除、`imagePath` 必須化。`!imagePath` で 400 |
| `src/plugins/editImage/definition.ts` | `imagePath` を `required` のまま維持 |

### hint prepend の形式

```
[Selected image: artifacts/images/2026/04/abc-123.png]

<ユーザーが入力した本文>
```

- prepend は **server side** で行う（client 側でやると bridge クライアントが取り残される）
- `pickedImagePath` が undefined のときは prepend しない
- system prompt 側に「メッセージ冒頭に `[Selected image: <path>]` がある場合、その path はユーザーが現在選択している画像。`editImage` 等を呼ぶ際の `imagePath` パラメータに使うこと」という解釈ルールを 1 段落追加

### 受け入れ条件

- [ ] `grep -rn "selectedImageData\|getSessionImageData" server src packages test` が 0 件
- [ ] session-store の `ServerSession` 型から `selectedImageData` が消えている
- [ ] 貼り付け画像 → 「Ghibli 風に」テスト動線が緑
- [ ] サイドバーで既存画像選択 → 編集動線が緑
- [ ] canvas → アートスタイル動線が緑
- [ ] e2e image-plugins / chat-attach 系全緑
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build` 全緑

---

## Rollout 順序

1. **Stage 1** を独立 PR で merge（client 側のみ、サーバ無改修）→ 1〜2 日モニタ
2. **Stage 2** を独立 PR で merge（tool 契約拡張、session fallback 残す）→ LLM 出力サンプル目視 → prompt 微調整
3. **Stage 3** を独立 PR で merge（session 全廃、rename）→ 全動線回帰確認

各 stage は前段が完全動作している前提で次に進む。**stage 2 だけ merge して止めても**「LLM が path を渡せるようになった、session fallback もまだ残っている」という安全な中間状態。

## Risks / Open Questions

- **bridge protocol 互換性**: `packages/chat-service` の `StartChatParams.selectedImageData` を消すと外部 bridge クライアントが壊れる可能性。stage 3 で「new field 追加 + 旧 field を 1 リリース deprecate」で 2 PR に分けるか、major bump で同時削除するか要決定。chat-service の利用者は既知の範囲では mulmoclaude のみのはず（要確認）。
- **LLM の `imagePath` 遵守率**: `editImage` 呼び出し時に hint からコピペできるかは prompt の書き方次第。stage 2 完了時にサンプル取って 95% 未満なら few-shot example を prompt に足す。
- **複数画像の選択**: 現状の sidebar 選択は単一画像。将来複数選択を入れる場合は `pickedImagePath: string` ではなく `pickedImagePaths: string[]` にする可能性あるが、本リファクタの範囲外。
- **multimodal attachment の冗長性**: hint で path が message 内に入り、かつ attachment でバイトも入る → Claude のコンテキストで両方扱うが、これは「path で参照できる + 視覚的にも見える」という狙い通りの状態。冗長ではない。
- **attachment 読込のエラー**: `pickedImagePath` のファイルが消えていた場合、`startChat` がどう振る舞うか。提案: warn ログ + attachment は付けず prepend だけ行う（LLM は path だけは知っているので存在確認できる）。

## 関連

- 関連プラン: `feat-image-path-routing.md`（rewriter 側の path 統一、本リファクタとは独立だが思想は同じ）
- canvas 設計: `server/api/routes/plugins.ts:240-254`、`src/plugins/canvas/View.vue:151-159`（既に path-first なので移行のお手本）
- 直近の関連設計: `server/api/routes/image.ts` の `respondWithImage` (`saveImage` 経由で path 返却) は既に path-first
