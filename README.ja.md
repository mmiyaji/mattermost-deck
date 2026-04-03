# Mattermost Deck

[English README](./README.md)

Mattermost の Web 画面に TweetDeck 風の右ペインを追加する Chrome 拡張です。Mattermost 本体のチーム切り替えやチャンネル操作はそのまま使い、補助的なマルチペインだけを拡張側で描画します。

## スクリーンショット

ライトテーマ:

![Mattermost Deck overview](./docs/assets/readme-overview.png)

ダークテーマ:

![Mattermost Deck overview dark](./docs/assets/readme-overview-dark.png)

## 主な機能

- Mattermost 本体を主 UI のまま利用
- 既存画面の右側にリサイズ可能な補助ペインを追加
- メンション、監視チャンネル、DM / Group DM のカラムを表示
- REST はログイン済みブラウザセッションを再利用
- 任意で PAT を設定するとリアルタイム更新を利用可能
- レイアウト、ドロワー幅、カラム幅、表示設定を保存
- ペイン上の投稿から Mattermost のスレッド UI を開ける

## 動作方針

- Mattermost 本体はそのまま使う
- 拡張は Shadow DOM 上の右ペインだけを描画する
- データ取得は Mattermost REST API と任意の WebSocket を使う
- 描画前に設定済みの対象 URL とヘルスチェック API を確認する

## セットアップ

```powershell
npm install
npm run build
```

`dist/` を Chrome の「パッケージ化されていない拡張機能」として読み込んでください。

初回インストール時は Options ページが開き、以下を設定できます。

- Mattermost Server URL
- 任意の team slug 制限
- リアルタイム用の任意 PAT
- ポーリング間隔や見た目の設定

## 開発

```powershell
npm run check
npm run build
npm run test:e2e
```

README 用スクリーンショットの生成:

```powershell
npm run capture:readme
```

スクリーンショット生成には、接続可能な Mattermost テスト環境と有効なテスト用認証情報が必要です。

## リリース

`v0.1.0` のような `v` 形式タグを push すると GitHub Actions でリリース用ビルドを実行します。

- `npm ci`, `npm run check`, `npm run build` を実行
- `dist/` を `mattermost-deck-<tag>.zip` に圧縮
- GitHub Release を作成し、zip を asset として添付

## セキュリティ

- PAT はローカルにクライアント側暗号化して保存します
- 平文保存よりは安全ですが、完全な秘匿境界ではありません
- クライアント自身が復号できるため、可能であれば権限を絞ったトークンを使ってください

## ライセンス

MIT ライセンスです。詳細は [LICENSE](./LICENSE) を参照してください。

## 現在のスコープ

- content script による右ペイン注入
- Mattermost 側の表示幅を調整しつつドロワーを表示
- メンション、監視チャンネル、DM / Group DM を Shadow DOM 上に描画
- 現在セッションでの REST 利用と、任意 PAT による WebSocket リアルタイム更新
- Options ベースの対象判定、ヘルスチェック、パッケージング

## 設計メモ

- 詳細設計: [docs/design-guidelines.md](./docs/design-guidelines.md)
