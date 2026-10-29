# 六耀の決闘

数字を先に出し、その数字を見て前衛の技を1つ選んで戦うファンタジーカードバトルです。
CPU戦（ダンジョン・フリー対戦）と、プレイヤー同士のリアルタイム対戦ができます。
HTML・CSS・JavaScript だけで作られていて、オンライン機能には Firebase（無料枠で可）を使います。
画面は「夕暮れの城下町」の絵を使ったファンタジー風（ホーム・下のタブ・図鑑）。画像はビルドで HTML に埋め込むので、単一HTMLは1ファイルのまま動きます。

## 遊ぶ

| 方法 | 内容 |
| --- | --- |
| オンライン版（公開URL） | `docs/` を GitHub Pages で公開し、`docs/firebase-config.js` に Firebase の値を入れると、アカウント登録・どの端末からでも続き・離れた人との対戦ができる。手順は **SETUP-FIREBASE.md** |
| 単一HTML | `dist/rikuyou-duel.html` をブラウザで開くだけ。進行はこの端末のブラウザに保存（オフライン）。対人戦は同じブラウザの別タブ同士 |
| claude.ai | https://claude.ai/artifact/B7BfGjK8CjDYsqtB8iA1z3 （非公開・この端末に保存するモード） |
| 開発用 | `src/index.html` をブラウザで開く（ビルド不要） |

`docs/firebase-config.js` の `enabled` が `false` のままなら、公開URLでも「この端末に保存」モードで動きます。

## ゲームの内容

- **戦闘**：6体編成・前衛3体／後衛3体・リーダー1体。先攻後攻はサイコロ（大きい方が先攻、同じなら振り直し）。自分のターンは「数字を出す →（交代1回）→（固有スキル1回）→ 前衛1体の出目の技を1つ」。攻撃は敵前衛全員、回復は味方前衛全員
- **レベル**：1レベルごとに最大HP＋4%、通常技の攻撃＋1、技力の上限＋1（最大Lv30）。技の候補の7・8・9個目は Lv3・6・10 で解放。経験値はダンジョン・フリー対戦・ガチャの重複で入る
- **対戦（CPU）**：CPUチームと6対6。ランク戦10戦（勝つと次の相手が解放、初勝利で石）とフリー対戦（自分と同じ強さ）
- **ダンジョン**：6人で「1階の雑魚 → 2階の中ボス → 3階の大ボス」を1体ずつ倒す。HPと戦闘不能は次の階へ引き継ぎ（階の間に生存キャラが最大HPの20%回復）。大ボスで踏破＝石。「翠の迷い森」（推奨Lv1〜）→「霧の海底神殿」（Lv5〜）→「宵闇の塔」（Lv10〜）
- **ガチャ**：石100で1回、900で10回。全キャラ同じ確率。未所持は仲間に、所持済みは経験値300に。お金は使わない
- **ログインボーナス**：1日1回、連続日数で 50・50・80・50・50・80・200 石（7日で一巡、日本時間0時に切り替わり）
- **対人戦**：ルームを作ってコードを伝える／コードで参加／待機中のルームに参加。勝利20石・敗北5石（1日5回まで）
- **ホーム**：町の絵・チーム6体・ダンジョン／対戦／ガチャのバナー・7日分のログインボーナス。右上の歯車から遊び方・ログアウト
- **図鑑**：全キャラの技（候補9個）・固有スキル・リーダースキル。未所持のキャラも見られる
- **管理用アカウント**：全キャラを所持・すべての対戦とダンジョンを選べる・編成画面でレベルを自由に変更。オンライン版は `adminEmails` のメールアドレス（確認済み）、この端末保存モードはログイン画面の「管理用アカウントで入る」＋管理用コード（`docs/firebase-config.js` にはコードのSHA-256だけを保存）
- **はじめたとき**：石300、ランダムに6体所持

## フォルダ構成

