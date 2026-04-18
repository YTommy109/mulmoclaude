# 英語音声合成（TTS）サービス比較 — 調査メモ

用途：英会話教材スクリプトの音声生成
調査日：2026-04-15

## 主要サービス概要

### OpenAI TTS（tts-1 / tts-1-hd）
- 6種類のプリセットボイス（alloy, echo, fable, onyx, nova, shimmer）
- デフォルトが米語固定、他アクセント指定不可
- speed パラメーター（0.25〜4.0）のみ調整可能
- 子供・高齢者の声なし
- リアルタイム音声会話：Realtime API で対応

### Gemini TTS（Gemini 2.5 Flash/Pro）
- 30種類以上のプリセットボイス
- プロンプトで感情・話し方をある程度誘導可能
- マルチスピーカー対応（複数話者の会話を1コールで生成）
- 数値パラメーター調整は不可
- コスト比較的安価

### ElevenLabs
- 豊富なボイスライブラリ（年齢・性別・アクセントでフィルタリング）
- アクセント：米語・英語・豪語・インド英語など多数対応
- 数値パラメーター：stability / similarity_boost / style / speed
- Voice Design：テキスト指示から新規ボイスを生成
- Voice Clone：サンプル音声から声を複製
- どもり・フィラー語はテキスト＋パラメーターで再現可能

### Azure TTS（Microsoft）
- SSML（Speech Synthesis Markup Language）で詳細制御
- 音素レベル（IPA）での発音直接指定が可能
- break タグで単語間ポーズ挿入 → リンキング防止
- prosody タグで rate / pitch / volume 制御
- 日本人向け聴き取りやすい音声に最適

### Google Cloud TTS
- Azure TTS と同様にSSML対応
- 音素指定・ポーズ制御可能

### その他
- Hume AI：感情パラメーターで声の感情状態を数値制御
- Resemble AI：どもり・笑い・ため息など細かく制御可能

## アクセント対応比較

| アクセント | OpenAI | Gemini | ElevenLabs | Azure |
|---|---|---|---|---|
| 米語 | ✅ | ✅ | ✅ | ✅ |
| 英語（British） | ❌ | △ | ✅ | ✅ |
| 豪語（Australian） | ❌ | △ | ✅ | ✅ |
| インド英語 | ❌ | △ | ✅ | ✅ |

## 年齢・性別対応

| カテゴリ | OpenAI | Gemini | ElevenLabs |
|---|---|---|---|
| 子供 | ❌ | ❌ | ✅ |
| 若い男女 | △ | ✅ | ✅ |
| 中年・高齢 | △ | △ | ✅ |

## 発音・イントネーション制御

| 表現 | OpenAI | Gemini | ElevenLabs | Azure TTS |
|---|---|---|---|---|
| 政治家風クリア発音 | △ | △ | ✅ | ✅ |
| どもり・フィラー | ❌ | △ | ✅ | △ |
| リンキングなし | ❌ | ❌ | △ | ✅（SSML） |
| リダクションなし | ❌ | ❌ | △ | ✅（音素指定） |
| 音素レベル制御 | ❌ | ❌ | ❌ | ✅ |

## 日本人向け聴き取りやすい音声の作り方（Azure TTS）

```xml
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
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

ポイント：
- リダクション形（wanna/gonna）を正式形（want to/going to）に前処理
- break タグで単語間ポーズを挿入してリンキングを防止
- prosody rate で少しゆっくり目に設定

## 用途別おすすめ

| 用途 | おすすめ |
|---|---|
| 米語のみ・シンプルな読み上げ | OpenAI TTS |
| 複数話者の会話・コスト重視 | Gemini TTS |
| アクセント指定・キャラクター豊富 | ElevenLabs |
| 日本人向け・リンキング/リダクションなし | Azure TTS + SSML |
| 感情豊かな表現 | Hume AI / ElevenLabs |

## 教材別おすすめ声構成

| 教材ターゲット | 構成 |
|---|---|
| 子供向け | 子供の声＋若い女性教師（ElevenLabs） |
| 中高生向け | 若い男女ペア（ElevenLabs / Gemini） |
| ビジネス英語 | 大人の男女ペア（ElevenLabs） |
| シニア向け | ゆっくり・明瞭な中年〜高齢声（ElevenLabs） |
| 日本人初心者 | リンキング/リダクションなし（Azure TTS） |
