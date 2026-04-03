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
- Mattermost ページへ content script を注入する
- `body` 配下の Shadow DOM に拡張 UI を描画する
- オーバーレイではなく、Mattermost 側の幅を縮めて右領域を確保する

理由:

- Shadow DOM により CSS 干渉を抑えられる
- 本当に右側に増設された UI として見える
- iframe で Mattermost を二重表示するより安定する

### 描画ガード

拡張は次をすべて満たす時だけ描画する。

- `window.location.origin` が設定済み Mattermost Server URL と一致する
- route kind が設定で許可されている
  - 現在の既定値: `channels`, `messages`
- team slug 制限が設定されている場合、その slug に一致する
- 設定済み health-check API が成功する

Mattermost 固有 DOM の存在判定は、バージョン変更に弱いため主判定には使わない。

### UI 構造

- Mattermost 本体はそのまま操作可能
- 拡張 root は viewport 右端に固定
- deck root は以下で構成する
  - drawer toggle
  - resize handle
  - top bar
  - 横スクロールするカラム列
- 機密性のある設定や低頻度設定はメイン画面ではなく Options ページに置く

### 状態レイヤー

- Route state
  - 現在の Mattermost URL から導出
- Layout state
  - 拡張 storage に保存
  - カラム構成、drawer 状態、rail 幅、column 幅など
- Data state
  - current user
  - teams
  - channel metadata
  - 各ペインの post 一覧
  - mention count
- Realtime state
  - WebSocket 接続状態
  - ローカルへ反映した差分イベント
- Health state
  - 最終 REST 成功時刻
  - 連続失敗回数
  - `Healthy / Polling` のような合成状態

## データ取得方針

### 認証

- REST は既存の Mattermost ブラウザセッションを再利用する
- `fetch(..., { credentials: "include" })` を使う
- `MMCSRF` Cookie 由来の CSRF ヘッダを付与する
- WebSocket はブラウザセッションに依存させない
- WebSocket は任意入力の PAT を使う

含意:

- Mattermost セッションが切れると REST は止まるので、拡張はそれを明示する必要がある

### 初期ロード

REST を使う対象:

- `users/me`
- teams
- unread counts
- channel lookup
- direct channel lists
- channel members
- recent posts
- mention search
- user lookup by IDs

初期表示と再整合の正本は REST とする。

### リアルタイム更新

WebSocket はタブごとに 1 接続だけ使う。

- `authentication_challenge` で保存済み PAT を送る
- サーバ URL は `window.location.origin` から自動取得
- 主に `posted` イベントを購読する
- 必要なペインだけローカル状態へ差分反映する

PAT がない場合:

- WebSocket は開かない
- 表示は Polling モードとする
- REST の保守的なポーリングで補う

### 再整合

基本戦略:

1. 初回は REST
2. 以降は WebSocket の差分反映
3. 必要な時だけ REST で再同期
   - reconnect 後
   - mention count が怪しい時
   - 低頻度 fallback

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

### 暗号化の限界

これはクライアント側での最低限の秘匿化であり、完全な秘密保護ではない。

理由:

- 拡張自身が復号できる必要がある
- 鍵導出元はクライアント側にある
- クライアント実行環境が侵害されていれば PAT は回収可能

したがって目的は:

- local storage 上の平文露出を避ける
- 軽微な漏えいや誤露出の耐性を上げる
- 保存モデルをユーザーへ正しく説明する

であって、

- 完全な秘密保護を主張すること
- OS secret store 相当を期待すること

ではない。

### PAT 運用ガイド

- PAT は任意機能にする
- 可能なら権限を絞ったトークンを使う
- UI には「ローカル暗号化だが完全な保護ではない」と明記する

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

この意味:

- multi-pane の fan-out が一斉バーストしない
- reconnect や refresh の負荷が時間方向に分散される
- API 負荷が読みやすくなる

### GET の重複排除と短期キャッシュ

現在は次も入っている。

- 同一 pathname の inflight GET dedupe
- GET の短期 TTL キャッシュ
  - 現在値: `1000ms`

この意味:

- 複数ペインが同じ endpoint を見ても 1 回にまとまりやすい
- route 判定で同じ endpoint をすぐ叩き直さない
- ただし長時間 stale を隠すほどのキャッシュにはしない

### 必須ルール

- ペインごとに WebSocket を作らない
- イベントごとに全ペイン全件を再取得しない
- WebSocket reconnect を tight loop にしない
- 全チームや全ペインを短周期で poll しない
- UI だけでなく保存値読み込み時にも polling 下限を強制する

## ポーリング方針

### 基本ルール

- Realtime 有効:
  - WebSocket を主とする
  - REST は初期ロードと限定的な再整合に使う
- Realtime 無効:
  - REST ポーリングを主とする
  - ただし保守的な間隔に保つ

### 強制境界

ポーリング設定は UI だけでなく、保存時・読込時にも正規化する。

これにより `chrome.storage.local` に `0` を直接書かれても、そのままでは使われない。

### `All teams` メンション

`All teams` は重いモードとして扱う。

ルール:

- デフォルトは team 単位
- `All teams` は UI で警告表示する
- `All teams` 時は実効ポーリング間隔の下限を引き上げる
- team ごとの取得も API キューを通して分散する

## データ保持とページング

複数ペインでも重くならないよう、保持量は制限する。

現在の方針:

- 初回取得件数: `20`
- `Load more` 単位: `20`
- ペインごとのメモリ保持上限: `100`

意味:

