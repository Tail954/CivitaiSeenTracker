# Phase 0 回帰検証

Node.js v22.17.0、Windows/PowerShellで実施。外部依存なし。DOM・IntersectionObserver・MutationObserver・localStorage・タイマーを`harness.cjs`で模擬し、配布用スクリプト全体を`vm`で実行する。

## 再実行

```powershell
node --check civitai-seen-tracker.user.js
node --test --test-reporter=spec tests/regression.test.cjs
git diff --check
```

ユーザーが指定したGitHub v0.20（リファクタリング前）の同じ回帰項目を検証する場合:

```powershell
$env:SEEN_TRACKER_SOURCE_REF = '5ae0577c0c5cc272427aef7a7123fa54bad444bd'
try {
    node --test --test-reporter=spec tests/regression.test.cjs
} finally {
    Remove-Item Env:SEEN_TRACKER_SOURCE_REF
}
```

ベースラインは43件、基準版調整後は45件。変更後のみ、メタデータ/CSS全文のv0.20との一致、および再実行時の多重初期化防止を追加検証する。今回の結果は`results/baseline-v020.txt`と`results/aligned-v020.txt`。`results/baseline.txt`と`results/phase0.txt`は最初のv0.21基準の履歴として保存している。

## 自動検証範囲と限界

両ドメインを模したURLで、履歴読書き・進入/退出・通知等の除外・カード親要素・初回/遅延/追加走査・SPA遷移・ジャンプ開始/中断/境界/末尾/90秒制限・追加読込・取得失敗待機・スクロールコンテナ選択を検証する。オリジン別ストレージは別々の模擬ストアで確認する。

モックはブラウザのレイアウトエンジンを持たない。CSS全文一致は実際の描画確認を意味せず、Observerの通知も手動入力である。実サイトのDOM/API、無限スクロールの通信、滑らかなスクロール、ホバーの描画、Chrome/Tampermonkeyのサンドボックスは未検証。高さ停滞の最終停止分岐と最大300回停止分岐の単独到達も未試験（通常はカード数停滞または90秒で先に停止）。

## 実ブラウザで残す確認（未実施）

`.com`と`.red`のそれぞれで、既存履歴を退避したテスト用ブラウザプロファイルにて確認する。既存プロファイルの履歴削除は行わない。

1. 既存JSON配列を読めること、初回ロードで消去/全置換しないこと、再読込後も履歴が残ること。両オリジンの履歴が独立していること。
2. 未読カードが画面に入ると履歴に追加され、退出後に薄い白黒表示となること。保存済みカードは初めから薄く、ホバーで元表示へ戻ること。
3. 通知ドロワー・ダイアログ内のリンクで履歴が増えないこと。検索・ソート・タグ変更と追加読み込みのカードも追跡できること。
4. ジャンプで追加読み込みが続き、通過カードを新たに保存せず、既読境界で最後の未読へ移動して強調が消えること。途中キャンセルと末尾停止でボタンが戻ること。
5. SPAのpush/replace/戻る/進む後、`/user/`だけ既読CSSを無効化し、ジャンプボタンは`/`・`/models`系だけ表示すること。`/images`等でも既読CSSが有効であること。ボタン/スタイル/Observer/履歴フックが重複しないこと。

v0.20の既存挙動として、`/models/123`や`/models-other`もジャンプボタンの`startsWith('/models')`に該当し、非一覧ページでも画像リンクの履歴登録自体は続く。READMEの「画面外で記録」に対し実装は「進入で記録」。これらをPhase 0で仕様変更しない。