```
rikuyou-duel/
├─ src/
│  ├─ index.html     画面の骨組み
│  ├─ style.css      デザイン
│  ├─ data.js        ★ キャラ・技・スキル・リーダースキル・属性・レベル・経済・ダンジョンの数値
│  ├─ engine.js      戦闘ロジック（画面に依存しない・すべての操作を検証）
│  ├─ cpu.js         CPU の思考
│  ├─ profile.js     成長（レベル・ガチャ・ログインボーナス・ダンジョン・対人戦報酬）
│  ├─ backend.js     保存と通信（この端末 / Firebase）・対戦ルーム
│  ├─ ui-core.js     画面の共通部品
│  ├─ ui-battle.js   戦闘画面（CPU戦・対人戦のホスト／ゲスト）
│  ├─ ui-app.js      ログイン・ホーム・チーム・図鑑・ダンジョン・ガチャ・ロビー
│  └─ img/           画像（ビルドで埋め込む）。chara/<キャラID>.webp・element/<属性ID>.webp を置くとキャラの絵・属性マークになる
├─ vendor/firebase/  Firebase SDK（Apache-2.0。CDN を使わず同じサイトから読み込む）
├─ config/firebase-config.example.js  オンライン設定の雛形
├─ firestore.rules   Firestore のセキュリティルール（Firebase コンソールに貼る）
├─ firebase.json     エミュレーター・ルール配置用の設定
├─ scripts/          build.js（生成）・online-test.js（オンラインのテスト実行）
├─ dist/             rikuyou-duel.html（単一HTML）・artifact/（claude.ai 用）
├─ docs/             GitHub Pages 用（index.html・firebase-config.js・vendor/）
├─ tests/            自動テスト
├─ README.md / HANDOFF.md / SETUP-FIREBASE.md
```

## 編集する場所

| 変えたいもの | 場所 |
| --- | --- |
| キャラ・技（9個）・固有スキル・リーダースキル | `src/data.js` の `CHARACTERS` |
| ランク（★）の境界 | `src/data.js` の `RANKS` |
| 属性の枠の色・ランクごとの濃さ | `src/style.css` の「属性ごとのカード枠」（`--el-rgb`・`--rk-*`） |
| レベルの上がり方・必要経験値・技の解放レベル・技力上限の伸び | `CONFIG.LEVEL`（`moveUnlock`・`powerPerLevel`） |
| 石の量・ガチャの値段・ログインボーナス・対人戦報酬 | `ECONOMY` |
| 対戦（ランク戦）の相手・報酬 | `CPU_MATCHES` |
| ダンジョン・ボス・階の間の回復 | `DUNGEONS`・`BOSSES`・`DUNGEON_RULES` |
| 管理用コード（この端末保存モード） | `docs/firebase-config.js` の `localAdminCodeHash`（コードの SHA-256） |
| 属性有利の倍率（1.05）・結界・回復疲労・技力の上限 | `CONFIG` |
| CPU の判断 | `src/cpu.js` の `W` |
| 管理用アカウント・Firebase の接続先 | `docs/firebase-config.js` |
| 色・レイアウト | `src/style.css` の `:root` |
| キャラの絵 | `src/img/chara/<キャラID>.webp`（例 `ryogen.webp`。縦長 約148:205、.png / .jpg / .svg も可） |
| 戦闘の背景 | `src/img/battle/<背景ID>.webp`（`forest` / `sea` / `tower` / `arena`。横長推奨） |
| ログインの背景 | `src/img/login-bg-portrait.webp`（縦画面）・`login-bg-landscape.webp`（横画面） |
| 属性マーク | `src/img/element/<属性ID>.webp`（`fire` / `water` / `nature` / `holy` / `dark`。正方形） |
| ホームの背景・バナーの絵 | `src/img/home-bg-portrait.webp`（縦画面）・`home-bg-landscape.webp`（横画面）・`banner-dungeon.webp`・`banner-match.webp`・`banner-gacha.webp` |

編集したら **`npm run build`**（`docs/firebase-config.js` は上書きしません）。

## コマンド

Node.js 18 以上。ブラウザテストは Playwright（Chromium）、オンラインのテストは Java 11 以上と firebase-tools を使います。

```sh
npm run build        # dist/ と docs/ を生成
npm run check        # 生成物がソースと一致しているか
npm test             # ロジックのテスト（戦闘・カスタム・成長・ビルド）
npm run e2e          # ブラウザ操作テスト（この端末保存モード・2タブ対戦）
npm run test:online  # Firebase エミュレーター上でオンライン機能のテスト（本物の Firebase には接続しない）
```

テスト用URLオプション：`?seed=数字`（乱数固定）、`?fast=1`（演出を短く）
