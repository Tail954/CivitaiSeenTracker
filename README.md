# Civitai Seen Tracker

Civitaiのモデル一覧画面で、過去に見たことのあるモデルをグレーアウトし、閲覧済みであることをわかりやすくするTampermonkey用ユーザースクリプトです。

## インストール
1. お使いのブラウザに [Tampermonkey](https://www.tampermonkey.net/) などのユーザースクリプトマネージャーをインストールします。
2. `civitai-seen-tracker.user.js` をTampermonkeyに追加します。

## 概要
- スクロールして画面外に出たモデルを「閲覧済み」として記録します。
- 閲覧済みのモデルは透明度が下がり、白黒（グレースケール）になります。
- マウスオーバーすると元の表示に戻ります。
