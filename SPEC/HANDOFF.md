# 逐次引き継ぎメモ（エージェント間で共有）

> このファイルだけを短い最新状態として保つ。会話履歴全文・長いログは転載せず、必要ならリポジトリ内のログファイルへの相対パスを記載する。

## 現在
- 担当: Sol-A（Phase 0完了、Astra-Aレビュー待ちで停止。2026-10-19 JST）
- Phase 0コミット: `8bb0e58ceaaafd70940b122a72ad12701beafa5a`
- Astra-Aゲート: 未実施・承認待ち。Sol-Aの自動テスト成功はゲート承認を意味しない。
- Luna実装: 未開始
- Sol-B統合: 未開始
- Astra-Bゲート: 未実施

## ベースライン
- リポジトリ/コミットID: Tail954/CivitaiSeenTracker、開始時HEAD `5ae0577c0c5cc272427aef7a7123fa54bad444bd`。開始時の未コミットv0.21変更（CSSのページ制御・URL判定）と未追跡SPECを提供済み入力として別コミット `9e7072364a9f64ccc17869eb4a02b5bfa05d9007` に保存し、これを回帰基準に使用。
- 既存動作/ストレージ調査: 相対`/models/`リンクの画像カードを監視。画面進入でID文字列をSetへ登録してJSON配列をlocalStorage `civitai_seen_models` に保存、退出で既読クラスを付与。保存済みカードは初回検出時にクラス付与。ジャンプ中の進入は保存しない。保存はオリジン別で`.com`/`.red`間の共有なし。起動時の全消去なし。
- 表示/既存の注意点: v0.21は`/`または`/models`で始まるパスで既読CSS・ジャンプボタンを有効化。画像カード監視/履歴登録自体は他ページでも行われる。通知・ダイアログ等は除外、ジャンプ候補はnav/header/footerも除外。これらの既存差異とREADMEの「画面外で記録」とコードの「進入で記録」の差異はPhase 0では変更しない。
- ジャンプ: 最低10枚・直近20枚の既読率80%で境界判定、最後の未読へ移動・強調。途中キャンセル、追加読込、取得失敗待機、カード数/高さ停滞、90秒/最大300回の停止条件あり。
- テスト手段と環境: Windows/PowerShell、Node.js v22.17.0（組込node:test/vmでDOM・Observer・Storage・タイマーを模擬）。実サイト/Chrome/Tampermonkeyは未検証。追加依存なし。

## Phase 0 → Astra-A
- 変更の要約: 単一配布ファイルを維持。カード/ID判定・除外セレクタを共通化し、永続化を`createSeenStore`、Observer所有/走査を`startCardTracking`、URLフックを`installPageLifecycle`、起動順序を`initialize`へ集約。CSS設置・ボタン状態・強調表示・境界判定を分離。ウィンドウ内の起動ガードで多重初期化を防止。既存履歴キー/JSON形式/保存タイミング・ページ判定・スクロール待機/停止条件を維持。日付UI・日付取得・日付フィルターは未実装。
- コミットID: `8bb0e58ceaaafd70940b122a72ad12701beafa5a`（Phase 0専用、親は上記ベースライン）。監査差分: `git diff 9e70723..8bb0e58 -- civitai-seen-tracker.user.js tests`。
- 実施テストと結果: ベースライン43/43成功、変更後45/45成功（両ドメインを模したURL、オリジン別模擬ストレージ）。既読の進入保存/退出表示・保存済み適用・データ型/順序・通知除外・親カード検出・追加/遅延走査・SPA・ジャンプ開始/中断/境界80%/最低10枚/直近20枚/重複ID/DOM離脱/末尾/90秒制限・Load More・取得失敗待機・スクロールコンテナを検証。変更後のみメタデータ/CSS全文一致と再実行時の多重初期化防止を追加検証。`node --check civitai-seen-tracker.user.js` と `git diff --check` も成功。
- 証拠/再実行: `tests/results/baseline.txt`、`tests/results/phase0.txt`。コマンドと実ブラウザ手順は `tests/README.md`。
- 未検証/懸念: 実際の両サイトDOM/API・通信を伴う無限スクロール・Observer発火/レイアウト・ホバー/滑らかな移動・Tampermonkeyのサンドボックスは未検証。CSSテストは描画確認ではない。高さ停滞/最大300回停止の各最終分岐は単独到達を未試験。既存の広い`/models`前方一致と他ページでの履歴登録は変更していないため、後続で対象範囲を変える場合は別の仕様判断が必要。
- 判定: Sol-Aの自動回帰確認は成功。Astra-AのPASS/BLOCKED/CONDITIONAL判定を依頼する段階で停止し、レビュー自体は未実施。承認前にPhase 1へ進まない。

## Astra-A → Luna
- レビュー判定: 未実施（Astra-A記入待ち）
- ブロッカー: Astra-Aゲート未承認。
- 共通I/F（カード識別・状態共有）: 現時点はIIFE内部の`getModelId(link)` / `getCardElement(link)` / `isModelCardLink(link, exclusions)`が共通識別ヘルパー。日付状態の共有I/Fは未合意・未追加。Astra-A承認後のLuna引き継ぎで合意する。

## Luna → Sol-B
- 変更の要約:
- コミットID:
- 実施テストと結果:
- 既知の制約:

## Sol-B → Astra-B
- 統合コミットID:
- 競合テスト:
- 完全非表示の検証結果:
- フォールバックの要否・理由:

## Astra-B → Sol-C
- 判定:
- 必須修正:
- 未検証項目:

## 最終納品
- コミット一覧: 提供済み入力 `9e7072364a9f64ccc17869eb4a02b5bfa05d9007`、Phase 0 `8bb0e58ceaaafd70940b122a72ad12701beafa5a`。本HANDOFFのレビュー待ち記録は後続の文書専用コミット。
- 選択した表示方式と理由:
- 実機動作確認状況: 未実施（上記モック回帰テストのみ）。
- 既知の制約: 今回はPhase 0のみ。最終納品/日付機能の受入判定は未実施。
