# Mattermost Deck

[English README](./README.md)

Mattermost Deck は、Mattermost Web の右側に監視向けのマルチペインワークスペースを追加する Chrome 拡張です。ログイン、投稿、編集、チーム移動、スレッド表示などの主要操作は Mattermost 本体をそのまま使い、Deck は一覧性と監視性を高める補助 UI として動作します。

[Chrome ウェブストアから Mattermost Deck をインストール](https://chromewebstore.google.com/detail/mattermost-deck/imbnblgiedelpebcfkenbhomcibomdpi)

## 公開サイト

Mattermost Deck の紹介ページと法務ページは Cloudflare Pages で公開しています。

- 紹介ページ: https://mattermost-deck.ruhenheim.org/
- プライバシーポリシー: https://mattermost-deck.ruhenheim.org/privacy/
- 利用規約: https://mattermost-deck.ruhenheim.org/terms/

静的サイトのソースは `docs/` にあります。
`.github/workflows/cloudflare-pages.yml` はサイト変更が `main` に入ったときに検証を行い、
`mattermost-deck` という Cloudflare Pages プロジェクトへデプロイします。
継続配信には GitHub リポジトリの `CLOUDFLARE_ACCOUNT_ID` と、
Cloudflare Pages 編集権限だけを持つ `CLOUDFLARE_API_TOKEN` が必要です。

## スクリーンショット

ライトテーマ:

![Mattermost Deck overview](./docs/assets/readme-overview.png)

ダークテーマ:

![Mattermost Deck overview dark](./docs/assets/readme-overview-dark.png)

上下2段と別名タイトル:

![Two-row pane layout](./docs/assets/layout-two-rows.png)

## 主な機能

- 初回はペイン上部の「上下2段を試す」から直接切り替えられます。試した後や閉じた後は再表示せず、「ビュー」からいつでも横一列に戻せます。
- 各ペインに別名を設定できます。タイトルをダブルクリック／右クリック、またはフォーカスしてF2で編集し、空欄で保存すると元に戻ります。別名は保存セットとレイアウトの書き出しにも保持されます。
- 上下の配置数と並び順を維持します。初回の上下2段への切り替えだけ自動配分し、その後は「上下に均等配置」で明示的に整列できます。
- ペインのタイトルをドラッグして位置を入れ替えられます。上下の段をまたいで移動でき、色付きの点線枠で移動先を確認して離すと保存されます。Escでキャンセルできます。
- 上下2段では、上段と下段をそれぞれ独立して左右スクロールできます。高さ調整の境界は動きません。
- 上下2段では境界をドラッグして高さ配分を変更できます（20〜80%）。ダブルクリックまたはHomeで均等に戻り、上下キーでも調整できます。配分は保存済みセットやレイアウトの書き出しにも含まれます。
- 各ペインの右端をドラッグして幅を変更できます（260〜480px）。境界のダブルクリックまたはHomeキーで既定幅へ戻り、左右キーでも調整できます。「ビュー」で横一列／上下2段を切り替えられ、保存済みセットとレイアウトの書き出しにも幅・配置が含まれます。

- Mattermost の右ペイン（スレッド、検索結果、ピン留め投稿など）の実測幅分だけ Deck を縮小して開く前のメイン表示幅を維持し、残り幅が 280 px 未満なら 52 px へ折り畳み、終了後に指定幅とスクロール位置へ戻る右側 Deck レイアウト。明示的な手動リサイズでは Mattermost を最低 320 px 残す範囲まで Deck を拡大でき、設定値による自動幅では 720 px を確保します。
- ペイン種別:
  - `mentions`
  - `channelWatch`
  - `dmWatch`
  - `keywordWatch`（旧レイアウトimportとの互換用。新しいキーワード監視はsearchペインと強調表示を使用）
  - `search`
  - `favorites`
  - `saved`
  - `diagnostics`
- 投稿の☆から追加・解除する個人用「お気に入り」ペイン。Mattermostの保存済み投稿・共有ピン留めとは独立し、サーバーとアカウントごとに最大100件をこのブラウザーに保存します。本文キャッシュを先に表示し、ペインを開いている間は5分ごとにまとめて更新します。更新ボタンで即時確認でき、一時停止も可能です。7日を超えたキャッシュは次回読み込み時に本文を破棄し、登録自体は解除するまで保持します。
- 各投稿ペインの虫眼鏡から、読み込み済みの本文・投稿者を入力と同時に絞り込めます。検索語と一致件数を表示し、日本語変換中は一覧を維持します。×で解除、Escで検索欄を閉じます。検索条件はペインごとに独立し、検索のための追加通信や永続保存は行いません。
- Views メニューからの保存済みペインセット
- JSON によるレイアウト export / import
- Mattermost PAT を使った任意のリアルタイム更新
- カスタムメンションキー、グループ／特別メンション、CRT／非CRTのスレッド、DM／GMを含む、チーム・参加チャンネル横断のMattermost準拠メンション収集
- メンションペインから「要確認メンション」を作成し、自分宛の投稿を確認済みにするまで保持できます。通常のメンションと取得を共有し、既読操作とは独立して確認漏れを防ぎます。
- 同じサーバー向けに設定を切り替えられる任意のプロファイル機能
- Mattermost 連動テーマ、任意のペイン識別カラー、幅設定、`時刻 投稿者: 本文` 形式の高密度表示に切り替えるコンパクトモード
- 投稿本文内の URL 検出と長い文字列の省略表示
- 長いペインでの「最新へ戻る」フローティングボタン
- 返信投稿の識別表示と、スレッド内にしかない返信でも開きやすい返信対応ナビゲーション
- 日常監視向けの軽量な同期ヒントを出す Diagnostics と、API 集計や最近のトレース、JSONL 書き出しを備えた Performance タブ
- 日本語、英語、ドイツ語、中国語簡体字、フランス語、ロシア語、ウクライナ語、スペイン語、韓国語の UI
- Chrome 拡張パッケージ名と説明文の多言語化
- 設定画面から公式サイト、プライバシーポリシー、利用規約、サポート、Chrome ウェブストアへ移動できるリンク

## 要確認メンション

メンションペインの操作欄から「要確認タブを複製」を選ぶと、元のペインを残し、同じ対象チームの要確認ペインを隣に作成します。「要確認モードに変更」では、タブを追加せず、そのペインの対象チーム・名前・位置を維持して切り替えます。各ボタン右の情報ボタンで、動作の違いや確認状態の扱いを確認できます。説明は情報ボタンの再操作、Escape、説明の外側のクリックで閉じます。個人宛のほか、通常のメンション収集で対象となる `@all`・`@channel`・`@here` なども取り込みます。

各投稿の「確認済みにする」で要確認一覧から除外できます。保存直後は「確認済みにしました　取り消す」を5秒間表示し、その場で取り消せます。表示が消えた後も、操作欄の確認済み履歴から未確認に戻せます。投稿を開くことやMattermostで既読にすることでは、確認済みになりません。

要確認ペインの操作欄から「通常メンションに戻す」で切り替えを取り消せます。未確認の投稿と確認済み履歴は保持され、再び要確認モードに変更すると続きを確認できます。確認済み履歴の切り替えと取得範囲などの説明は、折りたたみ式の操作欄にまとめています。直後の取り消しは、操作欄を閉じていても利用できます。

未確認投稿と確認状態は、このブラウザーにサーバー・アカウント別で保存します。同じ投稿を表示する要確認ペイン同士で確認状態を共有し、元のメンションペインを閉じても収集を続けます。未確認投稿は通常メンションキャッシュの件数・有効期限とは別に保持します。

確認済みという判断は件数・期限で削除しません。確認済み履歴の本文は直近200件分を保持し、容量不足時は確認済みの本文を整理して保存を再試行します。整理された本文は履歴一覧には表示されませんが、同じ投稿を再取得しても未確認には戻りません。未確認投稿を整理対象にすることはありません。容量を確保できない場合は保存エラーを表示します。

初回は取得できた過去投稿も未確認として取り込みます。収集済み範囲の一覧であり、サーバー内の全履歴を取得済みとは限りません。古い投稿は追加読み込みで取り込んでください。ブラウザーの拡張データを削除すると、確認状態も削除されます。

## 動作概要

### メンションの表示除外

投稿にマウスを重ねると表示される「…」メニューから「このユーザーの投稿を表示しない」または「この会話を表示しない」を選べます。キーボードでフォーカスした場合も表示し、ホバーできないタッチ端末では常時表示します。ユーザーの除外はその人が書いた投稿に、会話の除外は親投稿と今後追加される返信を含むスレッド全体に適用します。

各メンションペインの折りたたみ操作欄にある「表示の除外」で、ユーザーの検索・追加、登録済みユーザー／会話の解除、除外した投稿の一時表示を操作できます。通常メンションと要確認メンションで除外設定を共有し、このブラウザーにサーバー・アカウント別で保存するため、再起動後も維持されます。一時表示はペインごとの表示操作で、再起動後は解除されます。

除外は表示だけに適用し、投稿の取得、Mattermost本体の通知、既読・確認済み状態には影響しません。要確認投稿を除外しても確認待ちデータは保持され、除外を解除すると未確認のまま戻ります。保存に失敗した場合は投稿を隠さず、エラーを表示します。

### 拡張の動作

- 拡張は Shadow DOM の右レールを Mattermost ページに挿入します。
- REST API は現在のブラウザセッションをそのまま使います。
- WebSocket モードは Options で PAT を設定したときだけ有効になります。
- 描画は次の条件がそろったときだけ有効です:
  - 設定した Mattermost origin と一致する
  - 許可された route kind に一致する
  - 任意の team slug 制限に一致する
  - health-check API が成功する

## セットアップ

```powershell
npm install
npm run build
```

Chrome で `dist/` を unpacked extension として読み込んでください。

初回インストール時は Options 画面が開きます。推奨順序は以下です。

1. `Connection` を開く
2. `Mattermost Server URL` を保存する
3. 必要に応じて `Team Slug`、PAT、polling、外観設定を調整する
4. `Profiles` はサーバー接続が確認できてから使う

Server URL を保存すると、その Mattermost origin に対する Chrome 権限が要求されます。拡張は設定済みの Mattermost サーバーでのみ有効になります。
リモートサーバーには HTTPS が必須です。HTTP は localhost / loopback での開発時のみ利用できます。サブパスを含む Mattermost Site URL にも対応しています。

## 対応環境

- Google Chrome 120 以降
- Docker E2E の全テストを Mattermost 9.5.4 で実行
- Pull Request とリリースごとに、Mattermost 9.5.11、10.11.22、11.8.2でも経路変更、チーム切り替え、スレッドレイアウト、レスポンシブ動作の主要テストを実行

上記以外のMattermostパッチ版とその他のChromiumベースブラウザーはリリースゲートの対象外です。業務上重要な環境へ導入する前に、ステージング環境で確認してください。

## 設定画面

### Connection

- Mattermost Server URL
- 任意の Team Slug 制限
- 有効な route kind
- Health-check API path

### Profiles

- origin ごとの任意設定セット
- 作成、名前変更、複製、切り替え、削除
- 運用やサポートなど、同じ Mattermost サーバー内で用途ごとに設定を分けたい場合向け

### Realtime

- WebSocket 更新用の Personal Access Token
- session のみ / 永続保存 の PAT 保存方式
- realtime 無効時の polling 間隔

### Appearance

- テーマ
- 言語
- フォント倍率
- レールの既定幅
- ペインの既定幅
- コンパクト表示
  - コンパクトモードではカードをやめ、`時刻 投稿者: 本文` のような 1 行ベースの高密度表示にする
  - 自分の投稿者名はテーマのアクセント色、他ユーザーはユーザーごとに固定の色を使う
  - 通常モードは従来の表示を保ち、同じ人の近接投稿だけ間隔を少し詰める
- 画像プレビュー
- ペイン識別カラー

### Behavior

- 投稿クリック時の動作
  - 返信は permalink / スレッド経路で開き、スレッド内にしかない投稿でも Mattermost 側で表示しやすくする
- ハイライトキーワード
- 高 Z-index モード
- 投稿順の反転

### Performance

- 詳細調査用のトレース記録 ON/OFF
- API endpoint summary
  - 件数
  - 平均遅延
  - P95 遅延
  - エラー率
- Recent trace
  - 実際のアクセス時刻
  - フル URL
  - ステータス
  - 応答時間
  - queue wait
- JSONL エクスポート
- Diagnostics には日常確認向けの短い同期ログを表示し、詳細なリクエスト表は Performance に寄せる
- 動作時に適用される保持ポリシー:
  - トレース記録を OFF にすると保存ログはクリア
  - 24 時間を超えたログは、次に拡張機能が動作、記録、または診断画面を開いたときに削除

## セキュリティ

- PAT 保存の既定値は `chrome.storage.session`
- 永続保存は明示的な opt-in
- 永続保存する PAT はクライアント側で暗号化して保存
- health-check path は設定済み Mattermost Site URL 配下の `/api/v4/...` に制限
- REST リクエストはタブ内で直列化し、重い fan-out 取得はバッチ化してバーストを抑制
- 一度空状態を表示した後のバックグラウンド再読込では、ローディングを点滅させず空状態表示を維持する

## 開発

```powershell
npm run build
npm run test
```

補助コマンド:

```powershell
npm run check
npm run check:release
npm run check:site
npm run test:e2e
npm run test:soak
npm run mm95:start
node scripts/mm95-start.mjs --version 11.8.2
npm run mm95:stop
npm run open:mattermost
npm run capture:readme
```

`mm95:start` は既定で Mattermost 9.5.4 を起動します。別の対応メジャー版を確認する場合は、上記のバージョン指定コマンドを使用してください。`test:e2e` とスクリーンショット更新には、到達可能な Mattermost テスト環境が必要です。
`test:soak` は、固定seedで独立した20分間のレイアウト・メモリ耐久試験を実行します。Mattermostへ384件のテスト投稿を作成し、大量の検索結果を保持したまま右ペイン種別と画面幅を切り替え、メモリを積み増さない数万回の右ペイン内部Mutationを加えます。終了後に投稿を削除し、ヒープ、DOM、イベントリスナー、User Timing、レイアウト計測の上限付き傾向レポートを `test-results/` に出力します。実行前に `MM_DECK_SOAK_MINUTES`（10〜120）または `MM_DECK_SOAK_SEED` を設定すると、時間またはseedを変更できます。`test:soak:auto-adjust-off` では自動レイアウト監視を切り分け、`test:soak:control` では拡張機能なしの同一Mattermost負荷を実行できます。

## リリース

`v1.3.2` のような `v` 形式タグを push すると GitHub Actions が動作します。パッケージ、manifest、アプリ内表示、公式サイト、CHANGELOGの版番号とタグが一致しない場合、リリースジョブは停止します。

- 型チェック、単体テスト、Mattermost 9.5.4でのPlaywright全テスト、9.5.11・10.11.22・11.8.2でのリリース互換性テストを実行
- `STORE_BUILD=true`でChrome Web Store用ZIPを生成し、そのZIPを展開した実物から未許可の初回状態と、Chrome標準の権限確認を自動承認できない場合の安全な拒否処理をスモークテスト
- `dist/` を `mattermost-deck-<tag>.zip` として生成
- SHA-256チェックサムを生成し、ZIPとチェックサムをGitHub Releaseへ添付

PowerShellでローカルのリリースパッケージを作成する場合:

```powershell
npm ci
npm run check
npm test
npm run build
npm run mm95:start
try { npm run test:e2e } finally { npm run mm95:stop }
$env:STORE_BUILD = "true"
$env:EXT_VERSION = "v1.3.2"
npm run build
npm run check:store
Compress-Archive -Path dist\* -DestinationPath mattermost-deck-v1.3.2.zip -Force
$releaseHash = (Get-FileHash mattermost-deck-v1.3.2.zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$releaseHash  mattermost-deck-v1.3.2.zip" | Set-Content mattermost-deck-v1.3.2.zip.sha256 -Encoding ascii
```

ZIP直下に `manifest.json` が配置されていることを確認してください。Web Store用ビルドではlocalhost専用の静的content scriptを意図的に除外し、E2Eテスト用の通常ビルドでは残します。

Chrome Web Storeへアップロードする前に、リリースZIPを展開した内容をChromeへ「パッケージ化されていない拡張機能」として読み込み、テスト用Mattermost URLを保存し、Chrome標準のホスト権限確認を承認して、設定したoriginだけでDeckが表示されることを確認してください。ヘッドレスのリリーススモークテストは、配布ZIP実物が未許可で開始し、権限を自動承認できない場合にも保存や注入を行わず安全に拒否することを確認します。Chrome標準ダイアログの承認と、その後のDeck注入は目視による必須の最終確認とし、許可済み注入の挙動は通常の開発用E2Eでも別途検証します。

Chrome Web Storeの「プライバシーへの取り組み」に入力する単一用途と権限の説明は、[Chrome Web Store申請文](./docs/chrome-web-store-submission.ja.md)を参照してください。

## ライセンス

MIT。詳細は [LICENSE](./LICENSE) を参照してください。

## 翻訳の追加

UI の locale ファイルは `src/ui/locales/` にあります。拡張パッケージの locale ファイルは `src/_locales/` にあります。

UI 言語を追加する手順:

1. `src/ui/locales/en.json` を `ko.json` などへコピーして翻訳する。複数形キーはその言語が CLDR で要求する形（`Intl.PluralRules(<code>).resolvedOptions().pluralCategories`）と完全に一致させる必要があり、`src/ui/locales.test.ts` で検証されます
2. `src/ui/language.ts` の `SUPPORTED_LANGUAGES` に定義を追加する。設定画面の言語セレクタとストアビルドの locale 検証はここから導出されます
3. `src/ui/i18n.ts` に resource を登録する
4. すべての locale ファイルに `options.language<Code>` のラベルを追加する
5. `src/popup/messages.ts` と `src/pwa-install/installGuide.ts` に翻訳を追加する

拡張パッケージの名前や説明文も多言語化する場合は、対応する `src/_locales/<chromeLocale>/messages.json` を追加してください。`appDescription` は 132 文字以内である必要があり、ビルド時に検証されます。

## 設計メモ

- 英語版設計ガイド: [./docs/design-guidelines.md](./docs/design-guidelines.md)
- 日本語版設計ガイド: [./docs/design-guidelines.ja.md](./docs/design-guidelines.ja.md)
