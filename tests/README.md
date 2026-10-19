# Phase 0 回帰検証

Node.js v22.17.0、Windows/PowerShellで実施。外部依存なし。DOM・IntersectionObserver・MutationObserver・localStorage・タイマーを`harness.cjs`で模擬し、配布用スクリプト全体を`vm`で実行する。

## 再実行

```powershell
node --check civitai-seen-tracker.user.js
node --test --test-reporter=spec tests/regression.test.cjs
git diff --check
```

提供済みv0.21（リファクタリング前）の同じ回帰項目を検証する場合:

```powershell
$env:SEEN_TRACKER_SOURCE_REF = '9e7072364a9f64ccc17869eb4a02b5bfa05d9007'
try {
    node --test --test-reporter=spec tests/regression.test.cjs
} finally {
    Remove-Item Env:SEEN_TRACKER_SOURCE_REF
}
```

ベースラインは43件、変更後は45件。変更後のみ、メタデータ/CSS全文のベースラインとの一致、および再実行時の多重初期化防止を追加検証する。結果は`results/baseline.txt`と`results/phase0.txt`。

## 自動検証範囲と限界

両ドメインを模したURLで、履歴読書き・進入/退出・通知等の除外・カード親要素・初回/遅延/追加走査・SPA遷移・ジャンプ開始/中断/境界/末尾/90秒制限・追加読込・取得失敗待機・スクロールコンテナ選択を検証する。オリジン別ストレージは別々の模擬ストアで確認する。

モックはブラウザのレイアウトエンジンを持たない。CSS全文一致は実際の描画確認を意味せず、Observerの通知も手動入力である。実サイトのDOM/API、無限スクロールの通信、滑らかなスクロール、ホバーの描画、Chrome/Tampermonkeyのサンドボックスは未検証。高さ停滞の最終停止分岐と最大300回停止分岐の単独到達も未試験（通常はカード数停滞または90秒で先に停止）。

## 実ブラウザで残す確認（未実施）

`.com`と`.red`のそれぞれで、既存履歴を退避したテスト用ブラウザプロファイルにて確認する。既存プロファイルの履歴削除は行わない。

1. 既存JSON配列を読めること、初回ロードで消去/全置換しないこと、再読込後も履歴が残ること。両オリジンの履歴が独立していること。
2. 未読カードが画面に入ると履歴に追加され、退出後に薄い白黒表示となること。保存済みカードは初めから薄く、ホバーで元表示へ戻ること。
3. 通知ドロワー・ダイアログ内のリンクで履歴が増えないこと。検索・ソート・タグ変更と追加読み込みのカードも追跡できること。
4. ジャンプで追加読み込みが続き、通過カードを新たに保存せず、既読境界で最後の未読へ移動して強調が消えること。途中キャンセルと末尾停止でボタンが戻ること。
5. SPAのpush/replace/戻る/進む後、`/`・`/models`系の既存表示制御が維持されること。他ページで表示効果が増えないこと。ボタン/スタイル/Observer/履歴フックが重複しないこと。

既存挙動として、`/models/123`や`/models-other`も`startsWith('/models')`に該当し、非一覧ページでも画像リンクの履歴登録自体は続く。READMEの「画面外で記録」に対し実装は「進入で記録」。これらをPhase 0で仕様変更しない。
