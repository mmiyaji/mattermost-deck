# Mattermost Deck

[English README](./README.md)

Mattermost Deck は、Mattermost Web の右側に監視向けのマルチペインワークスペースを追加する Chrome 拡張です。ログイン、投稿、編集、チーム移動、スレッド表示などの主要操作は Mattermost 本体をそのまま使い、Deck は一覧性と監視性を高める補助 UI として動作します。

## スクリーンショット

ライトテーマ:

![Mattermost Deck overview](./docs/assets/readme-overview.png)

ダークテーマ:

![Mattermost Deck overview dark](./docs/assets/readme-overview-dark.png)

## 主な機能

- 横スクロール対応の右側 Deck レイアウト
- ペイン種別:
  - `mentions`
  - `channelWatch`
  - `dmWatch`
  - `keywordWatch`
  - `search`
  - `saved`
  - `diagnostics`
- Views メニューからの保存済みペインセット
- JSON によるレイアウト export / import
- Mattermost PAT を使った任意のリアルタイム更新
- 同じサーバー向けに設定を切り替えられる任意のプロファイル機能
- Mattermost 連動テーマ、任意のペイン識別カラー、幅設定、`時刻 投稿者: 本文` 形式の高密度表示に切り替えるコンパクトモード
- 投稿本文内の URL 検出と長い文字列の省略表示
- 長いペインでの「最新へ戻る」フローティングボタン
- 返信投稿の識別表示と、スレッド内にしかない返信でも開きやすい返信対応ナビゲーション
- 日常監視向けの軽量な同期ヒントを出す Diagnostics と、API 集計や最近のトレース、JSONL 書き出しを備えた Performance タブ
- 日本語、英語、ドイツ語、中国語簡体字、フランス語の UI
- Chrome 拡張パッケージ名と説明文の多言語化

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
- health-check path は設定済み origin 配下の `/api/v4/...` に制限
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
npm run test:e2e
npm run mm95:start
npm run mm95:stop
npm run open:mattermost
npm run capture:readme
```

`test:e2e` とスクリーンショット更新には、到達可能な Mattermost テスト環境が必要です。

## リリース

`v0.2.0` のような `v` 形式タグを push すると GitHub Actions が動作します。

- `npm ci`, `npm run check`, `npm run build` を実行
- `dist/` を `mattermost-deck-<tag>.zip` として生成
- GitHub Release を作成し、zip を asset として添付

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
