# CLAUDE.md — 六耀の決闘

このリポジトリで作業する Claude への指示です。ゲームの全体像は **GAME-OVERVIEW.md**、細かい経緯は **HANDOFF.md**、運用は **README.md** を先に読んでください。

## いつも守ること

- 編集するのは `src/`（と `tests/`・`scripts/`）。`dist/` と `docs/index.html` は生成物なので直接いじらない。
  編集したら `node scripts/build.js` で生成し、`node scripts/build.js --check` で一致を確認する。
- **`docs/firebase-config.js` は上書きしない**（公開中の設定。管理用コードのハッシュも入っている）。変更は利用者が明示的に許可したときだけ。
- ゲームの計算式・ガチャ確率・保存データの形式は、頼まれない限り変えない。保存データは読み込み時に `P.sanitize` で直すので、項目を足すときは互換性を保つ。
- 変更が終わったら `npm test` と `npm run e2e` を通す（オンライン機能に触れたら `npm run test:online` も）。
- **テストが通ったら、毎回 main に入れて公開する**（利用者の希望）。作業ブランチにコミット・push → main に fast-forward で取り込んで push → GitHub Pages の「pages build and deployment」が success になったことを確認して報告する。
  利用者が「main に入れない」と指示したときはそれに従う。
- 報告は日本語で、専門用語を避けて短く。実機（iPhone など）で確認できていないことは、そう書く。
- 画像は `src/img/` に WebP で置く（ビルドで HTML に埋め込まれる）。大きすぎる画像は縮小・圧縮してから入れる（目安：キャラ 1 枚 20〜80KB、背景 1 枚 200KB 以下）。

## クリーチャーを作るとき

「クリーチャー」は 2 種類あります。どちらを作るのか分からないときは、利用者に聞いてください。

| 種類 | 置き場所 | 使われ方 |
| --- | --- | --- |
| 仲間キャラ（プレイヤーが使う） | `src/data.js` の `CHARACTERS` | ガチャ・編成・図鑑・CPU 対戦の敵チーム |
| ダンジョンの敵（ボス） | `src/data.js` の `BOSSES` ＋ `DUNGEONS` | ダンジョンの各階に 1 体（ガチャ・編成には出ない） |

### 1. 仲間キャラを作る

1. **既存の 8 体を読む**（`CHARACTERS`）。名前・属性・役割がかぶらないようにする。
2. **データを足す**。形は既存と同じにする。
   - `id`：英小文字（例 `hoshigane`）。既存と重ならないこと。
   - `name`（○○の△△ の形が基本）、`glyph`（漢字 1 文字。絵が無いときの紋章）、`maxHp`、`element`（`fire` 猛火 / `water` 水脈 / `nature` 自然 / `holy` 聖光 / `dark` 呪闇）、`subTypes`（副属性 1〜2 個。表示のみ）。
   - `moves`：**9 個**。先頭 6 個が初期の出目 1〜6。7・8・9 個目は Lv3・6・10 で解放される技。各技は `{ name, atk, heal }`（攻撃しない技は `atk: 0`）。技名は重複させない。
   - `skill`：固有スキル `{ name, cd, text, effects }`。`effects` の種類は `data.js` 冒頭のコメント（`atkMultiplier` / `atkBonus` / `heal` / `barrier` / `reroll` / `damage`）から選ぶ。`text` には対象範囲（「敵前衛全員」「味方前衛全員」など）を必ず書く。
   - `leaderSkill`：`{ name, text, effects }`。種類は `maxHp` / `atkBonus` / `healBonus` / `skillDamageBonus` / `skillHealBonus` / `startBarrier`。
