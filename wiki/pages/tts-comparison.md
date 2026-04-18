---
title: 英語音声合成（TTS）サービス比較
created: 2026-04-15
updated: 2026-04-15
tags: [tts, audio, english, voice, education, azure, openai, gemini, elevenlabs]
---

# 英語音声合成（TTS）サービス比較

英会話教材スクリプトの音声生成を目的とした、主要TTSサービスの比較まとめ。

---

## 主要サービス概要

### OpenAI TTS
- **ボイス**：6種類のプリセット（alloy / echo / fable / onyx / nova / shimmer）
- **アクセント**：米語固定（変更不可）
- **パラメーター**：`speed`（0.25〜4.0）のみ
- **年齢感**：子供・高齢者ボイスなし
- **強み**：シンプル・安定・実績あり
- **弱み**：柔軟性が低い

### Gemini TTS
- **ボイス**：30種類以上のプリセット
- **アクセント**：ボイスによって異なる（明示的な指定は限定的）
- **パラメーター**：プロンプトで感情・話し方を誘導
- **特徴**：マルチスピーカー対応（複数話者を1コールで生成）
- **強み**：コスト安・会話形式の教材に向く
- **弱み**：細かい発音制御は不可

### ElevenLabs
- **ボイス**：膨大なライブラリ（年齢・性別・アクセントでフィルタリング可）
- **アクセント**：米語・英語（British）・豪語・インド英語など多数
- **パラメーター**：`stability` / `similarity_boost` / `style` / `speed`（数値指定）
- **特徴**：
  - Voice Design：テキスト指示から新規ボイスを生成
  - Voice Clone：サンプル音声から声を複製
  - どもり・フィラー語をテキストとパラメーターで再現可能
- **強み**：自由度・品質・アクセント対応が最高水準
- **弱み**：コストがやや高い

### Azure TTS（Microsoft）
- **ボイス**：多数（Neural TTS）
- **アクセント**：主要英語アクセント対応
- **特徴**：SSML（Speech Synthesis Markup Language）で詳細制御
  - `<phoneme>` タグで音素レベル（IPA）の発音直接指定
  - `<break>` タグで単語間ポーズ挿入
  - `<prosody>` タグで rate / pitch / volume 制御
- **強み**：日本人向け「聴き取りやすい英語」の実現に最適
- **弱み**：SSML記述の手間がかかる

### その他サービス
| サービス | 特徴 |
|---|---|
| Google Cloud TTS | Azure同様のSSML対応・音素指定可 |
| Hume AI | 感情パラメーターで声の感情状態を数値制御 |
| Resemble AI | どもり・笑い・ため息など細かく制御可能 |

---

## 比較表

### アクセント対応

| アクセント | OpenAI | Gemini | ElevenLabs | Azure |
|---|---|---|---|---|
| 🇺🇸 米語 | ✅ | ✅ | ✅ | ✅ |
| 🇬🇧 英語（British） | ❌ | △ | ✅ | ✅ |
| 🇦🇺 豪語（Australian） | ❌ | △ | ✅ | ✅ |
| 🇮🇳 インド英語 | ❌ | △ | ✅ | ✅ |

### 年齢・性別対応

| カテゴリ | OpenAI | Gemini | ElevenLabs |
|---|---|---|---|
| 👧👦 子供 | ❌ | ❌ | ✅ |
| 👩👨 若い男女 | △ | ✅ | ✅ |
| 👩‍🦳👨‍🦳 中年・高齢 | △ | △ | ✅ |

### 発音・イントネーション制御

| 表現 | OpenAI | Gemini | ElevenLabs | Azure TTS |
|---|---|---|---|---|
| 政治家風クリア発音 | △ | △ | ✅ | ✅ |
| どもり・フィラー語 | ❌ | △ | ✅ | △ |
| リンキングなし | ❌ | ❌ | △ | ✅（SSML） |
| リダクションなし | ❌ | ❌ | △ | ✅（音素指定） |
| 音素レベル制御（IPA） | ❌ | ❌ | ❌ | ✅ |

---

## 日本人向け聴き取りやすい音声の作り方

### 課題：自然な英語TTSが自動で行ってしまうこと
| 現象 | 例 |
|---|---|
| リダクション | `want to` → `wanna`、`of` → `ə` |
| リンキング | `pick it up` → `pi-ki-dup` |
| フラッピング | `water` → `wader`（米語） |
| 消音 | `next day` → `nex day` |

### 解決策：Azure TTS + SSML

**ステップ1：スクリプト前処理**（リダクション形を正式形に戻す）
```
wanna  → want to
gonna  → going to
kinda  → kind of
'cause → because
```

**ステップ2：SSMLで単語を分離**
```xml
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xml:lang="en-US">
  <prosody rate="0.85">
    <phoneme alphabet="ipa" ph="aɪ">I</phoneme>
    <break time="100ms"/>
    <phoneme alphabet="ipa" ph="wɒnt">want</phoneme>
    <break time="100ms"/>
    <phoneme alphabet="ipa" ph="tuː">to</phoneme>
    <break time="100ms"/>
    <phoneme alphabet="ipa" ph="goʊ">go</phoneme>
  </prosody>
</speak>
```

---

## 用途別おすすめ

| 用途 | おすすめサービス |
|---|---|
| 米語のみ・シンプルな読み上げ | OpenAI TTS |
| 複数話者の会話・コスト重視 | Gemini TTS |
| アクセント指定・豊富なキャラクター | ElevenLabs |
| 日本人向け・リンキング/リダクションなし | **Azure TTS + SSML** |
| 感情豊かな表現 | Hume AI / ElevenLabs |
| どもり・ため息など特殊表現 | Resemble AI |

## 教材ターゲット別おすすめ構成

| ターゲット | 声の構成 |
|---|---|
| 子供向け | 子供の声＋若い女性教師（ElevenLabs） |
| 中高生向け | 若い男女ペア（ElevenLabs / Gemini） |
| ビジネス英語 | 大人の男女ペア（ElevenLabs） |
| シニア向け | ゆっくり・明瞭な中年〜高齢声（ElevenLabs） |
| 日本人初心者 | リンキング/リダクションなし（Azure TTS） |

---

## 関連ページ
- [[logic-pro-podcast]]

<!-- journal-session-backlinks -->
## History

- [session 0d928773](../../chat/0d928773-9952-4978-85bb-a13e74578b8a.jsonl)
