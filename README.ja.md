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

## 主な機能

- Mattermost のスレッドペイン表示中は自動的に幅を縮小または折り畳み、狭いウィンドウでもメイン表示領域を優先し、終了後に指定幅とスクロール位置へ戻る右側 Deck レイアウト
- ペイン種別:
  - `mentions`
  - `channelWatch`
  - `dmWatch`
  - `keywordWatch`（旧レイアウトimportとの互換用。新しいキーワード監視はsearchペインと強調表示を使用）
  - `search`
  - `saved`
  - `diagnostics`
- Views メニューからの保存済みペインセット
- JSON によるレイアウト export / import
- Mattermost PAT を使った任意のリアルタイム更新
- カスタムメンションキー、グループ／特別メンション、CRT／非CRTのスレッド、DM／GMを含む、チーム・参加チャンネル横断のMattermost準拠メンション収集
- 同じサーバー向けに設定を切り替えられる任意のプロファイル機能
- Mattermost 連動テーマ、任意のペイン識別カラー、幅設定、`時刻 投稿者: 本文` 形式の高密度表示に切り替えるコンパクトモード
- 投稿本文内の URL 検出と長い文字列の省略表示
- 長いペインでの「最新へ戻る」フローティングボタン
- 返信投稿の識別表示と、スレッド内にしかない返信でも開きやすい返信対応ナビゲーション
- 日常監視向けの軽量な同期ヒントを出す Diagnostics と、API 集計や最近のトレース、JSONL 書き出しを備えた Performance タブ
- 日本語、英語、ドイツ語、中国語簡体字、フランス語の UI
- Chrome 拡張パッケージ名と説明文の多言語化
- 設定画面から公式サイト、プライバシーポリシー、利用規約、サポート、Chrome ウェブストアへ移動できるリンク

## 動作概要

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
- Docker E2E により Mattermost 9.5.4 と 9.5.11 を検証済み（CI の既定は 9.5.4）

より新しい Mattermost も動作対象ですが、すべてのサーバーバージョンを CI で検証しているわけではありません。その他のChromiumベースブラウザーはリリースゲートの対象外です。業務上重要な環境へ導入する前に、ステージング環境で確認してください。

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
- 自動保持ポリシー:
  - トレース記録を OFF にすると保存ログはクリア
  - 24 時間を超えたログは自動削除

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
npm run mm95:start
node scripts/mm95-start.mjs --version 9.5.11
npm run mm95:stop
npm run open:mattermost
npm run capture:readme
```

`mm95:start` は既定で Mattermost 9.5.4 を起動します。9.5.11 を起動する場合は、上記のバージョン指定コマンドを使用してください。`test:e2e` とスクリーンショット更新には、到達可能な Mattermost テスト環境が必要です。

## リリース

`v1.0.0` のような `v` 形式タグを push すると GitHub Actions が動作します。パッケージ、manifest、アプリ内表示、公式サイト、CHANGELOGの版番号とタグが一致しない場合、リリースジョブは停止します。

- 型チェック、単体テスト、Docker版Mattermostを使うPlaywright E2E、`STORE_BUILD=true`を指定したChrome Web Store用ビルドを実行
- `dist/` を `mattermost-deck-<tag>.zip` として生成
- GitHub Release を作成し、zip を asset として添付

PowerShellでローカルのリリースパッケージを作成する場合:

```powershell
npm ci
npm run check
npm test
npm run build
npm run mm95:start
try { npm run test:e2e } finally { npm run mm95:stop }
$env:STORE_BUILD = "true"
$env:EXT_VERSION = "v1.0.0"
npm run build
npm run check:store
Compress-Archive -Path dist\* -DestinationPath mattermost-deck-v1.0.0.zip -Force
```

ZIP直下に `manifest.json` が配置されていることを確認してください。Web Store用ビルドではlocalhost専用の静的content scriptを意図的に除外し、E2Eテスト用の通常ビルドでは残します。

Chrome Web Storeへアップロードする前に、`dist/` をChromeへ「パッケージ化されていない拡張機能」として読み込み、テスト用Mattermost URLを保存し、Chrome標準のホスト権限確認を承認して、設定したoriginだけでDeckが表示されることを確認してください。このブラウザ標準ダイアログは実ユーザーの判断を必要とするため手動リリースチェックとし、CIでは未許可状態で安全に起動すること、通常ビルドのE2Eでは注入後のUI動作を検証します。

Chrome Web Storeの「プライバシーへの取り組み」に入力する単一用途と権限の説明は、[Chrome Web Store申請文](./docs/chrome-web-store-submission.ja.md)を参照してください。

## ライセンス

MIT。詳細は [LICENSE](./LICENSE) を参照してください。

## 翻訳の追加

UI の locale ファイルは `src/ui/locales/` にあります。拡張パッケージの locale ファイルは `src/_locales/` にあります。

UI 言語を追加する手順:

1. `src/ui/locales/en.json` を `ko.json` などへコピーする
2. `src/ui/i18n.ts` に登録する
3. `src/ui/settings.ts` の `DeckLanguage` と `normaliseLanguage` に追加する
4. `src/options/index.tsx` の言語選択肢に追加する

拡張パッケージの名前や説明文も多言語化する場合は、対応する `src/_locales/<locale>/messages.json` を追加してください。

## 設計メモ

- 英語版設計ガイド: [./docs/design-guidelines.md](./docs/design-guidelines.md)
- 日本語版設計ガイド: [./docs/design-guidelines.ja.md](./docs/design-guidelines.ja.md)