3. **強さを既存に合わせる**。
   - ランク（★）は自動で決まる：基礎 HP ＋ 初期 6 技の攻撃の平均 ＋ 回復の平均（`E.rankParts`）。`RANKS` の境界（★3 は 130 以上）。
     ★2 にしたいなら合計 110〜128 くらい、★3 なら 135〜180 くらいが既存の範囲。作ったら `node -e` で `E.rankParts` と `E.starsOf` を出して確かめる。
   - 技力の上限（初期 6 技の攻撃＋回復の合計 ＋ 5）を超える技構成は初期構成にできない。`E.loadoutError(id, E.defaultLoadout(id))` が `null` になること。
   - 既存キャラの HP は 95〜160、技 1 つの攻撃はおおむね 0〜40、回復は 0〜39。極端な値にしない。
4. **絵を入れる**（利用者から絵をもらったとき）。
   - `src/img/chara/<id>.webp` に置くだけで、ビルドがカード・紋章の CSS を作る。カード画像に枠や名前の帯が描かれていたら、絵の部分だけ切り抜く。縦長（約 148:205）がよい。
   - 顔の位置に合わせて `src/style.css` の `[data-char="<id>"] { --cx; --cy; --ex; --ey }` を足す（ホームのカードと丸い紋章で顔が切れないように）。スクリーンショットで確認する。
   - 絵が無い間は、属性色の地に `glyph` の文字が出る（それで動く）。
5. **テストと文書を直す**。キャラの数が決め打ちのテストがある：
   - `tests/engine.test.js` の `E.CHARACTERS.length`、`tests/e2e.test.js` の図鑑・管理用アカウントの所持数、`tests/online.test.js` の所持数、`tests/custom.test.js` の★の一覧。
   - `GAME-OVERVIEW.md` のキャラ表、`HANDOFF.md`、`README.md` を更新する。
6. 必要なら CPU 対戦（`CPU_MATCHES`）の敵チームに入れる（入れなくてもガチャ・フリー対戦には出る）。

### 2. ダンジョンの敵（ボス）を作る

1. **既存の `BOSSES` と `DUNGEONS` を読む**。1 つのダンジョンは「雑魚 → 中ボス → 大ボス」の 3 階。
2. **データを足す**。
   - `id` は `b-` で始める（例 `b-golem`）。`rank` は `'雑魚'` / `'中ボス'` / `'大ボス'`。
   - `moves` は **6 個**（出目 1〜6）。`skill` は 1 つ（`cd` は 3〜4）。リーダースキルは無し。
   - 新しいダンジョンなら `DUNGEONS` に `{ id, name, text, recommend, requires, firstClearStones, clearStones, floors: [{ boss, level, exp } ×3] }` を足す。`requires` は前のダンジョンの `id`。
3. **強さを既存に合わせる**。
   - 既存の HP の目安：雑魚 150〜180、中ボス 290〜350、大ボス 400〜510（後のダンジョンほど高い）。
   - 推奨レベルで「踏破できるがぎりぎり」になるように。必要なら CPU 同士で試算して、勝率を報告する（森 Lv1 約 87%、海底神殿 Lv5 約 57%、塔 Lv10 約 43% が今の目安）。
4. **絵と背景を入れる**。
   - ボスの絵：`src/img/chara/<id>.webp`（切り取らずに全体を表示する）。
   - ダンジョンの背景：`src/img/battle/<ダンジョンID>-portrait.webp`（縦画面）と `-landscape.webp`（横画面）。1 枚だけなら `<ダンジョンID>.webp`。
5. **テストと文書を直す**：`tests/progress.test.js` のダンジョンのテスト、`GAME-OVERVIEW.md`・`HANDOFF.md`。

### 作り終えたら

- `node scripts/build.js` → `--check` → `npm test` → `npm run e2e`。
- スマホ幅（390×844）で、図鑑・編成・戦闘のスクリーンショットを撮って、絵や文字が切れていないか見る。
- 作ったクリーチャーの「名前・属性・HP・技・固有スキル・（仲間なら）リーダースキルと★」を表にして報告する。
- main に入れて公開し、公開の成功まで確認する。
