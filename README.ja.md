# Mattermost Deck

[English README](./README.md)

Mattermost Deck は、Mattermost Web の右側に TweetDeck 風のマルチペイン領域を追加する Chrome 拡張機能です。Mattermost 本体の UI はそのまま主 UI として使い、監視や横断確認に向いた補助ワークスペースだけを追加します。

## スクリーンショット

ライトテーマ:

![Mattermost Deck overview](./docs/assets/readme-overview.png)

ダークテーマ:

![Mattermost Deck overview dark](./docs/assets/readme-overview-dark.png)

## 主な機能

- ログイン、ナビゲーション、投稿、編集、スレッド表示は Mattermost 本体を利用
- 右側にサイズ変更可能なマルチペイン領域を追加
- 横スクロールする複数ペインを表示
- 次のペイン種別をサポート
  - Mentions
  - Channel Watch
  - DM / Group
  - Search
  - Saved
  - Diagnostics
- Views メニューから保存済みペインセットの切り替えが可能
- ペインの並び替えをペイン内操作と Views メニューの両方で実行可能
- レイアウトを JSON ファイルとしてエクスポート / インポート可能
- Mattermost の PAT を使った任意のリアルタイム更新をサポート
- Mattermost 側のテーマ変数に合わせて色を自動調整
- ペイン識別色、コンパクト表示、フォント倍率、基準ペイン幅などを設定可能

## 動作方針

- チーム切り替え、チャンネル切り替え、投稿、スレッド UI は Mattermost 本体を正とします。
- 拡張機能は Shadow DOM 上に右レールを描画し、そのための横幅を Mattermost 側から確保します。
- REST API は現在のブラウザセッションを再利用します。
- 任意の WebSocket realtime モードは Options で設定した PAT を使います。
- 描画は、設定済み Mattermost origin、許可ルート、任意の team slug、health-check API の結果でガードされます。

## セットアップ

```powershell
npm install
npm run build
```

Chrome で `dist/` を「パッケージ化されていない拡張機能」として読み込んでください。

初回インストール時には Options ページが開きます。次を設定します。

- Mattermost server URL
- 任意の team slug 制限
- 任意の realtime 用 PAT
- polling 間隔と外観設定

Server URL を保存すると、その Mattermost origin に対する Chrome 権限を要求します。全サイトに常駐する設計ではありません。

## セキュリティ

- PAT 保存先の既定値は `chrome.storage.session`
- 永続保存は明示 opt-in
- 永続保存時の PAT はクライアント側で暗号化して保存
- ただし完全な秘密境界ではなく、平文露出を減らすための最低限の保護です
- health-check path は設定済み Mattermost origin 上の相対 `/api/v4/...` に制限
- REST API はタブ内で逐次化され、複数ペイン更新時のバーストを抑制します

## 開発

```powershell
npm run check
npm run build
npm run test:e2e
```

ローカルブラウザ起動:

```powershell
npm run open:mattermost
```

README 用スクリーンショット更新:

```powershell
npm run capture:readme
```

スクリーンショット生成には、接続可能な Mattermost テスト環境と有効な認証情報が必要です。

## リリース

`v0.1.0` のような `v` 形式タグを push すると GitHub Actions が起動します。

- `npm ci`, `npm run check`, `npm run build` を実行
- `dist/` を `mattermost-deck-<tag>.zip` として圧縮
- GitHub Release を作成して zip を asset として添付

## ライセンス

MIT。詳細は [LICENSE](./LICENSE) を参照してください。

## 設計ドキュメント

- English design guide: [./docs/design-guidelines.md](./docs/design-guidelines.md)
- 日本語設計ガイド: [./docs/design-guidelines.ja.md](./docs/design-guidelines.ja.md)
