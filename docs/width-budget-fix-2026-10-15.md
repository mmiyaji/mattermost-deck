# Deck幅予算修正の実機確認（2026-10-15）

## 結果

幅1024pxで発生していた、閉じたネイティブRHSとDeck間の幅予算ずれを修正ビルドで再検証した。Mattermost 9.5.11の同seedモンキーテストは120/120アクションで完了し、step 22/23の内側overflowは両方0px。Composer右端の実クリック、emojiボタンの実クリックとEscapeによる閉じ、Sendボタン中心のヒットテストが両stepで通った。右端がDeckに覆われる状態は再現しなかった。

修正対象の変更はcommit `e4035cd`。最終検証に使った固定dist hashは `9DBBC654884C1C31EE61CD6DD93A58EC2B36B4FAD01773274C8A83EBD3AE4CCC`。9.5のbeforeは保存済みdist hash `64C025384A6AB93037B09B9B6C4214A2C00F9626E112EE9CAC20960517F9D880` を使用した。

原因は、RHSを閉じた状態でroot幅からcenter幅を引き、左右のinsetを含むMattermost chrome幅を求めていたことだった。center自身がrootをはみ出すとchrome幅を小さく見積もり、Deckが広がる方向へ誤差が累積する。修正ではcenterの左右insetの合計からchromeを測り、実overflowで観測したcenter幅は安全下限として保持する。viewportが変わったら下限を再学習し、root/centerのResizeObserver変化は次frameに反映、安定したchrome基準はsettled計測で更新する。

## 9.5.11 同seed before/after

| 実行 | 入力・判定 | step 22（temporary-add） | step 23（mention-scope） | 実クリック・到達性 |
|---|---|---|---|---|
| before | seed `20261015`、先頭24件、記録専用（assert無効） | viewport 1024、center 385px、Deck 383px、overflow 49px | viewport 1024、center 385px、Deck 432px、overflow 75px | Composer右端は両方focus不可。emoji click/closeは両方成功。Send中心はstep22到達可、step23はDeckに遮られた。 |
| after | 同seed・同24件、assert有効 | viewport 1024、center x305–690（385px）、Deck x690–1024（334px）、overflow 0px | 同じ geometry、overflow 0px | Composer右端focus、emoji click/close、Send中心hit-testが両方成功。Deckの覆いなし。 |
| after | 同seed、フル120件、assert有効 | step 22/23ともoverflow 0px | step 22/23ともoverflow 0px | 同じ到達性チェックがすべて成功。アクション・response・request・runtime・ChaosCrawlerの失敗0、layout warning 0。 |

beforeのstep 22ではroot幅641px、center x305–690（幅385px）、Deck幅383pxだった。step 23ではroot幅592px、center x282–667（幅385px）、Deck幅432pxだった。修正後はroot幅690px、Deck幅334pxで境界が一致した。beforeの24件は両stepを記録するため `UI_MONKEY_LAYOUT_RECORD_ONLY=1` を使用しており、PASS表記は記録ジョブの終了状態であってUI assertionの合格を意味しない。afterは通常assertモード。

以前の別実行でstep 23のoverflow 98pxを観測しているが、今回のbefore比較はクリック到達性を含む同一ハーネスの24件で75pxだった。98pxは別実行の参考値として保管し、この比較のbefore値には使わない。

中間ビルド `C5F312A65967561F9D3F9D362A47D3A6E9945F67087A31DAF6FBCE4846C4C17D` ではフル120件を実行できたが、step 22でoverflow 49pxとComposer右端のfocus失敗が残り、Playwright assertionはFAILした。step 23ではoverflow 0pxに戻った。追加修正後の最終ビルド `9DBBC...` では先頭24件とフル120件の双方で再確認した。中間ビルドの失敗を最終PASSに含めていない。

## 11.11.1互換性試験

Mattermost 11.11.1（8069）、seed `20261015`、先頭24件。step 22/23はviewport1024、overflow 0px、root幅760px、center x330–715（385px）、Deck x760–1024（264px）。Composer右端focus、emoji click/close、Send中心hit-testがすべて成功し、アクション・request・runtime failureは0件だった。

Playwright全体の結果はHTTP判定によりFAIL。AIプラグイン由来の `GET /api/v4/users/username/ai` 404が3件、`GET /plugins/mattermost-ai/ai_bots` 401が2件あり、除外ルールを追加せず未分類失敗として保持した。したがってこれは幅修正のUI到達性失敗ではなく、HTTP環境応答を含む試験全体は合格していない。

## ネイティブRHSは別の残課題

Mattermost 11.7.12でRHSを実際にドラッグした4 viewportの監査では、Deck境界gapは全て0pxだった。一方、RHS最大時の中央領域との重なりは1000pxで136px（RHS最小時40px）、1200pxで81px（最小時0px）、1440pxと1920pxで0pxだった。これはRHSを閉じたときのDeck幅予算修正とは別の、RHS表示中の狭幅レイアウト課題である。拡張なし条件との比較は行っていないため、重なりの原因を拡張単独とは断定しない。

## メモリ計測の扱い

修正後9.5フル120件の短時間計測はheap −2.44MiB、node −303、Document 0、listener +186で、各threshold内だった。これはリークがない証明ではない。

別ビルド・以前の長時間計測では、9.5 control 10分はPASS（heap +5.40MiB、listener傾き0/分、node −41）。隔離Deck 10分もPASSだったが、heap +9.84MiB（約+1MiB/分）、listener +0.32/分、node +3.09/分の小さい正傾向があった。サンプル期間中Deck railは52pxにcollapsedでDeck本文は非表示だったため、9.5で可視Deck状態の長期保持を検証していない。同時実行した先行Deck試験はlistener傾き+121/分で失敗（152,920→156,615、+3,695）。controlや隔離試験のPASSでこの失敗を取り消さず、開始時キャッシュの影響可能性も残す。別途、Mattermost 11.7.12で可視Deckの10分soakはPASSしたが、幅修正後の長時間soakではない。

## 検証範囲・未完了

- 実施済み：`npm test` 426件、build、type/source checkはPASS。修正後9.5フル120件もPASS。
- responsive railテストは安全幅の仕様に合わせて検査を更新し、2件PASS。`npm run check`もPASSした。requested width 900pxは保存され、1440pxでは安全幅にclamp、1000pxでもcenter可視幅336px以上・root/Deck overflow 2px以下・Send到達可能を確認し、1440pxでclamp値を維持、1800pxで900pxへ復帰した。
- 初回の追加focus判定はnative composerのpreview modeで非表示textareaを対象にしていたためfalse positiveだった。最終の幅復元テストからこの不適切な検査を除去し、実DOMの可視幅・遮蔽・Send到達性を検証した。モンキーテストのComposer右端実クリック検査は独立して維持している。
- 11.7.12のネイティブRHS監査は連続性（root 1、document request 0）を確認した。幅修正後のDeck可視状態の長時間メモリsoakは未実施。
- 認証情報・state JSON・未加工request URLは報告と要約JSONに含めていない。raw run artifactは `.tmp-review/width-budget-fix-20261015/` にあり、commit対象外。

## 再利用用データ

比較条件、各runの要約、クリック到達性、RHS geometry、artifact pathは[width-budget-fix-2026-10-15.json](width-budget-fix-2026-10-15.json)にまとめた。
