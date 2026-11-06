# 毎日のダンジョンの絵づくり（Mac の Claude Code ＋ codex-image に渡す指示文）

クラウドの Claude が毎晩 21:37 ごろダンジョンを作る（絵なし）。この指示文を Mac の Claude Code の毎日の予定（22:30 ごろ）に入れて、絵を作って組み込んでもらう。

```
毎日の定期タスク：六耀の決闘のダンジョンの絵を作って、ゲームに組み込む

リポジトリ：harunosuke1130-svg/rokuyo-duel（作業ブランチ claude/determined-archimedes-wy7qnj）
毎晩 21:37 ごろ、別の Claude（クラウド）が新しいダンジョンを1つ作って main に入れている。
絵はそちらでは作れないので、こちら（codex-image プラグインが使える Mac）で作る。
手順の詳細は CLAUDE.md の「ダンジョンの絵づくり（scripts/dungeon-art.js）」にある。必ず先に読むこと。

1. 最新にする
   - git fetch origin → 作業ブランチを origin/main に合わせる（git checkout claude/determined-archimedes-wy7qnj → git merge --ff-only origin/main。手元に送っていない変更があれば、消さずに止めて報告する）。

2. 絵が無いダンジョンを探す
   - src/data.js の DUNGEONS のうち、次のどれかが無いものが対象：
     敵3体の src/img/chara/<敵ID>.webp、src/img/battle/<ダンジョンID>-portrait.webp、src/img/battle/<ダンジョンID>-landscape.webp
   - 対象が無ければ「今日は作る絵なし」と報告して終わる。
   - 対象が複数あれば、新しいものから最大2つまで。

3. 指示文を用意する
   - art/<ダンジョンID>/prompts.md と art.json があればそれを使う。
   - 無ければ node scripts/dungeon-art.js prompts <ダンジョンID> で下書きを作り、art.json の world（場所の景色）と
     enemies.<敵ID>.describe（敵の姿）を、src/data.js の名前・属性・ランク・固有スキルに合わせて英語で具体的に書き直し、
     もう一度 prompts を実行する。

4. codex-image で5枚作る（1回に1枚ずつ。まとめて頼まない）
   - floor1（1階の雑魚）・floor2（2階の中ボス）・floor3（3階の大ボス）：縦長 1024×1536
   - portrait（スマホ用の背景）：縦長 1024×1536
   - landscape（PC 用の背景）：横長 1536×1024
   - 指示文は prompts.md の英語の文をそのまま使う。画質は medium で十分（ゲームでは小さく縮める）。
   - 見本として、採用済みの絵（src/img/chara/b-*.webp、src/img/battle/*-landscape.webp）の画風に合わせる。
   - 保存先：art/<ダンジョンID>/raw/floor1.png・floor2.png・floor3.png・portrait.png・landscape.png

5. 自分の目で確かめる（だめなものはその1枚だけ作り直す。最大2回まで）
   - 文字・名前・数字・HP・星・ボタン・枠が描かれていない
   - 敵は1体だけ（集合画像でない）、頭から足まで入っている
   - 雑魚 → 中ボス → 大ボスで、大きさと迫力がはっきり違う
   - 背景に人や敵がいない、余白がない
   - 繊細な線の手描き水彩風で、既存の絵と並べて浮かない

6. 取り込む
   - node scripts/dungeon-art.js import <ダンジョンID>
     （縮小・軽量化して src/img/ に入る。既にある絵は上書きしない）
   - node scripts/dungeon-art.js check <ダンジョンID> を実行し、art/<ダンジョンID>/check/ のスクリーンショットを全部見る。
   - ダンジョン詳細の丸い紋章で敵の顔が切れていたら、art.json の emblem（ex・ey＝顔の位置%、es＝拡大率%）を直して
     node scripts/dungeon-art.js emblem <ダンジョンID> → もう一度 check。
   - Pillow が無いと言われたら python3 -m pip install Pillow を実行する。

7. テストして送る
   - node scripts/build.js → node scripts/build.js --check → npm test → npm run e2e
   - 通ったらコミット（例「<ダンジョン名>の絵を入れる」）し、
     git push origin claude/determined-archimedes-wy7qnj → main に fast-forward で取り込んで git push origin main
   - 断られた（rejected）ら git fetch → 作業ブランチを origin/main の上に載せ直して（git rebase origin/main）、テストし直してから送る。
   - GitHub の「pages build and deployment」が success になったかを確かめる。
   - テストが通らないときは送らずに、何が失敗したかを報告する
     （e2e のスワイプが止まる位置のテストは、もともと時々失敗するので、もう一度だけ実行してよい）。

8. 報告（日本語・専門用語なし）
   - 作ったダンジョン名、5枚それぞれの出来（作り直した枚数）、送ったコミット、公開の成否、気になった点。

守ること：docs/firebase-config.js は変えない。ゲームの数値・ガチャ・保存データ・ダンジョンの数値は変えない。
art/*/raw/ と art/*/check/ は git に入れない（.gitignore 済み）。
```
