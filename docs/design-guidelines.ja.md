# Mattermost Deck 設計ガイド

[English version](./design-guidelines.md)

## 目的

Mattermost Web 自体を作り直さずに、右側へ監視向けのマルチペイン deck を追加する Chrome 拡張機能を実装することです。

## プロダクト方針

- Mattermost 本体を主 UI とする
- 拡張機能は監視、横断確認、素早いコンテキスト切り替えに特化した補助 UI とする
- 常駐感と応答性は重視するが、Mattermost 内部実装への過度な依存は避ける

## UI の責務分離

### Mattermost 本体が担当するもの

- ログイン
- チーム切り替え
- チャンネル切り替え
- 投稿と編集
- 標準のスレッド UI

### Deck が担当するもの

- マルチペイン監視レイアウト
- Mentions / Channel Watch / DM / Search / Saved / Diagnostics
- ペイン構成の永続化
- 保存済みペインセット
- 補助的な検索とフィルタ
- レイアウトのエクスポート / インポート

## アーキテクチャ

### 注入方式

- Manifest V3 拡張
- 設定済み Mattermost origin に対する動的登録
- `body` 直下の Shadow DOM マウント
- Mattermost 本体の横幅を縮めて右側に deck 領域を確保

### 描画ガード

次をすべて満たした時だけ描画します。

- `window.location.origin` が設定済み server URL と一致
- 現在の route kind が許可対象
- 任意設定の team slug 制限に一致
- health-check API が成功

Mattermost 固有 DOM の存在確認を主ガードにはしません。

## データモデル

### ペイン種別

- `mentions`
- `channelWatch`
- `dmWatch`
- `search`
- `saved`
- `diagnostics`

### 保存対象

- ペイン順
- ペイン設定
- ドロワー開閉状態
- ドロワー幅
- 基準ペイン幅
- 基準カラム幅
- 保存済みペインセット
- 最近使った対象

## 同期モデル

### REST

- 現在の Mattermost ブラウザセッションを利用
- 初期表示は REST で取得
- realtime 無効時は保守的な polling を使う

### WebSocket

- 任意機能
- PAT が設定されている場合だけ有効
- 全量再構築ではなく差分反映に利用

### ヘルス

ヘルス状態と同期方式は概念的には別ですが、トップバーではまとめて表示します。

例:

- `Healthy / Realtime`
- `Healthy / Polling`
- `Degraded / Polling`
- `Error / Polling`

主信号は既存 REST の成功 / 失敗で、補助信号として設定済み health-check API を使います。

## リクエスト制御

### バースト防止

複数ペインが同時に更新されても、一斉リクエストにならないことを重視します。

現行方針:

- REST はタブ内 1 本のキューで逐次化
- 最小リクエスト間隔を強制
- GET の inflight dedupe を利用
- 短い TTL キャッシュを利用

### ポーリング

- polling 間隔は保存時と読込時の両方で正規化
- 0 や極端に短い値はユーザー設定で指定できない
- `All teams` メンションは重いモードとして扱い、実効下限を長くする
- Search ペインは通常監視ペインより遅い polling 下限を持つ

## セキュリティ

### PAT 保存

永続保存時の PAT は生の平文では保存しません。

実装概要:

- AES-GCM
- PBKDF2
- クライアント側の鍵導出
- 導出済み鍵のメモ化

これは平文露出を避けるための保護であり、完全な秘密境界ではありません。

### 永続化ポリシー

- 既定値は session-only
- 永続保存は opt-in

### Health Check 制約

- `/api/v4/...` 配下のみ許可
- 設定済み Mattermost origin 上のみに限定

## 操作ルール

### 投稿クリック

ユーザー設定で次を選べます。

- 遷移
- 何もしない
- 選択して決める

文字選択やドラッグ中は遷移しません。

### 自動スクロール

一定時間ユーザー操作がない場合のみ、新着に合わせて上方向へ戻すことがあります。読んでいる途中に強制ジャンプしないことを優先します。

### ペイン並び替え

- ペイン内の左右移動
- Views メニュー内の並び替えモード
- 並び替えアニメーションは順序変更時のみ発火し、通常の内容更新では発火しない

## Search UX

- 専用ハイライトトークンを使う
- スニペットは先頭固定ではなく最初の一致周辺を優先
- Mattermost 検索仕様に合わせたヒントを出す
- 旧 Keyword Watch は Search に統合済み

## レイアウトのエクスポート / インポート

- Export は JSON ファイルとしてダウンロード
- Import は JSON ファイル選択で読み込み
- PAT はエクスポート対象に含めない

## テーマ

- 既定テーマは `mattermost`
- Mattermost テーマ連携は、脆い DOM 推測より CSS 変数を優先する
- バッジ、ボタン、ハイライト、トップバー文字は別トークンを使い分けてよい
- ペイン識別アイコンは常時表示
- ペイン色アクセントは任意設定で、既定ではオフ

## 多言語対応

UI の国際化には i18next と react-i18next を使います。ロケールファイルは `src/ui/locales/` にあります。

### 対応言語

| コード | 言語 |
|--------|------|
| `ja` | 日本語（デフォルト） |
| `en` | 英語（フォールバック） |
| `de` | ドイツ語 |
| `zh-CN` | 中国語（簡体字） |
| `fr` | フランス語 |

### 新しい言語の追加手順

1. `en.json` を新ファイル（例: `ko.json`）としてコピーし、値を翻訳する。
2. `src/ui/i18n.ts` でインポートしてロケールコードで登録する。
3. `src/ui/settings.ts` の `DeckLanguage` と `normaliseLanguage` にコードを追加する。
4. `src/options/index.tsx` の `languageOptions` に言語オプションを追加する。

### 複数形

英語は i18next の `_one` / `_other` サフィックスキーを使います。文法的な数の区別がない言語（日本語・中国語）はベースキー 1 つで対応します。キーが存在しない場合は `en` にフォールバックします。

### 変数展開

`{{variable}}` 構文を使います。Shadow DOM 内部は安全なため HTML エスケープは不要です。

## ドキュメントと配布

- ライセンスは MIT
- README は英語版と日本語版を用意
- 設計書も英語版と日本語版を用意
- GitHub Actions によるリリースパッケージングは `v*` タグ push で実行
