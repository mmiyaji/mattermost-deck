# Mattermost Deck 設計ガイド

[English version](./design-guidelines.md)

## 目的

Mattermost Web 本体を作り直さずに、右側へ監視向けのマルチペイン Deck を追加する Chrome 拡張を設計する。

## プロダクトの位置付け

- Mattermost 本体が主 UI
- 拡張は一覧性、監視性、素早いコンテキスト切り替えに特化した補助ワークスペース
- Mattermost 内部 DOM に強く依存せず、常用できる応答性を保つ

## UI の責務

### Mattermost 本体が持つもの

- ログイン
- チーム切り替え
- チャンネル切り替え
- 投稿と編集
- ネイティブのスレッドパネル

### Deck が持つもの

- マルチペイン監視レイアウト
- `mentions`、`channelWatch`、`dmWatch`、`keywordWatch`、`search`、`saved`、`diagnostics`
- ペイン設定の永続化
- 保存済みペインセット
- recent targets
- origin ごとの任意プロファイル
- レイアウトの export / import

## アーキテクチャ

### 注入方式

- Manifest V3 拡張
- 設定済み Mattermost origin のみを動的登録
- `body` 配下に Shadow DOM をマウント
- Mattermost 側の幅を調整して Deck 用スペースを確保

### 描画ガード

以下をすべて満たすときだけ描画する。

- `window.location.origin` が設定済み server URL と一致する
- 現在の route kind が許可されている
- 任意の team slug 制限に一致する
- health-check API が成功する

Mattermost DOM の脆い判定を主ガードにしてはいけない。

## データモデル

### ペイン種別

- `mentions`
- `channelWatch`
- `dmWatch`
- `keywordWatch`
- `search`
- `saved`
- `diagnostics`

### 永続化する状態

少なくとも以下を保存する。

- ペイン順
- ペイン設定
- ドロワー開閉状態
- ドロワー幅
- レール既定幅
- ペイン既定幅
- 保存済みペインセット
- recent targets
- プロファイルレジストリ

## 同期モデル

### REST

- 現在の Mattermost ブラウザセッションをそのまま利用する
- 初回ロードは REST が担当する
- realtime 無効時は保守的な polling を使う

### WebSocket

- 任意機能
- PAT 設定時のみ有効
- 全再構築ではなく差分更新用に使う

### ヘルス表示

ヘルス状態と同期方式は分けて管理しつつ、トップバーでは近い場所にまとめて見せる。

例:

- `Healthy`
- `Healthy` + realtime アイコン
- `Healthy` + polling アイコン
- `Degraded` + polling アイコン

## リクエスト制御

### バースト回避

多くのペインが同時更新されても、同期したバーストを起こさないこと。

現行設計:

- タブ内 REST キューの直列化
- 最小リクエスト間隔
- GET の inflight dedupe
- GET の短い TTL キャッシュ
- all-teams mentions の重い fan-out を小さいバッチで分散

### Polling ルール

- polling 間隔は load/save 時に正規化する
- `All teams` mentions は重いモードとして遅めの floor を持つ
- search 系ペインは通常監視ペインより遅めの floor を持つ
- team 単位、channel 単位の fan-out は `Promise.all` より小並列バッチを優先する

## Diagnostics と Performance

### Diagnostics ペイン

Diagnostics は通常運用中に横目で見る軽量ビューとして扱う。

表示対象は次に絞る。

- 現在のヘルス状態
- 同期方式
- 基本的なリクエストレート
- 平均遅延
- エラー率
- in-flight 件数
- 最近の reconnect / sync ヒント

### Performance タブ

Options の `Performance` タブは詳細分析用とする。

ここで扱うもの:

- trace capture の制御
- API endpoint summary
- recent trace テーブル
- JSONL export
- ソートや分析を伴う重めの UI

### トレース保持ポリシー

- trace capture を OFF にすると保存済みトレースはクリアする
- 24 時間を超えたトレースは自動削除する
- 拡張ストレージで安全に扱える上限を守る

## セキュリティ

### PAT 保存

永続保存時の PAT は生の平文では保存しない。

実装要約:

- AES-GCM
- PBKDF2
- クライアント側鍵導出
- 導出鍵のメモ化

これは accidental disclosure への耐性を上げるものであり、完全な secret boundary ではない。

### 永続化ポリシー

- 既定は session-only
- 永続保存は明示的な opt-in

### Health Check 制約

- health-check path は `/api/v4/...` 配下に制限する
- リクエスト先は設定済み Mattermost origin に限定する

## 操作ルール

### 投稿クリック

ユーザー設定可能な動作:

- navigate
- do nothing
- ask

テキスト選択やドラッグでは遷移させない。

Deck から Mattermost 本体へ投稿を開くときは、対象投稿が見える位置までスクロールを試みる。

### ローディング表示

- Deck 全体のローディングは初回ブート時だけ使う
- レイアウト確定後の重い取得はペイン単位ローディングを使う
- 初回成功取得前に空状態カードを点滅させない

### ペイン並べ替え

- ペイン操作から左右移動できる
- Views メニューから追加の並べ替え導線を持つ
- アニメーションは順序変更時にだけ使う

## 投稿本文レンダリング

- 通常テキスト中の `http://` と `https://` を検出する
- マルチバイト文字の直後に URL が来るケースも扱う
- 長い URL や長い 1 トークンは表示だけ省略する
- 元の URL はリンク先と tooltip に保持する

## Search UX

- ハイライトは専用トークンで描画する
- スニペットは先頭固定切り詰めではなく、最初の一致周辺を優先する
- `keywordWatch` は `search` と別ペインとして保つ

## Layout Export / Import

- export は JSON ダウンロードを生成する
- import は選択した JSON ファイルを読む
- PAT は export 対象に含めない

## テーマ

- 既定テーマは `mattermost`
- Mattermost テーマ連動は DOM 判定より CSS 変数を優先する
- ペイン識別アイコンは常時表示する
- ペイン識別カラーは任意機能で既定 OFF

## Options UX

- `Connection` は server URL と有効化前提を最優先にする
- `Profiles` は任意の上級設定として扱う
- 見た目設定は `Appearance` にまとめる
- 動作設定は `Behavior` にまとめる
- パフォーマンス分析は、常時表示の Diagnostics ではなく `Performance` に置く

## 多言語化

UI は i18next と react-i18next を使う。locale ファイルは `src/ui/locales/` に置く。

拡張パッケージの名前と説明文は `src/_locales/` を使う。

対応 UI 言語:

- `ja`
- `en`
- `de`
- `zh-CN`
- `fr`
