# Chrome Web Store 申請文

Chrome Web Store の「プライバシーへの取り組み」タブで使用する説明文です。

公開ページ: [Mattermost Deck](https://chromewebstore.google.com/detail/mattermost-deck/imbnblgiedelpebcfkenbhomcibomdpi)

- 公式サイト: https://mattermost-deck.ruhenheim.org/
- サポートURL: https://github.com/mmiyaji/mattermost-deck/issues
- プライバシーポリシーURL: https://mattermost-deck.ruhenheim.org/privacy/
- ストア用スクリーンショット（1280 x 800）: `docs/assets/readme-overview-dark-store.png`

## 詳細説明

Mattermost Deck は、Mattermost Web の右側に監視向けマルチペインを追加する Chrome 拡張です。メンション、チャンネル、ダイレクトメッセージ、キーワード強調付きの検索結果、保存済み投稿を並べて確認できます。ログイン、投稿、編集、チーム移動、スレッド表示などの主要操作は Mattermost 本体を使用します。

## 言語別の詳細説明

拡張機能名とタイトル下の簡易説明は、アップロードしたパッケージの
`src/_locales/<locale>/messages.json` から取得されるため、コンソールへの入力は不要です。
以下の詳細説明は言語ごとの手入力が必要で、そのロケールを含むパッケージをアップロードした後に
Store listing タブへ貼り付けます。

### ロシア語 (ru)

Mattermost Deck добавляет панели для мониторинга справа от Mattermost Web. Упоминания, каналы, личные сообщения, результаты поиска с подсветкой ключевых слов и сохранённые сообщения можно расположить рядом друг с другом. Основным интерфейсом для входа, отправки и редактирования сообщений, перехода между командами и просмотра обсуждений остаётся сам Mattermost.

### ウクライナ語 (uk)

Mattermost Deck додає панелі для стеження праворуч від Mattermost Web. Згадування, канали, особисті повідомлення, результати пошуку з підсвічуванням ключових слів і збережені дописи можна розташувати поруч. Основним інтерфейсом для входу, надсилання та редагування дописів, переходу між командами й перегляду обговорень залишається сам Mattermost.

### スペイン語 (es)

Mattermost Deck añade paneles de seguimiento a la derecha de Mattermost Web. Puedes colocar en paralelo menciones, canales, mensajes directos, resultados de búsqueda con palabras clave resaltadas y publicaciones guardadas. Mattermost sigue siendo la interfaz principal para iniciar sesión, publicar, editar, cambiar de equipo y ver hilos.

### 韓国語 (ko)

Mattermost Deck은 Mattermost Web 오른쪽에 모니터링용 패널을 추가합니다. 멘션, 채널, 다이렉트 메시지, 키워드가 강조된 검색 결과, 저장한 게시물을 나란히 배치할 수 있습니다. 로그인, 게시, 편집, 팀 이동, 스레드 보기 등 주요 작업은 계속 Mattermost 본체에서 이루어집니다.

## v1.0.6 リリースノート

- Deck、設定画面、ポップアップ、インストール案内、拡張機能パッケージの説明文にロシア語・ウクライナ語・スペイン語・韓国語を追加
- 各言語が必要とする CLDR の複数形をすべてロケールファイルに保持するようにし、ロシア語・ウクライナ語の件数表示が英語へフォールバックしないように修正

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

### ホスト権限

ユーザーが設定画面で指定し、Chromeの確認画面で明示的に許可したMattermostサーバーだけでAPI通信とDeck UIの表示を行うために使用します。拡張機能は未設定のサイトでは動作しません。

## データ利用

Mattermostのコンテンツは機能提供のためブラウザー内で処理され、設定済みMattermostサーバー以外へ送信されません。広告、分析、プロファイリング、第三者への販売には使用しません。詳細は https://mattermost-deck.ruhenheim.org/privacy/ を参照してください。

## データ利用申告の確認表

| データ種別 | 用途 | 取扱い |
| --- | --- | --- |
| 個人を特定できる情報 | Mattermostの投稿者とダイレクトメッセージ参加者の表示 | ユーザーID、ユーザー名、表示名、アバターをブラウザー内および設定済みMattermostサーバーとの通信でのみ処理 |
| 認証情報 | 任意設定のMattermost PATによるWebSocket接続 | 既定はセッション保存。永続保存は明示的な選択時のみクライアント側で暗号化し、開発者サーバーへ送信しない |
| 個人的な通信 | Mattermostの投稿、DM、メンションの表示 | ブラウザー内で処理し、設定済みMattermostサーバーとの通信にのみ使用 |
| ウェブサイトのコンテンツ | チャンネル、投稿、検索結果、保存済み投稿の表示 | ユーザーが許可したMattermost originだけで取得・表示 |
| ユーザー操作 | 表示設定、ペイン構成、既読状態 | Chrome拡張ストレージへローカル保存 |

広告、分析、プロファイリング、信用判断、第三者への販売・提供には使用しません。
