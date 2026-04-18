# 英語音声合成（TTS）サービス比較

英会話教材向け TTS サービスの調査まとめ。詳細は [wiki ページ](../../wiki/pages/tts-comparison.md) 参照。

## 用途別おすすめ

| 用途 | 推奨サービス |
|---|---|
| 複数話者の会話教材 | Gemini TTS（マルチスピーカー） |
| アクセント・年齢・発音スタイルの多様性 | ElevenLabs |
| リダクション・リンキングなし（日本人向け） | Azure TTS + SSML |
| シンプルなナレーター1名 | OpenAI TTS |
| リアルタイム発音練習 | OpenAI Realtime API |

## 声の制御方法

- **OpenAI**: プリセット6種 + 速度パラメーターのみ。アクセントは米語固定
- **Gemini**: プリセット30種以上 + プロンプトによる感情誘導。Britishボイス一部あり
- **ElevenLabs**: プリセット多数 + stability/similarity/style スライダー。Voice Design で合成も可
- **Azure**: SSML で音素・ピッチ・速度・ポーズを直接指定可能
