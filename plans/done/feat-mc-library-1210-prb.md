# mc-library 読書ジャーナル skill (#1210 PR-B)

PR-A (#1211) で蓄えた preset skill 配信メカ上に、最初の実プリセットを乗せる。
読んだ本・読みたい本を管理し、読了時に感想を引き出してそのまま記録、
あとで「あの本どう思ったっけ」で本人の言葉を返す、という体験を狙う。

## スコープ

- `server/workspace/skills-preset/mc-example/` 削除（PR-A の stub お役御免）
- `server/workspace/skills-preset/mc-library/SKILL.md` 新設（振る舞い指向、日本語）
- `test/workspace/test_skills_preset.ts` のリポジトリフィクスチャテスト更新
  （現状「at least the mc-example stub」を「mc-library」に差し替え）
- ロール `librarian` は **追加しない**（skill 単体で完結、どのロールでも `/mc-library`
  で呼べる）
- `BUILTIN_ROLE_IDS` は **触らない**

## skill の設計方針

CRUD スペックではなく振る舞いガイドにする。3 つの場面に絞る:

1. **読みたい本の登録** — 「これ読みたい」と言われたら 1 行で確認、聞き返さない
2. **読了の記録** — 「読んだ」と言われたら open question を 1〜2 個で感想を引き出し、
   返ってきた言葉をそのまま捕捉
3. **過去の感想の検索** — 「あの本どう思ったっけ」と言われたら本人の言葉を引用付きで返す

ファイル形式・パス・スラグ規則は最低限明記する（Claude が一貫した実装を選ぶ
ために必要）が、トーン指示として「ファイルパスや frontmatter の話をユーザーに
しない」を入れる。

## 保存場所と形式

```text
data/library/books/<slug>.md
```

スラグ: ASCII 小文字 + 数字 + ハイフン、非 ASCII タイトルはローマ字化（既存
規約と一致）。

frontmatter:
```yaml
title:        # 必須
author:       # 必須
status:       # want | reading | read | abandoned のいずれか、必須
finishedAt:   # 任意。status=read のとき書き込む
created:      # 初回保存で固定
updated:      # 毎回更新
```

`rating` / `tags` / `startedAt` / `isbn` は任意。**ユーザーが言わない限り聞かない。**

本文:
- `## 感想` — ユーザーの言葉そのまま（要約・パラフレーズ禁止）
- `## 引用` — 共有された一節があればそのまま

## Google Books 連動は PR-C

PR-B は **データ取得の自動化を含めない**。スキル本文に「保存時に Google Books
API を叩いて表紙を取得」みたいな指示は書かない。最小の体験を先に確認したい。

PR-C で `mc-library/SKILL.md` を改訂し、WebFetch ツール経由で Google Books API
（認証不要）から ISBN・表紙画像 URL・著者・概要を取得して frontmatter / 本文に
埋め込む手順を追加する。

## テスト

リポジトリフィクスチャテスト（`test/workspace/test_skills_preset.ts` の最後の
describe ブロック）を更新するだけで、新規テストは不要。 syncPresetSkills の
振る舞いは PR-A で完備。

## 手動スモーク

1. `~/mulmoclaude/.claude/skills/mc-example` が消えるのを確認（PR-A で boot
   したことのある環境では残ってるはず → cleanup ロジックが除去）
2. `~/mulmoclaude/.claude/skills/mc-library/SKILL.md` が boot で配置される
3. mulmoclaude を起動、適当なロール（General など）で「サピエンスを読書リストに
   追加して」 → `data/library/books/sapiens.md` が `status: want` で作成される
4. 「サピエンス読み終わった、印象に残ったのは〜」 → 同ファイルが
   `status: read` + `## 感想` 追加で更新される
5. 「進化心理学について何か読んだっけ」 → サピエンスのファイルから感想引用付きで返る

## 後始末

- 旧 issue #1188 (reading-list-as-plugin) を close
- 旧 PR #1190 (plugin 案 draft) を close
- このプランファイルは PR-B のマージ後に `plans/done/` に移動