- 新着や追加取得はこの範囲内で統合する
- 上限を超えた古い投稿は落とす
- ペイン数が増えると総量は増えるため、各ペインの上限は抑える

描画方針:

- DOM を無制限に増やさない
- まずは小さな page size と軽量描画で対応する
- 上限を増やす前にレンダリングコストを優先して考える

## Manual Refresh

Manual refresh は recovery と確認用の操作として位置付ける。

ルール:

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
- Target 設定の health-check path を参照する

## スレッド表示方針

deck 上の投稿クリックでは、拡張内で thread viewer を持たず、Mattermost 本体の thread UI を開く。

ルール:

- フルリロードではなく Mattermost の SPA ルート変更を優先
- deck が Mattermost を置き換えるのではなく拡張している感覚を保つ
- RHS thread 体験そのものは Mattermost に委ねる

補足:

- 同一チャンネルならほぼその場で開く感覚に近づける
- 別チャンネルの投稿では、Mattermost 側で channel context が切り替わることがある
- フルリロードは fallback であり default ではない

## レイアウトガイドライン

### Deck 幅

- deck 幅はユーザーがドラッグで変更できる
- ドラッグした幅は保存し、再起動後も復元する
- Options の preferred rail width は初期値として使う
- 明示的にドラッグされた幅を上書きしない
- Mattermost 本体が使えなくならないように clamp する

### Drawer

- drawer の開閉状態は保存する
- 閉じても細い handle は見える
- 閉じると Mattermost 側へ幅を返す
- drawer 面は監視 UI を主とし、設定 UI を持ち込みすぎない

### カラム

- カラム幅は固定寄りとする
- 横スクロールで並ぶ
- 現在の Mattermost チャンネルと独立して動く
- 並び順は保存する
- preferred column width は基準幅として使う

## カラム設計

### Mentions

- 既定は team 単位
- `All teams` は許可するが負荷制御を強める
- unread mention count を表示する
- 投稿元の context を出す
  - channel / team
  - DM / Group DM

### Channel Watch

- team と channel に紐付く
- そのチャンネルの recent posts を表示する
- `posted` event が一致した時だけローカル追記する

### DM / Group

- team 選択には依存しない
- 候補は DM と Group DM を含める
- raw channel id ではなく、人間が読めるユーザー名表示へ解決する

### 設定領域

- 上部設定ブロックは折りたたみ可能にする
- 長く見るコンテンツが画面の大半を使うべき
- move / close / refresh などの二次操作は折りたたみ内に置ける

## UX 原則

### システム状態の可視化

少なくとも次は明確に見えるべき:

- healthy / degraded / error
- realtime / polling
- session expired
- loading / empty / failed
- 各ペインが何に固定されているか
- Polling 時に設定画面を開く導線

### 驚きを減らす

- 新規ペインは最小限の明確なセットアップにする
- `All teams` のような高負荷モードは明示する
- selector が無効な時は理由が分かるようにする
- 折りたたみ領域は重要状態を隠しすぎない

### 設定の優先順位

設定の優先順位は分かりやすくする。

現在のルール:

- 現在のドラッグ済み rail 幅が preferred rail width より優先
- preferred rail width は初回やリセット相当時の default
- preferred column width はカラムの基準幅
- theme の既定値は `Mattermost`
- ユーザーが保存した値は static default より優先

### Mattermost の挙動を保つ

- Mattermost 本体の通常操作を邪魔しない
- 投稿動作を横取りしない
- route 変更時も UI を壊さず追従する
- スレッド表示は Mattermost 本体の SPA flow を優先する

## README スクリーンショット運用

README 用のスクリーンショットもプロダクト面の一部として扱う。

方針:

- clean なテスト環境を使う
- 私的またはノイズの多い内容を混ぜない
- capture 前に showcase 用メッセージを整える
- Mattermost 本体と deck の両方が見える構図にする
- テーマ別画像は単なるテスト副産物ではなく presentation asset と考える

テーマ変更などで見た目を厳密に合わせたい場合、手動キャプチャを許容する。

## 既知リスク

### セッション切れ

- session cookie が切れると REST は失敗する
- silent failure にせず UI へ出すべき

### Mattermost DOM 変更

- `#root` など安定した root には依存している
- CSS オフセットは Mattermost バージョン差異で調整が要る可能性がある

### WebSocket の差異

- Mattermost WebSocket payload は変わりうる
- realtime は加点要素として扱い、REST fallback を正本にする

### クライアント側秘密情報保存

- PAT 暗号化は storage hygiene の改善であり、OS secret store の代替ではない
- さらに強い保護が必要なら、将来は native secret store 連携が必要

## ライセンスと公開

- ライセンス: MIT
- 公開方針: 軽量で permissive、無保証
- `README` と `LICENSE` の記載は常に整合しているべき

## 直近優先事項

1. sync 状態を信用できる表示に保つ
2. ペイン追加が増えても request scheduling を保守的に保つ
3. DM / Group DM ラベルを人間が読める形に保つ
4. ペイン種類追加で request fan-out を悪化させない
5. 機能量より安定性と明示性を優先する

## 判断基準

機能と安定性が衝突したら、次を優先する。

- request 数を減らす
- burst を直列化する
- WebSocket 接続数を増やさない
- DOM 依存を減らす
- 状態表示を明示する
- Mattermost ネイティブ挙動を再利用する

この拡張は「Mattermost の慎重な拡張」であるべきで、「隣に埋め込まれた別チャットクライアント」ではない。
