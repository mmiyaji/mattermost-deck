# Chrome Web Store 申請文

Chrome Web Store の「プライバシーへの取り組み」タブで使用する説明文です。

公開ページ: [Mattermost Deck](https://chromewebstore.google.com/detail/mattermost-deck/imbnblgiedelpebcfkenbhomcibomdpi)

- サポートURL: https://github.com/mmiyaji/mattermost-deck/issues
- プライバシーポリシーURL: https://github.com/mmiyaji/mattermost-deck/blob/main/PRIVACY.md
- ストア用スクリーンショット（1280 x 800）: `docs/assets/readme-overview-dark-store.png`

## 詳細説明

Mattermost Deck は、Mattermost Web の右側に監視向けマルチペインを追加する Chrome 拡張です。メンション、チャンネル、ダイレクトメッセージ、キーワード、検索結果、保存済み投稿を並べて確認できます。ログイン、投稿、編集、チーム移動、スレッド表示などの主要操作は Mattermost 本体を使用します。

## v0.2.6 リリースノート

- ブラウザー別のPWA手動インストール手順を5言語で表示
- リモートMattermostサーバーをHTTPS必須とし、ループバック開発環境ではHTTPを引き続きサポート
- 狭いウィンドウでMattermostの表示領域を優先し、再拡大時にDeck幅を復元
- 設定画面のアップデートバナーと狭幅レイアウトを修正
- Mattermost Site URLのサブパス、プロファイル同期、WebSocket再接続を改善
- APIエラー表示とキーボード操作を多言語化・改善
- Docker E2E、CI、依存関係とストアビルドの安全確認を強化

## 単一用途

Mattermost Web にマルチペインの閲覧・検索ワークスペースを追加し、メンション、チャンネル、ダイレクトメッセージ、検索結果、保存済み投稿を一つの画面で確認できるようにします。

## 権限の正当性

### alarms

PWAインストールを開始する際に一時登録する補助スクリプトを、タブが正常に完了しなかった場合でも一定時間後に確実に解除するために使用します。このアラームは一時リソースの後始末だけに使用し、ユーザーデータの収集、追跡、定期送信には使用しません。

### storage

ユーザーが設定したMattermostサーバーURL、表示設定、ペイン構成、既読状態、および任意の認証設定をブラウザー内に保存するために使用します。データを開発者のサーバーへ送信するためには使用しません。

### scripting

ユーザーが明示的に設定し、ホスト権限を許可したMattermostサイトへDeck UIを挿入するために使用します。また、PWAインストール操作時の一時的な補助処理にも使用します。

### tabs

設定済みMattermostタブの検出・更新、投稿リンクを新しいタブで開く処理、およびPWAインストール用タブの作成と後始末に使用します。

### windows

Mattermostの投稿またはスレッドをユーザー操作に応じて別ウィンドウで開く機能に使用します。

### ホスト権限

ユーザーが設定画面で指定し、Chromeの確認画面で明示的に許可したMattermostサーバーだけでAPI通信とDeck UIの表示を行うために使用します。拡張機能は未設定のサイトでは動作しません。

## データ利用

Mattermostのコンテンツは機能提供のためブラウザー内で処理され、設定済みMattermostサーバー以外へ送信されません。広告、分析、プロファイリング、第三者への販売には使用しません。詳細は https://github.com/mmiyaji/mattermost-deck/blob/main/PRIVACY.md を参照してください。

## データ利用申告の確認表

| データ種別 | 用途 | 取扱い |
| --- | --- | --- |
| 認証情報 | 任意設定のMattermost PATによるWebSocket接続 | 既定はセッション保存。永続保存は明示的な選択時のみクライアント側で暗号化し、開発者サーバーへ送信しない |
| 個人的な通信 | Mattermostの投稿、DM、メンションの表示 | ブラウザー内で処理し、設定済みMattermostサーバーとの通信にのみ使用 |
| ウェブサイトのコンテンツ | チャンネル、投稿、検索結果、保存済み投稿の表示 | ユーザーが許可したMattermost originだけで取得・表示 |
| ユーザー操作 | 表示設定、ペイン構成、既読状態 | Chrome拡張ストレージへローカル保存 |

広告、分析、プロファイリング、信用判断、第三者への販売・提供には使用しません。
