# 毎晩のダンジョンの絵づくり（Mac の Claude Code ＋ codex-image）

クラウドの Claude が毎晩 21:37 ごろ新しいダンジョンを 1 つ作って main に入れる（絵なし）。
Mac の Claude Code の毎晩の予定（22:30 ごろ・`rokuyo-dungeon-art`）が **このファイルを読んで、この手順どおりに** 絵を作って公開する。
手順を変えたいときは、このファイルだけを直せばよい（予定の中身は「このファイルに従う」だけ）。
細かい道具の使い方は CLAUDE.md の「ダンジョンの絵づくり（scripts/dungeon-art.js）」にある。必ず先に読むこと。

## 0. この Mac の準備（毎回）

- Bash のコマンドでは毎回先頭に次を付ける：
  `export PATH=$HOME/.rokuyo-tools/venv/bin:$PATH NODE_PATH=$HOME/.rokuyo-tools/node_modules`
  （Pillow 入りの python3 と Playwright がここにある。リポジトリに node_modules は無い。リポジトリの中で npm install はしない）
- `pgrep -fl "node --test"` で、前のテストが残っていないか確かめる。残っていれば止める（残っていると Mac が重くなり、テストが全部失敗する）。
- `uptime` の負荷（load averages の最初の数字）が 30 を超えていたら、5 分待ってもう一度見る。3 回待っても下がらなければ、テストは後回しにして、絵づくりと取り込みまでで止めて報告する（次の晩に続きから公開される）。
- 画像生成：
  `node "$(ls -d $HOME/.claude/plugins/cache/codex-image-in-cc/codex-image/*/ | sort -V | tail -1)scripts/codex-image.mjs" generate --ref <見本.png> --ref <見本.png> "<英語の指示文> Save to <保存先の絶対パス>"`
  1 枚 1〜3 分。Bash のタイムアウトは 600000 にする。見本の webp は `sips -s format png` で PNG にしてから渡す（作業用フォルダに置く）。
- GitHub への push はキーチェーンのログインで通る。認証で断られたら、トークンを入力しようとせず、送らずに報告する。

## 1. 最新にする（前の晩の残りは引き継ぐ）

- `git fetch origin` → `git checkout claude/determined-archimedes-wy7qnj`。
- `git status --short` を見る。
  - **何も無い** → `git merge --ff-only origin/main`。
  - **前の晩のダンジョンの絵の残りだけ**（`art/<ID>/art.json`、`src/style.css` の `dungeon-art` の区切りの中、`src/img/chara/b-*.webp`、`src/img/boss/b-*.webp`、`src/img/battle/*`、`src/img/dungeon/*`、それと生成物の `dist/`・`docs/index.html`）
    → 消さずに引き継ぐ。生成物だけ `git checkout -- dist docs/index.html` で戻してから `git merge --ff-only origin/main`。残っていた絵は「取り込み済み・未公開」として手順 6 から続ける。
  - **それ以外の変更**（キャラの絵づくりの途中など）→ 触らずに止めて報告する。

## 2. 絵が無いダンジョンを探す（たまっていれば追いつく）

- `src/data.js` の `DUNGEONS` のうち、敵 3 体の `src/img/boss/<敵ID>.webp`（背景なしの絵）、`src/img/battle/<ダンジョンID>-portrait.webp`、`-landscape.webp` のどれかが無いものが対象。
  ただし、`src/img/chara/<敵ID>.webp`（昔の背景ありの絵）はあって `src/img/boss` だけ無い敵は、下の「追いつき」で扱う。
- 対象が無く、引き継いだ残りも無ければ「今日は作る絵なし」と報告して終わる。
- 対象が複数あれば、**新しいものから最大 2 つ**（たまっている分は次の晩以降に続けて追いつく）。引き継いだ残りは数に入れない。
- **敵は背景なしだけ描く（2026-11-10〜・利用者の希望）**：ダンジョンの戦闘では、敵を背景の中に直接立たせる。
  **敵の絵には景色・地面を描かない。敵だけを描く**（背景なし＝ floor1-cut〜floor3-cut）。背景あり（floor1〜floor3）はもう作らない。
  ダンジョンの背景（スマホ用 portrait・PC 用 landscape）は今までどおり作る。
  - 対象のダンジョンでは、敵 3 体（背景なし）＋背景 2 枚の **5 枚** を作る。紋章・図鑑用の敵の絵（`src/img/chara/<敵ID>.webp`）も、取り込みが背景なしの絵から自動で作る。
  - それとは別に、**絵はあるのに `src/img/boss/<敵ID>.webp` が無い敵**を、1 晩に**最大 3 体**作って追いつく（古いダンジョンから。`art/<ID>/prompts.md` の「（背景なし）」の指示文を使う。その敵の floorN-cut だけ作って取り込む）。

## 3. 指示文を用意する

- `art/<ID>/prompts.md` と `art.json` があればそれを使う。
- 無ければ `node scripts/dungeon-art.js prompts <ID>` で下書きを作り、`art.json` の `world`（場所の景色）と
  `enemies.<敵ID>.describe`（敵の姿）を、`src/data.js` の名前・属性・ランク・固有スキルに合わせて英語で具体的に書き直し、もう一度 `prompts` を実行する。

