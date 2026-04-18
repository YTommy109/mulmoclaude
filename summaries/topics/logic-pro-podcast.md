# Logic Pro × ポッドキャスト編集

## 経緯
- 2026-04-12: ユーザーがLogic Proでポッドキャスト編集中。音楽向けDAWのためポッドキャスト作業に手間がかかっている。
- ナレッジを [wiki/pages/logic-pro-podcast.md](../../wiki/pages/logic-pro-podcast.md) にまとめた。

## 主な編集作業
- ノイズカット（フィラー・咳・呼吸音・クリック音・タイピング音）
- BGM・オープニングSEの挿入
- 無音縮めは現状省略

## 推奨設定・機能
- Strip Silence（閾値 -40〜-50dB、最小時間 0.3〜0.5秒）で無音カット自動化
- Marquee Tool（`T`）でフィラー範囲選択→削除
- Flex Time でリズム調整
- Key Commands カスタマイズ

## Wiki自動引用
- 現状は自動引用なし。明示的に参照指示が必要。
- `memory.md` に記載することで発見性向上の可能性あり。

## 2026-04-15 — 英語 TTS 比較メモ

- OpenAI TTS（tts-1-hd）: 声 6 種、$15/1M 文字、Realtime API 対応
- Gemini TTS（2.5 Flash/Pro）: 声 30 種以上、マルチスピーカー対応、安価
- ポッドキャスト向けには Gemini のマルチスピーカー機能が有力候補
