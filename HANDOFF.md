# 引き継ぎメモ（六耀の決闘）

## 現状（v4）

- 戦闘（v2：6体・前衛3／後衛3、v3：技カスタム・リーダースキル）に、v4 でレベル・先攻後攻のサイコロ・ダンジョン・ガチャ・ログインボーナス・アカウント・プレイヤー対戦・管理用アカウントを追加。
- 保存先は2種類：**この端末（localStorage）** と **Firebase（Auth＋Firestore）**。`docs/firebase-config.js` の `enabled` で切り替え。単一HTML・claude.ai 版は常にこの端末保存。
- Firebase 部分は **Firebase エミュレーター上で動作確認済み**（本物のプロジェクトはまだ無い）。本番の作成・設定は SETUP-FIREBASE.md の手順で利用者が行う。
- GitHub Pages は未公開（リポジトリ `harunosuke1130-svg/rokuyo-duel` は Pages 無効）。

## v5 の変更（対戦とダンジョンを分離・管理用コード）

- **対戦（CPU）**：旧ダンジョンの10階層を `CPU_MATCHES`（ランク戦）に移動。`matchUnlocked / matchEnemy / applyMatchResult`、記録は `profile.matches.won`。
- **ダンジョン**：3階（雑魚・中ボス・大ボス）×3種。敵はダンジョン専用の `BOSSES`（ガチャ・チームには出ない。`E.isBoss`）。`createBattle(..., { enemyKind: 'boss', startHp })` で敵1体・HP引き継ぎ。生存キャラが3体未満なら前衛はその数（`E.frontRequired`）。階の間の回復は `P.carryOverHp`（`DUNGEON_RULES.healBetweenFloorsPercent`）。報酬は `P.applyDungeonFloor`（大ボスで踏破・石、`profile.dungeon.cleared[ダンジョンID]`）。挑戦途中の状態は保存しない（画面を閉じたら1階から）。
- **ボスの強さ**（CPU同士の試算・各100〜120回）：推奨レベルでの踏破率は森 Lv1 で約87%、海底神殿 Lv5 で約57%、塔 Lv10 で約43%。大ボス戦は20巡前後と長め。
- **管理用コード**（この端末保存モード）：ログイン画面「管理用アカウントで入る」。`docs/firebase-config.js` の `localAdminCodeHash` と SHA-256 を照合（`backend.js` に自前の SHA-256。file:// でも動く）。コードそのものはリポジトリに置かない。この端末保存モードではデータが端末内だけなので、改ざんの影響もその端末に限られる。

## 構成と責任

| ファイル | 役割 |
| --- | --- |
| `data.js` | 数値データ（`CONFIG.LEVEL`・`ECONOMY`・`DUNGEONS` を追加） |
| `engine.js` | 戦闘。`createBattle(p, c, {loadouts, levels, labels})`、`chooseFormation` → `rollInitiative`（phase `initiative`）→ ターン。`surrender`。レベルは `makeUnit`（HP）と `attackBoost`（攻撃加算） |
| `cpu.js` | CPU。`decide/act`、`chooseFormation`、`chooseLeader` |
| `profile.js` | 成長の純粋関数（`newProfile/sanitize/addExp/drawGacha/claimLogin/applyDungeonResult/applyPvpResult/setTeam/setLoadout`） |
| `backend.js` | `LocalBackend` / `FirebaseBackend`（同じAPI：認証・プロフィール・ルーム） |
| `ui-core.js` | 共通部品・モーダル・トースト・画面切り替え |
| `ui-battle.js` | 戦闘画面。`mode`＝`cpu` / `pvp-host` / `pvp-guest`、自分の陣営 `me`（ゲストは `'cpu'`） |
| `ui-app.js` | ログイン・ホーム・チーム・ダンジョン・ガチャ・ロビー・結果と報酬 |

## 対人戦の仕組み（ホストが計算）

- ルーム文書 `rooms/{6文字コード}`：`status`（waiting→ready→playing→over/closed）、`hostUid/guestUid`、`host/guest`（チーム設定）、`stateJson`（戦闘状態）、`lastJson`（直前の演出イベントとログ）、`seq`、`intent`（ゲストの依頼）、`reject`、`hostSeen/guestSeen`（15秒ごとの接続確認）。
- ゲストは操作を手元の Engine で試してから `intent` を送る → ホストが Engine で検証して適用 → `stateJson` を書く → 両方の画面が `seq` の更新で再描画・演出。
- 数字・振り直し・先攻後攻のサイコロはホストの乱数。
- Firestore は入れ子の配列を保存できないため、状態とチーム設定は JSON 文字列で保存。
- セキュリティルール（`firestore.rules`）：プロフィールは本人のみ、石は0以上の整数、ルーム作成は自分がホストのときだけ、参加は待機中ルームに自分を入れるだけ、ゲストは `intent`・`guestSeen` だけ更新可、ホストは参加者を変えずに更新可。

## 既知の制約・今後の候補

- **不正対策は限定的**：ガチャ・報酬・ログインボーナスはブラウザで計算し、本人のプロフィールに書く。他人のデータは守られるが、自分の石やキャラは改ざんできる。本格的にするには Cloud Functions（有料 Blaze プラン）でサーバー側に移す。対人戦でゲストが送るチーム設定（レベル）も自己申告。
- ログインボーナスは端末の時計で判定。
- ホストの切断で対戦は止まる（ホストは「相手の切断で勝利」を選べる。ゲスト側は退出のみ）。
- ルーム文書は対戦後も残る（ホストが待機中に閉じた場合は削除）。量が増えたら定期削除を検討。
- キャラが8体なので、ガチャの楽しみは少なめ。`CHARACTERS` に追加すればガチャ・ダンジョンにそのまま使える（ダンジョンの敵は手で指定）。
- 先攻後攻をサイコロにしたので、以前の「プレイヤー常に先攻で約7割勝つ」偏りは解消。

## テスト（すべて通過）

- `npm test`：戦闘25件・カスタム／リーダー8件・成長10件（レベル・先攻後攻・降参・プロフィール・ガチャ・ログインボーナス・ダンジョン・対人戦報酬・チーム）・ビルド3件
- `npm run e2e`：8件（スマホ幅／PC幅、はじめる→ボーナス→チーム→技カスタム→再読み込み、ガチャ、戦闘の基本、ダンジョン決着と報酬と再戦初期化、2タブ対人戦、演出ありの操作制限）
- `npm run test:online`：4件（Firebase エミュレーター：登録・ログイン失敗の案内・再ログインで進行が残る、管理用アカウント、離れた2人の対戦と成績保存、セキュリティルール）

## 未確認

- Safari 実機（Mac / iPhone）
- 本物の Firebase プロジェクト・GitHub Pages の公開URL（どちらも未作成）
- claude.ai 版での対人戦（別タブ間の通信が claude.ai の表示枠内で動くか）
