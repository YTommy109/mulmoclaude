---
title: Logic Proでポッドキャスト編集
created: 2026-04-12
updated: 2026-04-12
tags: [logic-pro, podcast, audio-editing, daw]
---

# Logic Proでポッドキャスト編集

Logic Proは音楽向けDAWだが、設定とプラグインを工夫することでポッドキャスト編集にも活用できる。

## プロジェクト設定

| 項目 | 推奨値 | 備考 |
|---|---|---|
| サンプルレート | 44.1kHz | 96kHzは不要 |
| ビット深度 | 24-bit | |
| スマートテンポ | Keep Project Tempo | 予期しないタイミングずれ防止 |

## 便利な機能

### Strip Silence（無音カット）
- `Functions > Strip Silence` でリージョン内の無音部分を自動カット
- 推奨設定：Threshold `-40〜-50dB`、Minimum Time `0.3〜0.5秒`
- 無音部分の縮め作業が大幅に楽になる

### Marquee Tool
- `T` キーでツール切替
- 範囲選択 → `Delete` でフィラー・咳などをすばやく削除

### Flex Time
- `Edit > Show Flex Pitch/Time` でリージョン内の無音をつまんで縮める
- 音声には `Monophonic` モードを使用

### よく使うキーコマンド
- `Split at Playhead` — 再生ヘッド位置でリージョンを分割
- `Delete and Move` — 削除後に空白を自動で詰める
- カスタマイズ：`Logic Pro > Settings > Key Commands`

## ノイズカットプラグイン

### 無料・低コスト

| プラグイン | 特徴 |
|---|---|
| iZotope RX Elements | 業界標準。セール時$29前後。呼吸音・クリック音除去が強力 |
| Audiostrip（Web） | 無料Webサービス。ボーカル分離＋ノイズ除去 |
| Logic付属 Noise Gate | 単純な無音カットのみ。細かい作業には不向き |

### 有料・本格派

| プラグイン | 特徴 | 価格目安 |
|---|---|---|
| iZotope RX 10 Standard/Advanced | Dialogue Isolation、Breath Control、De-clickが優秀。**最もおすすめ** | $399〜（セール多い） |
| Accusonus ERA Bundle | ワンノブ系で使いやすい。Noise Remover、De-Clipperなど | $9.99/月 |
| Waves NS1 / WNS | リアルタイムノイズ抑制。録音品質が安定している場合に有効 | $29〜 |

> **イチオシ**：iZotope RX の `Dialogue Isolation` は話し声だけを抽出。タイピング音・クリック音が大量にある録音に特に効果的。

## 代替DAWの検討

ポッドキャスト編集がメイン作業になる場合の選択肢：

- **Hindenburg Journalist** — ポッドキャスト専用設計
- **Reaper** — 軽量＋ポッドキャスト向けマクロで拡張可能

Logic Proを音楽制作と共用している場合は、現状維持がシンプル。

## 主な編集作業

- フィラー（えー、あのー等）除去
- 咳・呼吸音のカット
- クリック音・タイピング音の除去
- 無音部分の縮め
- BGMの挿入
- オープニングSEの挿入
