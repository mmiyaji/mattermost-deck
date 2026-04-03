# Mattermost Deck 設計ガイドライン

[English version](./design-guidelines.md)

## 目的

Mattermost Web の右側を TweetDeck 風のマルチペイン監視領域にする Chrome 拡張を作る。ただし Mattermost 自体を再実装しない。

この拡張はあくまで補助 UI として位置付ける。

- ログイン、チーム切り替え、チャンネル切り替え、投稿、基本ナビゲーションは Mattermost 本体を正とする
- 拡張は右側に補助的な監視ペインを追加する
- 常時表示かつリアルタイム寄りに感じられることは重要だが、Mattermost 内部への強結合や過剰な API 負荷は避ける

## プロダクト方針

### メイン UI と拡張 UI

- 左側と中央は Mattermost 本体の UI をそのまま使う
- 右側は拡張が管理する deck 領域とする
- deck 領域は複数カラムを横並びで持つ
- Mattermost と deck の境界はドラッグでリサイズできる
- deck 全体は細いドロワーへ折りたためる

### 拡張がやること

- 監視向けペインを表示する
  - mentions
  - watched channels
  - DM / Group DM
  - 将来的には thread や search
- 各ペインは現在の表示チャンネルではなく、それぞれ独立した対象を持てる
- 横に複数並べて同時監視できる

### 拡張がやらないこと

- Mattermost のチームナビゲーションを作り直さない
- Mattermost のチャンネルナビゲーションを作り直さない
- エディタや投稿フローを再実装しない
- Mattermost の内部 Redux state や壊れやすい private DOM に依存しない

## アーキテクチャ

### 注入方針

- Manifest V3 の Chrome 拡張として実装する
- content script は、設定済み Mattermost origin に対してのみ動的登録する
- Server URL 保存時に、その origin への Chrome 権限を明示的に要求する
- `body` 配下の Shadow DOM に拡張 UI を描画する
- オーバーレイではなく、Mattermost 側の幅を縮めて右領域を確保する

理由:

- Shadow DOM により CSS 干渉を抑えられる
- 本当に右側に増設された UI として見える
- 動的登録により権限範囲を最小化でき、無関係なサイトへ注入しない

### 描画ガード

拡張は次をすべて満たす時だけ描画する。

- `window.location.origin` が設定済み Mattermost Server URL と一致する
- route kind が設定で許可されている
  - 既定値: `channels`, `messages`
- team slug 制限が設定されている場合、その slug に一致する
- 設定済み health-check API が成功する

Mattermost 固有 DOM の存在判定は、バージョン変更に弱いため主判定には使わない。

### Health Check 制約

- health check は相対 `/api/v4/...` パスだけを許可する
- ユーザー指定の絶対 URL は使わない
- 常に設定済み Mattermost origin に対してだけ実行する

## セキュリティ

### PAT 保存

PAT は平文では保存しない。

現在の実装 [`src/ui/storage.ts`](../src/ui/storage.ts):

- prefix: `enc:v1:`
- 暗号方式: `AES-GCM 256`
- IV: 書き込みごとにランダム 12 byte
- 鍵導出:
  - `PBKDF2`
  - `SHA-256`
  - `100_000` iterations
  - salt: `mattermost-deck.local-storage.v1`
- 鍵素材:
  - `chrome.runtime.id`
  - fallback として `window.location.origin`

導出済み `CryptoKey` はメモ化し、毎回 PBKDF2 を回さない。

### PAT の保持ポリシー

- 既定保存先: `chrome.storage.session`
- 任意保存先: `chrome.storage.local`
- 再起動後も保持する永続保存は、明示 opt-in にする

これにより、不要に長く PAT がディスクへ残る可能性を下げる。

### 暗号化の限界

これはクライアント側での最低限の秘匿化であり、完全な秘密保護ではない。

理由:

- 拡張自身が復号できる必要がある
- 鍵導出元はクライアント側にある
- クライアント実行環境が侵害されていれば PAT は回収可能

したがって目的は:

- storage 上の平文露出を避ける
- 軽微な漏えいや誤露出の耐性を上げる
- 保存モデルをユーザーへ正しく説明する

## API バースト防止

### 基本方針

複数ペインが同時にデータを必要としても、同一時刻にまとめて API を投げない。

特に重要なのは:

- 複数 watched pane
- `All teams` mentions
- reconnect 後の再整合
- 複数ペインからの manual refresh

### 現在のリクエストキュー

[`src/mattermost/api.ts`](../src/mattermost/api.ts) で実装:

- 全 REST リクエストは `scheduleApiRequest(...)` を通す
- タブ内では単一キューで逐次実行する
- 最小リクエスト間隔を保証する
  - 現在値: `120ms`

### GET の重複排除と短期キャッシュ

- 同一 pathname の inflight GET dedupe
- GET の短期 TTL キャッシュ
  - 現在値: `1000ms`

### 必須ルール

- ペインごとに WebSocket を作らない
- イベントごとに全ペイン全件を再取得しない
- WebSocket reconnect を tight loop にしない
- 全チームや全ペインを短周期で poll しない
- UI だけでなく保存値読み込み時にも polling 下限を強制する

## ポーリング方針

- Realtime 有効:
  - WebSocket を主とする
  - REST は初期ロードと限定的な再整合に使う
- Realtime 無効:
  - REST ポーリングを主とする
  - ただし保守的な間隔に保つ

### `All teams` メンション

`All teams` は重いモードとして扱う。

- デフォルトは team 単位
- `All teams` は UI で警告表示する
- `All teams` 時は実効ポーリング間隔の下限を引き上げる
- team ごとの取得も API キューを通して分散する

## データ保持とページング

- 初回取得件数: `20`
- `Load more` 単位: `20`
- ペインごとのメモリ保持上限: `100`

DOM を無制限に増やさず、小さな page size と軽量描画を優先する。

## Manual Refresh

- 対象ペインだけ再取得する
- deck 全体の再ロードにはしない
- 応答が速くても、押したことが分かるフィードバックを出す

現在の UI 方針:

- 更新アイコンを回転させる
- 最小表示時間を確保する
- 実行中はボタンを一時無効化する

## ヘルスモデル

トップバーの状態は、WebSocket の有無だけではなく API の健全性を表すべき。

例:

- `Healthy / Realtime`
- `Healthy / Polling`
- `Degraded / Realtime`
- `Error / Polling`

判定方針:

- 主信号は既存 REST 成功/失敗
- 補助信号として設定済み health-check API path を使う
- data layer に endpoint を埋め込まない

## レイアウトガイドライン

- deck 幅はユーザーがドラッグで変更できる
- ドラッグした幅は保存し、再起動後も復元する
- Options の preferred rail width は初期値として使う
- preferred column width は基準幅として使う
- カラム順も保存する

## ライセンスと公開

- ライセンス: MIT
- 公開方針: 軽量で permissive、無保証
- `README` と `LICENSE` の記載は常に整合しているべき
