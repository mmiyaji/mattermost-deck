# Mattermost Deck 設計ガイド

[English version](./design-guidelines.md)

## 目的

Mattermost Web 本体を作り直さずに、右側へ監視向けのマルチペイン Deck を追加する Chrome 拡張を設計する。

## プロダクトの位置付け

- Mattermost 本体が主 UI
- 拡張は監視、一覧性、素早いコンテキスト切替に特化した補助 UI
- Mattermost 内部 DOM に強く依存しすぎず、持続的で軽快な体験を維持する

## UI の責務

### Mattermost 本体が持つもの

- ログイン
- チーム切替
- チャンネル切替
- 投稿と編集
- ネイティブのスレッド UI

### Deck が持つもの

- マルチペイン監視レイアウト
- `mentions`、`channelWatch`、`dmWatch`、`keywordWatch`、`search`、`saved`、`diagnostics`
- ペイン設定の永続化
- 保存済みペインセット
- recent targets
- origin 単位の任意プロファイル
- レイアウトの export / import

## アーキテクチャ

### 注入モデル

- Manifest V3 拡張
- 設定済み Mattermost origin だけへ動的登録
- `body` 配下に Shadow DOM をマウント
- Mattermost 側の幅を調整して Deck 用スペースを確保

### 描画ガード

次をすべて満たしたときだけ描画する:

- `window.location.origin` が設定済み server URL と一致
- 現在の route kind が許可対象
- 任意設定の team slug 制限に一致
- health-check API が成功

主ガードとして Mattermost DOM の脆い構造検出に依存しない。

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

- ペイン順序
- ペイン設定
- ドロワー開閉状態
- ドロワー幅
- 既定レール幅
- 既定カラム幅
- 保存済みペインセット
- recent targets
- プロファイルレジストリ

## 同期モデル

### REST

- 現在の Mattermost ブラウザセッションを再利用
- 初回ロードは REST ベース
- realtime 無効時は保守的な polling

### WebSocket

- 任意機能
- PAT 設定時のみ有効
- フルリビルドではなく差分更新に使う

### ヘルス表示

ヘルス状態と同期モードは分離して持ちつつ、トップバーでは組み合わせて表示する。

例:

- `Healthy / Realtime`
- `Healthy / Polling`
- `Degraded / Polling`
- `Error / Polling`

## リクエスト制御

### バースト回避

多くのペインが同時更新しても同期バーストを起こさないこと。

現行方針:

- タブ内 REST キューの直列化
- 最小リクエスト間隔
- GET の inflight dedupe
- GET の短い TTL キャッシュ

### Polling ルール

- polling 間隔は load/save 時に正規化
- `All teams` mentions は重いモードとしてより遅い floor を使う
- search 系ペインは通常監視ペインより遅めの floor を使う

## セキュリティ

### PAT 保存

永続保存時の PAT は生の平文では保持しない。

実装概要:

- AES-GCM
- PBKDF2
- クライアント側キー素材
- 派生キーのメモ化

これは偶発的な露出を減らすための最低限の対策であり、完全な秘密境界ではない。

### 永続化ポリシー

- 既定は session-only
- 永続保存は明示的 opt-in

### Health Check 制約

- health-check path は `/api/v4/...` 配下に制限
- リクエスト先は設定済み Mattermost origin のみに制限

## 操作ルール

### 投稿クリック

ユーザー設定で次を選べる:

- navigate
- do nothing
- ask

文字選択やドラッグ中は遷移を発火させない。

### ローディング表示

- Deck 全体のローディングは初回ブート時だけ使う
- レイアウトが出た後の重い取得はカラム単位ローディングで表現する
- 初回フェッチ完了前に空状態カードを一瞬出さない

### ペイン並び替え

- ペイン操作からの左右移動
- Views メニューからの追加並び替え導線
- アニメーションは順序変更時のみ動かす

## 投稿本文レンダリング

- 通常テキスト中の `http://` と `https://` を検出する
- URL 直前にマルチバイト文字があっても検出できるようにする
- 長い URL や長い連続文字列は表示だけ省略し、元の値は保持する

## Search UX

- ハイライトは専用トークンで扱う
- スニペットは先頭固定ではなく最初の一致近傍を優先する
- `keywordWatch` は `search` とは別ペインとして維持する

## Layout Export / Import

- export は JSON ダウンロード
- import は選択した JSON ファイルから復元
- PAT は export 対象に含めない

## テーマ

- 既定テーマは `mattermost`
- Mattermost テーマ追従は DOM 推測より CSS 変数を優先
- ペイン種別アイコンは常時表示
- ペイン識別カラーは任意機能で既定オフ

## Options UX

- `Connection` は server URL と起動前提条件を最優先に置く
- `Profiles` は任意の上級設定として扱う
- 見た目の設定は `Appearance` に集約する
- 動作の設定は `Behavior` に集約する

## 多言語化

UI は i18next と react-i18next を使う。locale ファイルは `src/ui/locales/` に置く。

対応言語:

- `ja`
- `en`
- `de`
- `zh-CN`
- `fr`