## 4. codex-image で 5 枚作る（敵 3 体は背景なし・背景 2 枚。1 回に 1 枚ずつ。まとめて頼まない）

- 敵：floor1-cut（1 階の雑魚）・floor2-cut（2 階の中ボス）・floor3-cut（3 階の大ボス）：縦長 1024×1536。
  指示文は `prompts.md` の「（背景なし）」の英語の文。文中の「in the same style as the reference images」は消し、**見本の画像は渡さない**（見本の背景まで描かれてしまう）。
  codex-image で背景を透明にできればそのまま。できなければ、指示文のとおり真っ平らな薄い灰色の地でよい（取り込みで自動で抜く）。
  `prompts.md` にある背景ありの敵（floor1〜floor3）の指示文は使わない。
- portrait（スマホ用の背景）：縦長 1024×1536／landscape（PC 用の背景）：横長 1536×1024。見本は採用済みの `src/img/battle/*-landscape.webp`・`*-portrait.webp`。
- 画質は medium で十分。
- 保存先：`art/<ID>/raw/floor1-cut.png`〜`floor3-cut.png`・`portrait.png`・`landscape.png`（`floor1.png` などは置かない）

## 5. 自分の目で確かめる（だめなものはその 1 枚だけ作り直す。最大 2 回まで）

- 文字・名前・数字・HP・星・ボタン・枠が描かれていない
- 敵は 1 体だけ（集合画像でない）、頭から足まで入っている。まわりに景色・地面・影・枠が無い（透明の地か、平らな灰色の地）
- 雑魚 → 中ボス → 大ボスで、大きさと迫力がはっきり違う
- 背景に人や敵がいない、余白がない
- 繊細な線の手描き水彩風で、既存の絵と並べて浮かない

## 6. 取り込む

- `node scripts/dungeon-art.js import <ID>`（縮小・軽量化して `src/img/` に入る。既にある絵は上書きしない）
  背景なしの絵は `src/img/boss/<敵ID>.webp`（戦闘用）に入る（灰色の地は自動で抜く）。背景ありの絵（floorN）が無ければ、紋章・図鑑用の `src/img/chara/<敵ID>.webp` も背景なしの絵から作る。
  追いつきで 1 体だけなら `import <ID> --only floor2-cut` のように指定する（`src/img/chara` に昔の絵があればそちらは変えない）。
  取り込んだ背景なしの絵は、戦闘のスクリーンショット（check）で、敵が背景の中に立っているか・ふちに灰色が残っていないかを見る。
- `node scripts/dungeon-art.js check <ID>` を実行し、`art/<ID>/check/` のスクリーンショットを全部見る。
- 丸い紋章で敵の顔が切れていたら、`art.json` の `emblem`（`ex`・`ey`＝顔の位置%、`es`＝拡大率%）を直して
  `node scripts/dungeon-art.js emblem <ID>` → もう一度 `check`。

## 7. テストして送る

- `node scripts/build.js` → `node scripts/build.js --check` → `npm test` → `npm run e2e`
  （e2e は 10 分ほどかかるので、バックグラウンドで実行して結果のファイルを読む）。
- e2e の「CPU対戦の選択」（スワイプが止まる位置）と「2つのタブでプレイヤー対戦」は、Mac が重いと時々失敗する。
  その 2 つだけ失敗したときは `node --test --test-name-pattern="<テスト名の一部>" tests/e2e.test.js` でもう一度だけ実行し、通ればよい。
  ほとんど全部が失敗したときは Mac の重さが原因のことが多い。手順 0 の負荷を見て、下がってから e2e を 1 回だけやり直す。
- 通ったらコミット（例「<ダンジョン名>の絵を入れる」。複数なら 1 つのコミットにまとめてよい。`git add` は変えたファイルだけを名前で指定する）
  → `git push origin claude/determined-archimedes-wy7qnj` → `git checkout main` → `git merge --ff-only claude/determined-archimedes-wy7qnj` → `git push origin main` → 作業ブランチに戻る。
- 断られた（rejected）ら `git fetch` → `git rebase origin/main` → テストし直してから送る。
- GitHub の「pages build and deployment」が success になったかを確かめる
  （`curl -s "https://api.github.com/repos/harunosuke1130-svg/rokuyo-duel/actions/runs?per_page=3"` で、送ったコミットの実行が completed / success になるまで待つ）。
- テストが通らないときは送らずに、何が失敗したかを報告する。取り込んだ絵は消さずに残す（次の晩に手順 1 で引き継がれる）。

## 8. 報告（日本語・専門用語なし・短く）

- 作ったダンジョン名、5 枚それぞれの出来（作り直した枚数）、送ったコミット、公開の成否、まだ絵が無いダンジョンの数、気になった点。
- 実機（iPhone）で見ていないことは「未確認」と書く。

## 守ること

- `docs/firebase-config.js` は変えない。ゲームの数値・ガチャ・保存データ・ダンジョンの数値は変えない。
- `art/*/raw/` と `art/*/check/` は git に入れない（.gitignore 済み）。
- このファイル（`art/DAILY-ART-PROMPT.md`）は、利用者に頼まれたときだけ直す。
