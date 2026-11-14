/*
 * 六耀の決闘 — ゲームデータ
 * 数値・キャラクター・技・スキル・属性相性はすべてこのファイルで編集できます。
 * ブラウザでは window.RikuyouData、Node では module.exports として読み込まれます。
 */
(function (global) {
  'use strict';

  /* ---------- 全体設定 ---------- */
  const CONFIG = {
    TEAM_SIZE: 6,              // 編成する人数
    FRONT_SIZE: 3,             // 前衛の枠数（残りは後衛）
    LOADOUT_SIZE: 6,           // 出目に割り当てる技の数（1〜6）
    LOADOUT_POWER_MARGIN: 5,   // 技の入れ替えで、初期構成の技力（攻撃＋回復の合計）をどれだけ超えてよいか（Lv1のとき）
    LEVEL: {
      max: 999,                // レベルの上限（実質いつまでも上げられる）
      capStep: 30,             // 30レベルごとに止まり、限界突破（結晶）で次の30レベルへ進める
      // 1レベル上がるごとの上昇量。to までのレベルにその値を使う（Lv31〜90 は HP だけ少し緩く、Lv91〜 はしっかり緩く）
      //   hp＝最大HP（基礎値に対する%）、atk＝攻撃力・回復力の伸び（POWER.growthPer を参照）、power＝技力の上限（端数は切り捨て）
      growth: [
        { to: 30,  hp: 4, atk: 1,   power: 1 },
        { to: 90,  hp: 3, atk: 1,   power: 1 },
        { to: 999, hp: 1, atk: 0.5, power: 0.5 }
      ],
      expBase: 100,            // Lv1→2 に必要な経験値
      expStep: 50,             // 以降1レベルごとに必要経験値が増える量
      moveUnlock: [3, 6, 10]   // 技の候補の7・8・9個目が使えるようになるレベル（1〜6個目は最初から）
    },
    DICE_SIDES: 6,             // 出目の最大値（1〜6）
    // 目押し（2026-11-14〜）：サイコロの目が 1→6 と順に光り、押した瞬間に光っていた目を「狙う」。chance の確率でその目が出る（外れたら普通に振る）
    DICE_AIM: { chance: 0.5, stepMs: 190 },
    // 攻撃力・回復力・HP（2026-11-08〜）。技の数字は倍率：ダメージ＝攻撃力×技の攻撃、回復＝回復力×技の回復。
    // スキルの「20ダメージ」なども攻撃力×20、回復スキルは回復力×数字。
    POWER: {
      hpScale: 10,                          // 最大HP＝データの maxHp × 10（×属性の補正）
      stars: { 1: 8, 2: 9, 3: 10, 4: 10 },  // ★ごとの攻撃力・回復力の基準
      boss: 10,                             // ダンジョンの敵の攻撃力・回復力（属性の補正なし）
      growthPer: 15,                        // 攻撃力・回復力＝基準×(1＋LEVEL.growth の atk の合計÷15)。Lv1 で 10 なら Lv30 で約 29
      // 属性の特色（攻撃力・回復力は足す数、HP は%）
      element: {
        fire:   { atk: 2,  heal: -1, hp: 0 },
        dark:   { atk: 1,  heal: 0,  hp: -5 },
        nature: { atk: 0,  heal: 1,  hp: 10 },
        water:  { atk: -1, heal: 2,  hp: 0 },
        holy:   { atk: 0,  heal: 1,  hp: 5 }
      }
    },
    // 技の効果（2026-11-09〜）：技に fx: { type, ... } を1つだけ付けられる。効果の分だけ技力（攻撃＋回復）に cost を足す
    //   drain   吸収：与えたダメージの合計の percent% だけ、使ったキャラが回復する（回復疲労の影響なし）
    //   poison  毒：当たった敵に、その陣営のターンの始めごとに「使った人の攻撃力×value」のダメージを turns 回（毒では倒れない。HP1で止まる）
    //   weaken  弱体：当たった敵の攻撃力（stat:'atk'）か回復力（stat:'heal'）を percent% 下げる。その敵の陣営のターン turns 回ぶん
    //   multi   連撃：hits 回に分けて当てる（合計はほぼ同じ。結界は最初の1回だけを軽くして消える）
    //   pinch   反撃：使ったキャラの HP が最大の under% 以下（ピンチ）なら、攻撃が mult 倍
    //   guard   守り：使ったキャラに「4分の1結界」（次に受ける防げるダメージ1回を QUARTER_BARRIER 倍）
    // 特性（キャラの trait: { name, text, effects }。★3以上に1つ。2026-11-09〜）：
    //   pursuit 追撃（相手の前衛が HP under% 以下なら、通常技がもう1回。2回目は1回目の percent%）
    //   firstStrike 先手（自分の陣営の最初のターンだけ通常技の攻撃 mult 倍）
    //   guts 根性（1戦に1回、倒れるダメージでも HP1 で耐える。HP が2以上のとき）
    //   poisonResist 毒に強い（毒にならない）
    // リーダースキル counter（反撃）：味方の誰でも、自分の HP が under% 以下なら通常技の攻撃 mult 倍（技の効果の反撃とは重ならない）
    MOVE_FX_COST: { drain: 4, poison: 5, weaken: 5, multi: 2, pinch: 3, guard: 6 },
    QUARTER_BARRIER: 0.25,
    ADVANTAGE_MULTIPLIER: 1.05, // 属性有利の倍率（ここ1か所で変更）
    BARRIER_MULTIPLIER: 0.5,   // 琥珀の結界の被ダメージ倍率
    FATIGUE: {
      normalUntilRound: 15,    // この巡までは回復100%
      stepPercent: 10,         // 以降1巡ごとに減る割合（ポイント）
      minPercent: 25           // 最低割合
    }
  };

  /* ---------- 属性 ---------- */
  // 新しい属性を追加した場合、ELEMENT_ADVANTAGE に書かなければ常に1倍になります。
  const ELEMENTS = {
    fire:   { name: '猛火', color: '#e2673b' },   // 内部ID（fire など）は変えない。表示名だけ
    water:  { name: '水脈', color: '#3d93d6' },
    nature: { name: '自然', color: '#5fae55' },
    holy:   { name: '聖光', color: '#e8cf6a' },
    dark:   { name: '呪闇', color: '#9a6ad6' }
  };

  /*
   * ---------- キャラクターのランク（★の数） ----------
   * キャラ固有のランク。レベル・残りHP・技の付け替えでは変わらない。
   * 比較の値 ＝ 基礎HP ＋ 初期構成（出目1〜6）の通常技の攻撃の平均 ＋ 回復の平均
   *   （攻撃しない技の攻撃・回復しない技の回復は0。固有スキル・リーダースキル・属性・一時強化は含めない）
   * thresholds は上の星から順に「この値以上ならこの星」。どれにも届かなければ base。
   * ダンジョンのボスには付けない（雑魚・中ボス・大ボスで表示）。
   */
  const RANKS = {
    base: 1,
    thresholds: [{ stars: 4, minScore: 195 }, { stars: 3, minScore: 130 }, { stars: 2, minScore: 110 }]
  };

  // 攻撃側 → 有利を取れる防御側の属性
  const ELEMENT_ADVANTAGE = {
    water:  ['fire'],
    fire:   ['nature'],
    nature: ['water'],
    holy:   ['dark'],
    dark:   ['holy']
  };

  /*
   * ---------- キャラクター ----------
   * moves: 技の候補（8個以上）。atk=攻撃、heal=回復（両方あれば両方発動）
   *        先頭6個が初期の「出目1〜6」。プレイヤーは6個を選んで順番を入れ替えられる（技力の上限あり）
   * leaderSkill.effects の種類（リーダーにしたときだけ、戦闘中ずっと有効）:
   *   maxHp            {scope:'all', percent}       味方の最大HP・初期HPを上げる
   *   atkBonus         {scope:'all'|'element', element, value}  通常技の攻撃に加算（攻撃0の技は除く）
   *   healBonus        {value}                     通常技の回復に加算（回復0の技は除く）
   *   skillDamageBonus {value}                     固有スキルの直接ダメージに加算
   *   skillHealBonus   {value}                     固有スキルの回復に加算
   *   startBarrier                                 戦闘開始時、味方前衛全員に結界
   *   regen            {value}                     自分のターンの開始時、味方の生存前衛全員をそれぞれ回復（回復疲労の影響を受ける）
   *   lowDice          {dice:[1,2], atk, heal}     出目が dice のどれかのとき、味方の通常技の攻撃に atk・回復に heal を加算（攻撃0・回復0の技は除く）
   * skill.effects の種類:
   *   atkMultiplier {value}          このターンの通常技の攻撃を value 倍
   *   atkBonus      {value}          このターンの通常技の攻撃に加算（攻撃0の技には加算しない）
   *   heal          {amount}         味方の生存前衛全員をそれぞれ回復
   *   barrier                        味方の生存前衛全員に結界（すでに持つキャラは変化なし）
   *   reroll                         確定した数字を振り直す
   *   damage        {amount, ignoreDefense}  敵の生存前衛全員にそれぞれ直接ダメージ（属性倍率なし）
   *   chooseDice                     確定した数字を、使う人が1〜6から選んだ数字に変える（星4専用。CPU は一番よい数字を選ぶ）
   *   fatigueReset  {rounds}         味方の回復疲労をなくす（この巡から数え直し。回復量が100%に戻る）。rounds があればその巡数ぶんだけ戻す。
   *                                  1戦に1回まで（陣営ごと。2回目以降は何もしない）。heal より前に書くと、その回復にも効く
   * 通常技の攻撃は「敵の生存前衛全員」、回復は「味方の生存前衛全員」に、それぞれ全量が入ります。
   * subTypes: 副属性（表示・分類のみ。複数追加可）
   */
  const CHARACTERS = [
    {
      id: 'ryogen', name: '燎原の剣士', glyph: '燎', maxHp: 120, element: 'fire',
      subTypes: ['騎士', '剣士'],
      leaderSkill: { name: '騎士団の先陣', text: '味方全員の通常技の攻撃の数字+3（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'all', value: 3 }] },
      trait: { name: '追撃の剣', text: '追撃：相手の前衛がピンチ（HP3割以下）なら、通常技がもう1回当たる（2回目は1回目の半分）。', effects: [{ type: 'pursuit', percent: 50, under: 30 }] },
      moves: [
        { name: '火花', atk: 8, heal: 0 },
        { name: '斬り払い', atk: 14, heal: 0 },
        { name: '紅蓮の一閃', atk: 32, heal: 0 },
        { name: '息を整える', atk: 0, heal: 20 },
        { name: '炎の輪', atk: 22, heal: 0 },
        { name: '燃え尽きる刃', atk: 35, heal: 0, fx: { type: 'pinch', mult: 2, under: 30 } },
        { name: '焔の構え', atk: 18, heal: 6 },
        { name: '灰燼の突き', atk: 26, heal: 0 },
        { name: '残り火', atk: 4, heal: 8 }
      ],
      skill: {
        name: '紅蓮の誓い', cd: 4,
        text: 'このターンに使う通常技の攻撃を2倍にする。回復は倍にしない。',
        effects: [{ type: 'atkMultiplier', value: 2 }]
      }
    },
    {
      id: 'gessen', name: '月泉の巫女', glyph: '月', maxHp: 100, element: 'holy',
      subTypes: ['巫女', '治癒師'],
      leaderSkill: { name: '月泉の加護', text: '味方全員の通常技の回復の数字+4（回復0の技は除く）。', effects: [{ type: 'healBonus', value: 4 }] },
      moves: [
        { name: '泉の祝福', atk: 0, heal: 39 },
        { name: '月のしずく', atk: 10, heal: 13 },
        { name: '祈り', atk: 0, heal: 26 },
        { name: '満月の光', atk: 24, heal: 16 },
        { name: '静かな夜', atk: 0, heal: 10 },
        { name: '月光弾', atk: 16, heal: 0 },
        { name: '月影の矢', atk: 20, heal: 0 },
        { name: '癒しの雫', atk: 0, heal: 18 },
        { name: '潮満ちる祈り', atk: 6, heal: 22 }
      ],
      skill: {
        name: '月泉の祝福', cd: 3,
        text: '味方前衛全員をそれぞれ回復力×35回復する（後衛は回復しない）。',
        effects: [{ type: 'heal', amount: 35 }]
      }
    },
    {
      id: 'gyakufu', name: '逆風の射手', glyph: '風', maxHp: 95, element: 'nature',
      subTypes: ['射手', '風使い'],
      leaderSkill: { name: '追い風の号令', text: '自然属性の味方の通常技の攻撃の数字+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'nature', value: 5 }] },
      moves: [
        { name: '風穿ち', atk: 40, heal: 0 },
        { name: '双連矢', atk: 28, heal: 0 },
        { name: '牽制射撃', atk: 12, heal: 0 },
        { name: '矢をつがえる', atk: 0, heal: 0 },
        { name: '追い風', atk: 8, heal: 10 },
        { name: '風待ち', atk: 0, heal: 7 },
        { name: '鷹の目', atk: 22, heal: 0 },
        { name: 'つむじ風', atk: 14, heal: 4 },
        { name: '深呼吸', atk: 0, heal: 12 }
      ],
      skill: {
        name: '風向きの逆転', cd: 3,
        text: '確定した数字を1回振り直す。同じ数字が出ることもある。',
        effects: [{ type: 'reroll' }]
      }
    },
    {
      id: 'kohaku', name: '琥珀の守人', glyph: '琥', maxHp: 160, element: 'nature',
      subTypes: ['守護者', '剛力'],
      leaderSkill: { name: '琥珀の砦', text: '味方全員の最大HPと初期HPを10%上げる（端数切り捨て）。', effects: [{ type: 'maxHp', scope: 'all', percent: 10 }] },
      trait: { name: '不動の守人', text: '根性：1戦に1回、倒れるダメージを受けても HP1 で耐える（HP が2以上のとき）。', effects: [{ type: 'guts' }] },
      moves: [
        { name: '岩の拳', atk: 18, heal: 0 },
        { name: '琥珀の槍', atk: 18, heal: 0 },
        { name: '大地の鼓動', atk: 18, heal: 0 },
        { name: '石の刃', atk: 18, heal: 0 },
        { name: '守人の息吹', atk: 4, heal: 20, fx: { type: 'guard' } },
        { name: '地鳴り', atk: 18, heal: 0 },
        { name: '岩壁の構え', atk: 0, heal: 22 },
        { name: '琥珀砕き', atk: 26, heal: 0 },
        { name: '小石投げ', atk: 8, heal: 0 }
      ],
      skill: {
        name: '琥珀の結界', cd: 3,
        text: '味方前衛全員に結界を付ける。結界は各キャラが次に受ける防御可能なダメージ1回を半減し、そこで消える（ダメージを受けるまで何ターンでも続く）。交代しても本人に残り、他のキャラには移らない。重ねがけ不可。防御無視の攻撃では消費されない。',
        effects: [{ type: 'barrier' }]
      }
    },
    {
      id: 'yoiyami', name: '宵闇の魔術師', glyph: '宵', maxHp: 100, element: 'dark',
      subTypes: ['魔術師'],
      leaderSkill: { name: '虚空の導き', text: '味方の固有スキルのダメージの数字+5（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 5 }] },
      moves: [
        { name: '影のささやき', atk: 5, heal: 0 },
        { name: '星喰い', atk: 36, heal: 0 },
        { name: '夜の帳', atk: 0, heal: 16 },
        { name: '虚空の渦', atk: 34, heal: 0 },
        { name: '魔力切れ', atk: 0, heal: 0 },
        { name: '影の針', atk: 14, heal: 0 },
        { name: '闇の鎖', atk: 20, heal: 0 },
        { name: '星の瞬き', atk: 10, heal: 8 },
        { name: '深淵の囁き', atk: 28, heal: 0 }
      ],
      skill: {
        name: '虚空の穿孔', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×20のダメージ（防御・属性を無視）。',
        effects: [{ type: 'damage', amount: 20, ignoreDefense: true }]
      }
    },
    {
      id: 'suiju', name: '翠樹の薬師', glyph: '翠', maxHp: 110, element: 'nature',
      subTypes: ['薬師', '治癒師'],
      leaderSkill: { name: '森の恵み', text: '味方の固有スキルの回復の数字+6（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 6 }] },
      trait: { name: '薬師の心得', text: '毒に強い：毒にならない。', effects: [{ type: 'poisonResist' }] },
      moves: [
        { name: '若葉の薬', atk: 0, heal: 23 },
        { name: '棘の種', atk: 11, heal: 0, fx: { type: 'poison', value: 3, turns: 3 } },
        { name: '生命の実', atk: 0, heal: 46 },
        { name: '癒しの蔓', atk: 12, heal: 16 },
        { name: '森の目覚め', atk: 26, heal: 10 },
        { name: '木漏れ日', atk: 0, heal: 13 },
        { name: '薬草の束', atk: 0, heal: 30 },
        { name: '毒の葉', atk: 20, heal: 0 },
        { name: '芽吹き', atk: 6, heal: 6 }
      ],
      skill: {
        name: '翠樹の活力', cd: 4,
        text: '味方前衛全員をそれぞれ回復力×20回復する。さらに、このターンの通常技の攻撃の数字に10を加える（攻撃0の技には加算しない）。',
        effects: [{ type: 'heal', amount: 20 }, { type: 'atkBonus', value: 10 }]
      }
    },
    {
      id: 'raimei', name: '雷鳴の渡り鳥', glyph: '雷', maxHp: 105, element: 'holy',
      subTypes: ['クリーチャー', '雷使い'],
      leaderSkill: { name: '雷雲の先導', text: '聖光属性の味方の通常技の攻撃の数字+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'holy', value: 5 }] },
      moves: [
        { name: '羽ばたき', atk: 12, heal: 0 },
        { name: '雷の羽', atk: 20, heal: 0 },
        { name: '稲妻落とし', atk: 28, heal: 0 },
        { name: '天雷', atk: 42, heal: 0 },
        { name: 'ひと休み', atk: 0, heal: 13 },
        { name: '帯電', atk: 4, heal: 0 },
        { name: '迅雷', atk: 32, heal: 0 },
        { name: '雨宿り', atk: 0, heal: 18 },
        { name: '静電気', atk: 6, heal: 0 }
      ],
      skill: {
        name: '先駆けの雷', cd: 3,
        text: '敵前衛全員に、それぞれ攻撃力×12のダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 12, ignoreDefense: false }]
      }
    },
    {
      id: 'mukai', name: '霧海の旅人', glyph: '霧', maxHp: 130, element: 'water',
      subTypes: ['旅人', '剣士'],
      leaderSkill: { name: '霧の帳', text: '戦闘開始時、味方前衛全員に結界を付ける（各自、次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'startBarrier' }] },
      trait: { name: '潮風の守り', text: '毒に強い：毒にならない。', effects: [{ type: 'poisonResist' }] },
      moves: [
        { name: '潮の剣', atk: 22, heal: 0 },
        { name: '霧の休息', atk: 0, heal: 31 },
        { name: '波の刃', atk: 15, heal: 0, fx: { type: 'weaken', stat: 'atk', percent: 25, turns: 2 } },
        { name: '返し波', atk: 16, heal: 10 },
        { name: '深海の渦', atk: 34, heal: 0 },
        { name: '凪の呼吸', atk: 10, heal: 23 },
        { name: '霧隠れ', atk: 0, heal: 20 },
        { name: '渦潮の刃', atk: 26, heal: 0 },
        { name: 'しぶき', atk: 10, heal: 0 }
      ],
      skill: {
        name: '潮のめぐり', cd: 3,
        text: '敵前衛全員に、それぞれ攻撃力×12のダメージ（属性倍率なし・結界は有効）。さらに味方前衛全員をそれぞれ回復力×16回復する。',
        effects: [{ type: 'damage', amount: 12, ignoreDefense: false }, { type: 'heal', amount: 16 }]
      }
    },
    {
      // ★4（合計 HP168＋攻撃の平均12＋回復の平均16＝196）。回復役：疲労を消すスキル（1戦に1回）と、毎ターン少し回復するリーダー
      // CPU同士300戦の試算：片側だけにいると勝率約62%（★3で最も高い琥珀の守人は約57%）。決着しない戦闘なし
      id: 'aoizumi', name: '蒼泉の聖女', glyph: '蒼', maxHp: 168, element: 'water',
      subTypes: ['聖女', '治癒師'],
      leaderSkill: { name: '泉のめぐみ', text: '自分のターンの開始時に、味方前衛全員をそれぞれ回復力×5回復する（回復疲労の影響を受ける）。', effects: [{ type: 'regen', value: 5 }] },
      trait: { name: '清らかな泉', text: '毒に強い：毒にならない。', effects: [{ type: 'poisonResist' }] },
      moves: [
        { name: 'さざ波の杖', atk: 12, heal: 16 },
        { name: '清めの雫', atk: 0, heal: 24 },
        { name: '蒼の波紋', atk: 16, heal: 14 },
        { name: '泉の祈り', atk: 0, heal: 28, fx: { type: 'guard' } },
        { name: '水鏡の一閃', atk: 24, heal: 6 },
        { name: '潮騒の裁き', atk: 20, heal: 8 },
        { name: '霧雨の恵み', atk: 0, heal: 30 },
        { name: '渦潮の矛', atk: 28, heal: 2 },
        { name: '蒼泉の奇跡', atk: 14, heal: 18 }
      ],
      skill: {
        name: '蒼泉の再生', cd: 4,
        text: '回復疲労があるときは、それをなくす（この巡から数え直し、回復量が100%に戻る。1戦に1回まで。まだ疲労していないときは消さずに取っておく）。さらに味方前衛全員をそれぞれ回復力×20回復する。',
        effects: [{ type: 'fatigueReset' }, { type: 'heal', amount: 20 }]
      }
    },
    {
      // ★4（合計 HP157＋攻撃の平均26＋回復の平均15＝198）。出目を操る：好きな出目を選ぶスキルと、弱い目（1・2）を強くするリーダー
      id: 'akeboshi', name: '暁星の占星術師', glyph: '星', maxHp: 166, element: 'holy',
      subTypes: ['占星術師', '術士'],
      leaderSkill: { name: '小さき星の加護', text: '出目が1か2のとき、味方の通常技の攻撃の数字+6・回復+6（攻撃0・回復0の技は除く）。', effects: [{ type: 'lowDice', dice: [1, 2], atk: 6, heal: 6 }] },
      trait: { name: '流れ星の追い打ち', text: '追撃：相手の前衛がピンチ（HP3割以下）なら、通常技がもう1回当たる（2回目は1回目の半分）。', effects: [{ type: 'pursuit', percent: 50, under: 30 }] },
      moves: [
        { name: '星屑の矢', atk: 20, heal: 10, fx: { type: 'multi', hits: 3 } },
        { name: '星明かりの祈り', atk: 12, heal: 20 },
        { name: '流星', atk: 24, heal: 4 },
        { name: '星図の導き', atk: 16, heal: 16 },
        { name: '天球の裁き', atk: 26, heal: 0 },
        { name: '暁の癒し', atk: 10, heal: 22 },
        { name: '星降る夜', atk: 26, heal: 0 },
        { name: '明けの明星', atk: 0, heal: 28 },
        { name: '星詠みの舞', atk: 14, heal: 14 }
      ],
      skill: {
        name: '星詠みの宣告', cd: 5,
        text: '確定した出目を、1〜6から好きな数字に変える（使う人が選ぶ）。',
        effects: [{ type: 'chooseDice' }]
      }
    },
    // ---- 自動追加 2026-10-30 ----
    {
      id: 'benitetsu', name: '紅鉄の鍛冶師', glyph: '鉄', maxHp: 140, element: 'fire',
      subTypes: ['鍛冶師', '戦士'],
      leaderSkill: { name: '鍛冶場の熱気', text: '猛火属性の味方の通常技の攻撃の数字+4（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'fire', value: 4 }] },
      trait: { name: '熱いうちに打て', text: '先手：戦闘で自分の陣営の最初のターンだけ、通常技の攻撃1.5倍。', effects: [{ type: 'firstStrike', mult: 1.5 }] },
      moves: [
        { name: '火打ちの槌', atk: 10, heal: 0, fx: { type: 'multi', hits: 3 } },
        { name: '赤熱の一撃', atk: 20, heal: 0 },
        { name: '鍛え抜いた刃', atk: 28, heal: 0 },
        { name: '炉端の休息', atk: 0, heal: 18 },
        { name: '火の粉散らし', atk: 16, heal: 6 },
        { name: '紅鉄の大振り', atk: 30, heal: 0 },
        { name: '鉄槌の構え', atk: 22, heal: 4 },
        { name: '焼き入れ', atk: 0, heal: 22 },
        { name: '灼熱の大槌', atk: 36, heal: 0 }
      ],
      skill: {
        name: '炉の加護', cd: 4,
        text: '味方前衛全員に結界を付ける。さらに、このターンの通常技の攻撃の数字に6を加える（攻撃0の技には加算しない）。',
        effects: [{ type: 'barrier' }, { type: 'atkBonus', value: 6 }]
      }
    },
    {
      id: 'kokuyou', name: '黒曜の騎士', glyph: '曜', maxHp: 125, element: 'dark',
      subTypes: ['騎士', '守護者'],
      leaderSkill: { name: '闇夜の軍旗', text: '呪闇属性の味方の通常技の攻撃の数字+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'dark', value: 5 }] },
      trait: { name: '夜討ち', text: '追撃：相手の前衛がピンチ（HP3割以下）なら、通常技がもう1回当たる（2回目は1回目の半分）。', effects: [{ type: 'pursuit', percent: 50, under: 30 }] },
      moves: [
        { name: '黒曜の剣', atk: 18, heal: 0 },
        { name: '影踏み', atk: 24, heal: 0 },
        { name: '盾打ち', atk: 10, heal: 8 },
        { name: '夜断ち', atk: 29, heal: 0, fx: { type: 'pinch', mult: 2, under: 30 } },
        { name: '静寂の祈り', atk: 0, heal: 24 },
        { name: '闇の突進', atk: 22, heal: 0 },
        { name: '黒曜の盾', atk: 0, heal: 26 },
        { name: '闇裂き', atk: 30, heal: 0 },
        { name: '夜の誓い', atk: 14, heal: 14 }
      ],
      skill: {
        name: '黒曜の断罪', cd: 3,
        text: '敵前衛全員に、それぞれ攻撃力×16のダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 16, ignoreDefense: false }]
      }
    },
    {
      id: 'homurao', name: '焔尾の狐', glyph: '狐', maxHp: 100, element: 'fire',
      subTypes: ['獣', '術士'],
      leaderSkill: { name: '陽だまりの尾', text: '味方全員の通常技の回復の数字+3（回復0の技は除く）。', effects: [{ type: 'healBonus', value: 3 }] },
      moves: [
        { name: '火の玉', atk: 10, heal: 0 },
        { name: '尾払い', atk: 18, heal: 0 },
        { name: '焔の舞', atk: 26, heal: 0 },
        { name: 'ぬくもりの尾', atk: 14, heal: 6 },
        { name: 'ひなたぼっこ', atk: 0, heal: 20 },
        { name: '燃える爪', atk: 20, heal: 0 },
        { name: '狐火', atk: 16, heal: 0 },
        { name: '尾の揺らめき', atk: 0, heal: 16 },
        { name: '九尾の焔', atk: 30, heal: 0 }
      ],
      skill: {
        name: '狐火の舞', cd: 4,
        text: 'このターンの通常技の攻撃を1.5倍にする（回復は変わらない）。',
        effects: [{ type: 'atkMultiplier', value: 1.5 }]
      }
    },
    {
      id: 'kagenui', name: '影縫いの暗殺者', glyph: '影', maxHp: 95, element: 'dark',
      subTypes: ['暗殺者', '影使い'],
      leaderSkill: { name: '暗殺者の心得', text: '味方の固有スキルのダメージの数字+3（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 3 }] },
      moves: [
        { name: '暗器投げ', atk: 11, heal: 0, fx: { type: 'poison', value: 3, turns: 3 } },
        { name: '影走り', atk: 22, heal: 0 },
        { name: '身を潜める', atk: 12, heal: 6 },
        { name: '背後の一刺し', atk: 28, heal: 0 },
        { name: '毒消しの薬', atk: 8, heal: 10 },
        { name: '影の刃', atk: 20, heal: 0 },
        { name: '影縫い', atk: 18, heal: 0 },
        { name: '闇の帳', atk: 0, heal: 18 },
        { name: '刹那の刃', atk: 34, heal: 0 }
      ],
      skill: {
        name: '影縫いの一閃', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×14のダメージ（防御・属性無視）。',
        effects: [{ type: 'damage', amount: 14, ignoreDefense: true }]
      }
    },
    {
      id: 'konami', name: '小波の見習い', glyph: '波', maxHp: 90, element: 'water',
      subTypes: ['見習い', '治癒師'],
      leaderSkill: { name: '見習いの心得', text: '味方全員の最大HPと初期HPを5%上げる（端数切り捨て）。', effects: [{ type: 'maxHp', scope: 'all', percent: 5 }] },
      moves: [
        { name: 'しぶき投げ', atk: 8, heal: 0 },
        { name: '小石の杖', atk: 12, heal: 0 },
        { name: 'せせらぎ', atk: 0, heal: 14 },
        { name: '波打ち', atk: 16, heal: 0 },
        { name: '水の膜', atk: 6, heal: 8 },
        { name: 'ひと泳ぎ', atk: 10, heal: 0 },
        { name: '水はじき', atk: 12, heal: 0 },
        { name: '潮だまり', atk: 0, heal: 14 },
        { name: '大波ごっこ', atk: 20, heal: 0 }
      ],
      skill: {
        name: '小波の癒し', cd: 3,
        text: '味方前衛全員をそれぞれ回復力×15回復する（後衛は回復しない）。',
        effects: [{ type: 'heal', amount: 15 }]
      }
    },
    {
      id: 'tomoshibi', name: '灯火の修道士', glyph: '灯', maxHp: 85, element: 'holy',
      subTypes: ['修道士', '治癒師'],
      leaderSkill: { name: '灯火の導き', text: '味方の固有スキルの回復の数字+3（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 3 }] },
      moves: [
        { name: '灯の棒', atk: 6, heal: 0 },
        { name: 'ささやかな祈り', atk: 10, heal: 6 },
        { name: '灯の癒し', atk: 0, heal: 16 },
        { name: '光の礫', atk: 14, heal: 0 },
        { name: 'ろうそくの温もり', atk: 0, heal: 12 },
        { name: '聖句', atk: 8, heal: 4 },
        { name: '灯の祈り', atk: 0, heal: 18 },
        { name: '小さな光', atk: 10, heal: 4 },
        { name: '聖灯の祝福', atk: 6, heal: 20 }
      ],
      skill: {
        name: '灯火の守り', cd: 4,
        text: '味方前衛全員に結界を付ける（各自、次に受ける防御可能なダメージ1回を半減）。',
        effects: [{ type: 'barrier' }]
      }
    },
    // ---- 自動追加 2026-10-31 ----
    {
      id: 'wakakusa', name: '若草の羊飼い', glyph: '草', maxHp: 92, element: 'nature',
      subTypes: ['牧人'],
      leaderSkill: { name: '牧場の朝', text: '味方全員の通常技の回復の数字+2（回復0の技は除く）。', effects: [{ type: 'healBonus', value: 2 }] },
      moves: [
        { name: '牧杖の一打', atk: 8, heal: 0 },
        { name: '草笛', atk: 0, heal: 8 },
        { name: '羊の頭突き', atk: 12, heal: 0 },
        { name: '草むらの休息', atk: 0, heal: 10 },
        { name: '羊毛の盾', atk: 4, heal: 4 },
        { name: '蹴り上げ', atk: 14, heal: 0 },
        { name: '若草の祈り', atk: 0, heal: 14 },
        { name: '群れの突進', atk: 18, heal: 0 },
        { name: '牧草の恵み', atk: 6, heal: 12 }
      ],
      skill: {
        name: '羊飼いの見張り', cd: 3,
        text: '確定した数字を振り直す（自分の出目のみ）。',
        effects: [{ type: 'reroll' }]
      }
    },
    {
      id: 'okibi', name: '熾火の小鬼', glyph: '熾', maxHp: 88, element: 'fire',
      subTypes: ['小鬼'],
      leaderSkill: { name: '小鬼のいたずら', text: '猛火属性の味方の通常技の攻撃の数字+2（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'fire', value: 2 }] },
      moves: [
        { name: '熾りの爪', atk: 10, heal: 0 },
        { name: '小鬼の引っかき', atk: 8, heal: 0 },
        { name: '熾火投げ', atk: 16, heal: 0 },
        { name: 'うたた寝', atk: 0, heal: 9 },
        { name: '小さな炎', atk: 12, heal: 0 },
        { name: '燃えさし', atk: 6, heal: 3 },
        { name: '熾火の跳躍', atk: 20, heal: 0 },
        { name: '灰かぶり', atk: 0, heal: 12 },
        { name: '火の手', atk: 24, heal: 0 }
      ],
      skill: {
        name: '熾火の悪戯', cd: 3,
        text: '敵前衛全員に、それぞれ攻撃力×10のダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 10, ignoreDefense: false }]
      }
    },
    {
      id: 'amadare', name: '雨垂れの吟遊詩人', glyph: '雨', maxHp: 105, element: 'water',
      subTypes: ['詩人', '術士'],
      leaderSkill: { name: '雨宿りの軒', text: '戦闘開始時、味方前衛全員に結界を付ける。', effects: [{ type: 'startBarrier' }] },
      moves: [
        { name: '雨音の調べ', atk: 0, heal: 12 },
        { name: '水しぶきの弦', atk: 14, heal: 0 },
        { name: '驟雨の歌', atk: 18, heal: 0 },
        { name: '休符', atk: 0, heal: 10 },
        { name: '雨垂れの一撃', atk: 22, heal: 0 },
        { name: '霧雨の旋律', atk: 6, heal: 6 },
        { name: '虹の歌', atk: 0, heal: 18 },
        { name: '豪雨の調べ', atk: 28, heal: 0 },
        { name: '雨上がりの詩', atk: 10, heal: 10 }
      ],
      skill: {
        name: '雨乞いの歌', cd: 4,
        text: '味方前衛全員を、それぞれ回復力×14回復する。',
        effects: [{ type: 'heal', amount: 14 }]
      }
    },
    {
      id: 'yogarasu', name: '夜鴉の占い師', glyph: '鴉', maxHp: 100, element: 'dark',
      subTypes: ['占い師', '術士'],
      leaderSkill: { name: '夜の占い', text: '味方の固有スキルのダメージの数字+2（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 2 }] },
      moves: [
        { name: '鴉の爪', atk: 14, heal: 0 },
        { name: '不吉な予言', atk: 20, heal: 0 },
        { name: '黒羽の舞', atk: 16, heal: 0 },
        { name: '占いの休息', atk: 0, heal: 10 },
        { name: '闇の囁き', atk: 24, heal: 0 },
        { name: '星読み', atk: 0, heal: 6 },
        { name: '夜鴉の群れ', atk: 28, heal: 0 },
        { name: '水晶の癒し', atk: 0, heal: 18 },
        { name: '凶星', atk: 32, heal: 0 }
      ],
      skill: {
        name: '運命の水晶', cd: 3,
        text: '確定した数字を振り直す。さらに、このターンの通常技の攻撃の数字に4を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'reroll' }, { type: 'atkBonus', value: 4 }]
      }
    },
    {
      id: 'hakugin', name: '白銀の聖騎士', glyph: '銀', maxHp: 135, element: 'holy',
      subTypes: ['騎士', '守護者'],
      leaderSkill: { name: '聖騎士団の旗', text: '聖光属性の味方の通常技の攻撃の数字+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'holy', value: 5 }] },
      trait: { name: '白銀の不屈', text: '根性：1戦に1回、倒れるダメージを受けても HP1 で耐える（HP が2以上のとき）。', effects: [{ type: 'guts' }] },
      moves: [
        { name: '銀の剣', atk: 18, heal: 0 },
        { name: '聖なる突き', atk: 24, heal: 0 },
        { name: '祝福の盾', atk: 2, heal: 10, fx: { type: 'guard' } },
        { name: '白銀の斬撃', atk: 28, heal: 0 },
        { name: '癒しの祈り', atk: 0, heal: 20 },
        { name: '銀光の一閃', atk: 22, heal: 0 },
        { name: '聖騎士の誓い', atk: 12, heal: 14 },
        { name: '白銀の裁き', atk: 34, heal: 0 },
        { name: '守りの祈り', atk: 0, heal: 26 }
      ],
      skill: {
        name: '白銀の加護', cd: 4,
        text: '味方前衛全員に結界を付け、それぞれ回復力×10回復する。',
        effects: [{ type: 'barrier' }, { type: 'heal', amount: 10 }]
      }
    },
    {
      id: 'kashimori', name: '樫森の大熊', glyph: '樫', maxHp: 150, element: 'nature',
      subTypes: ['獣', '守護者'],
      leaderSkill: { name: '手負いの咆哮', text: '反撃：味方の誰でも、自分がピンチ（HP3割以下）のとき通常技の攻撃2倍。', effects: [{ type: 'counter', mult: 2, under: 30 }] },
      trait: { name: '大熊の底力', text: '根性：1戦に1回、倒れるダメージを受けても HP1 で耐える（HP が2以上のとき）。', effects: [{ type: 'guts' }] },
      moves: [
        { name: '熊の爪', atk: 16, heal: 0 },
        { name: '樫の一撃', atk: 22, heal: 0 },
        { name: '大地の咆哮', atk: 23, heal: 0, fx: { type: 'pinch', mult: 2, under: 30 } },
        { name: '木の実を食む', atk: 0, heal: 18 },
        { name: 'のしかかり', atk: 30, heal: 0 },
        { name: '森の眠り', atk: 0, heal: 12 },
        { name: '樫の根張り', atk: 8, heal: 16 },
        { name: '大熊の怒り', atk: 36, heal: 0 },
        { name: '蜂蜜の癒し', atk: 0, heal: 24 }
      ],
      skill: {
        name: '森の主の咆哮', cd: 4,
        text: 'このターンの通常技の攻撃を1.4倍にする（敵前衛全員）。',
        effects: [{ type: 'atkMultiplier', value: 1.4 }]
      }
    },
    // ---- 自動追加 2026-11-01 ----
    {
      id: 'kaihiroi', name: '浜辺の貝拾い', glyph: '貝', maxHp: 94, element: 'water',
      subTypes: ['漁師'],
      leaderSkill: { name: '浜の歓迎', text: '味方全員の最大HPと初期HPを4%上げる（端数切り捨て）。', effects: [{ type: 'maxHp', scope: 'all', percent: 4 }] },
      moves: [
        { name: '貝殻投げ', atk: 10, heal: 0 },
        { name: '砂浜の休憩', atk: 0, heal: 9 },
        { name: '網打ち', atk: 12, heal: 0 },
        { name: '潮風の歌', atk: 0, heal: 6 },
        { name: '波よけ', atk: 4, heal: 4 },
        { name: '銛突き', atk: 14, heal: 0 },
        { name: '潮騒の祈り', atk: 0, heal: 14 },
        { name: '大漁の一撃', atk: 18, heal: 0 },
        { name: '浜の恵み', atk: 6, heal: 12 }
      ],
      skill: {
        name: '引き潮', cd: 3,
        text: '味方前衛全員を、それぞれ回復力×10回復する。',
        effects: [{ type: 'heal', amount: 10 }]
      }
    },
    {
      id: 'kuroneko', name: '墓守の黒猫', glyph: '猫', maxHp: 86, element: 'dark',
      subTypes: ['獣'],
      leaderSkill: { name: '夜歩き', text: '味方の固有スキルのダメージの数字+1（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 1 }] },
      moves: [
        { name: '猫パンチ', atk: 10, heal: 0 },
        { name: '闇夜の跳躍', atk: 14, heal: 0 },
        { name: '丸くなる', atk: 0, heal: 8 },
        { name: '爪とぎ', atk: 6, heal: 0 },
        { name: '影の尾', atk: 12, heal: 0 },
        { name: '毛づくろい', atk: 4, heal: 4 },
        { name: '墓場の鳴き声', atk: 18, heal: 0 },
        { name: '月見の昼寝', atk: 0, heal: 12 },
        { name: '九つの命の一撃', atk: 22, heal: 0 }
      ],
      skill: {
        name: '不吉な横切り', cd: 3,
        text: '敵前衛全員に、それぞれ攻撃力×9のダメージ（属性倍率なし・結界を無視）。',
        effects: [{ type: 'damage', amount: 9, ignoreDefense: true }]
      }
    },
    {
      id: 'akatsuki', name: '暁の鐘つき', glyph: '鐘', maxHp: 102, element: 'holy',
      subTypes: ['僧侶'],
      leaderSkill: { name: '朝告げの鐘', text: '味方の固有スキルの回復の数字+2（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 2 }] },
      moves: [
        { name: '鐘の響き', atk: 12, heal: 0 },
        { name: '朝の祈り', atk: 0, heal: 12 },
        { name: '鐘槌', atk: 18, heal: 0 },
        { name: '暁光', atk: 8, heal: 6 },
        { name: '夜明けの一打', atk: 20, heal: 0 },
        { name: '鐘楼の休息', atk: 0, heal: 10 },
        { name: '黎明の鐘', atk: 26, heal: 0 },
        { name: '祝福の音色', atk: 0, heal: 18 },
        { name: '大鐘の轟き', atk: 10, heal: 10 }
      ],
      skill: {
        name: '目覚めの鐘', cd: 3,
        text: 'このターンの通常技の攻撃の数字に5を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'atkBonus', value: 5 }]
      }
    },
    {
      id: 'enbu', name: '炎舞の踊り子', glyph: '舞', maxHp: 104, element: 'fire',
      subTypes: ['踊り子'],
      leaderSkill: { name: '舞台の熱気', text: '猛火属性の味方の通常技の攻撃の数字+3（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'fire', value: 3 }] },
      moves: [
        { name: '火の扇', atk: 14, heal: 0 },
        { name: '炎のステップ', atk: 18, heal: 0 },
        { name: '情熱の舞', atk: 22, heal: 0 },
        { name: '一息の休憩', atk: 0, heal: 10 },
        { name: '火輪の回転', atk: 12, heal: 4 },
        { name: '喝采', atk: 0, heal: 6 },
        { name: '紅蓮の舞台', atk: 28, heal: 0 },
        { name: '拍手の癒し', atk: 0, heal: 18 },
        { name: '焔の旋回', atk: 32, heal: 0 }
      ],
      skill: {
        name: '熱狂の舞', cd: 4,
        text: 'このターンの通常技の攻撃を1.3倍にする（敵前衛全員）。',
        effects: [{ type: 'atkMultiplier', value: 1.3 }]
      }
    },
    {
      id: 'fukashio', name: '深潮の槍騎士', glyph: '槍', maxHp: 140, element: 'water',
      subTypes: ['騎士', '戦士'],
      leaderSkill: { name: '潮騎士の号令', text: '水脈属性の味方の通常技の攻撃の数字+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'water', value: 5 }] },
      trait: { name: '先駆けの槍', text: '先手：戦闘で自分の陣営の最初のターンだけ、通常技の攻撃1.5倍。', effects: [{ type: 'firstStrike', mult: 1.5 }] },
      moves: [
        { name: '潮槍の突き', atk: 20, heal: 0 },
        { name: '渦の薙ぎ', atk: 19, heal: 0, fx: { type: 'weaken', stat: 'atk', percent: 25, turns: 2 } },
        { name: '深海の構え', atk: 0, heal: 18 },
        { name: '激流の一撃', atk: 28, heal: 0 },
        { name: '波の盾', atk: 8, heal: 10 },
        { name: '潮流の穿ち', atk: 22, heal: 0 },
        { name: '大海嘯', atk: 34, heal: 0 },
        { name: '潮の加護', atk: 12, heal: 14 },
        { name: '海神の癒し', atk: 0, heal: 26 }
      ],
      skill: {
        name: '渦潮の陣', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×12のダメージ（属性倍率なし・結界は有効）。さらに味方前衛全員に結界を付ける。',
        effects: [{ type: 'damage', amount: 12, ignoreDefense: false }, { type: 'barrier' }]
      }
    },
    {
      id: 'tenbin', name: '天秤の裁定者', glyph: '秤', maxHp: 125, element: 'holy',
      subTypes: ['裁定者', '術士'],
      leaderSkill: { name: '天秤の加護', text: '味方全員の通常技の攻撃の数字+2（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'all', value: 2 }] },
      trait: { name: '清き天秤', text: '毒に強い：毒にならない。', effects: [{ type: 'poisonResist' }] },
      moves: [
        { name: '裁きの光', atk: 11, heal: 0, fx: { type: 'weaken', stat: 'heal', percent: 25, turns: 2 } },
        { name: '均衡の祈り', atk: 0, heal: 22 },
        { name: '天秤の一撃', atk: 24, heal: 0 },
        { name: '光の鎖', atk: 10, heal: 8 },
        { name: '正義の剣', atk: 26, heal: 0 },
        { name: '公正の光刃', atk: 28, heal: 0 },
        { name: '天の裁き', atk: 34, heal: 0 },
        { name: '慈悲の祈り', atk: 0, heal: 26 },
        { name: '均衡の調べ', atk: 14, heal: 14 }
      ],
      skill: {
        name: '均衡の審判', cd: 4,
        text: '味方前衛全員を、それぞれ回復力×12回復する。さらに、このターンの通常技の攻撃の数字に4を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'heal', amount: 12 }, { type: 'atkBonus', value: 4 }]
      }
    },
    // ---- 自動追加 2026-11-02 ----
    {
      id: 'rouban', name: '炉番の小僧', glyph: '炉', maxHp: 92, element: 'fire',
      subTypes: ['職人'],
      leaderSkill: { name: '火床の熱', text: '味方の固有スキルのダメージの数字+2（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 2 }] },
      moves: [
        { name: '火かき棒', atk: 10, heal: 0 },
        { name: '炉の温もり', atk: 0, heal: 8 },
        { name: 'ふいごの風', atk: 12, heal: 0 },
        { name: '煤まみれ', atk: 4, heal: 0 },
        { name: '火花散らし', atk: 14, heal: 0 },
        { name: '炉端の居眠り', atk: 0, heal: 6 },
        { name: '赤熱の一打', atk: 18, heal: 0 },
        { name: '炭火の癒し', atk: 0, heal: 13 },
        { name: '鉄打ちの一撃', atk: 12, heal: 6 }
      ],
      skill: {
        name: '火の番', cd: 3,
        text: 'このターンの通常技の攻撃の数字に6を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'atkBonus', value: 6 }]
      }
    },
    {
      id: 'kinokogari', name: '茸狩りの少女', glyph: '茸', maxHp: 88, element: 'nature',
      subTypes: ['森人'],
      leaderSkill: { name: '森の小道', text: '自然属性の味方の通常技の攻撃の数字+2（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'nature', value: 2 }] },
      moves: [
        { name: '胞子まき', atk: 8, heal: 0 },
        { name: '茸のスープ', atk: 0, heal: 10 },
        { name: '枝打ち', atk: 12, heal: 0 },
        { name: '森の深呼吸', atk: 0, heal: 7 },
        { name: '毒茸の罠', atk: 14, heal: 0 },
        { name: '落ち葉の寝床', atk: 3, heal: 5 },
        { name: '大茸の一撃', atk: 18, heal: 0 },
        { name: '森の滋養', atk: 0, heal: 14 },
        { name: '胞子の嵐', atk: 10, heal: 8 }
      ],
      skill: {
        name: '眠り胞子', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×8のダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 8, ignoreDefense: false }]
      }
    },
    {
      id: 'ningyoshi', name: '月影の人形師', glyph: '傀', maxHp: 108, element: 'dark',
      subTypes: ['術士', '職人'],
      leaderSkill: { name: '操り糸の宴', text: '呪闇属性の味方の通常技の攻撃の数字+3（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'dark', value: 3 }] },
      moves: [
        { name: '糸繰り', atk: 14, heal: 0 },
        { name: '人形の盾', atk: 4, heal: 8 },
        { name: '呪い針', atk: 18, heal: 0 },
        { name: '繕いの糸', atk: 0, heal: 14 },
        { name: '操り踊り', atk: 16, heal: 0 },
        { name: '影糸縛り', atk: 12, heal: 0 },
        { name: '千本糸', atk: 24, heal: 0 },
        { name: '夜なべの繕い', atk: 0, heal: 20 },
        { name: '傀儡の舞', atk: 18, heal: 8 }
      ],
      skill: {
        name: '糸の結界', cd: 4,
        text: '味方前衛全員に結界を付ける。さらに、このターンの通常技の攻撃の数字に4を加える（攻撃0の技には加算しない）。',
        effects: [{ type: 'barrier' }, { type: 'atkBonus', value: 4 }]
      }
    },
    {
      id: 'tsutayumi', name: '蔦絡みの弓手', glyph: '蔦', maxHp: 112, element: 'nature',
      subTypes: ['狩人'],
      leaderSkill: { name: '緑陰の陣', text: '味方全員の最大HPと初期HPを6%上げる（端数切り捨て）。', effects: [{ type: 'maxHp', scope: 'all', percent: 6 }] },
      moves: [
        { name: '蔦の矢', atk: 14, heal: 0 },
        { name: '若葉の手当', atk: 0, heal: 12 },
        { name: '絡みつく蔦', atk: 16, heal: 0 },
        { name: '木陰の休息', atk: 0, heal: 8 },
        { name: '棘の矢雨', atk: 18, heal: 0 },
        { name: '樹液の湿布', atk: 6, heal: 6 },
        { name: '大樹の剛弓', atk: 26, heal: 0 },
        { name: '森の息吹', atk: 0, heal: 20 },
        { name: '蔦の結び目', atk: 14, heal: 10 }
      ],
      skill: {
        name: '狙い澄まし', cd: 4,
        text: '確定した数字を振り直す。さらに、このターンの通常技の攻撃の数字に3を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'reroll' }, { type: 'atkBonus', value: 3 }]
      }
    },
    {
      id: 'kagerou', name: '陽炎の剣舞士', glyph: '陽', maxHp: 132, element: 'fire',
      subTypes: ['戦士', '踊り手'],
      leaderSkill: { name: '陽炎の逆襲', text: '反撃：味方の誰でも、自分がピンチ（HP3割以下）のとき通常技の攻撃2倍。', effects: [{ type: 'counter', mult: 2, under: 30 }] },
      trait: { name: '一番の舞', text: '先手：戦闘で自分の陣営の最初のターンだけ、通常技の攻撃1.5倍。', effects: [{ type: 'firstStrike', mult: 1.5 }] },
      moves: [
        { name: '陽炎斬り', atk: 22, heal: 0 },
        { name: '熱砂の舞', atk: 16, heal: 0, fx: { type: 'multi', hits: 3 } },
        { name: '揺らめく守り', atk: 6, heal: 12 },
        { name: '灼熱の突き', atk: 26, heal: 0 },
        { name: '蜃気楼', atk: 0, heal: 16 },
        { name: '火輪', atk: 20, heal: 4 },
        { name: '炎天の大刃', atk: 34, heal: 0 },
        { name: '夕凪の癒し', atk: 0, heal: 24 },
        { name: '陽炎乱舞', atk: 22, heal: 10 }
      ],
      skill: {
        name: '幻の剣舞', cd: 4,
        text: 'このターンの通常技の攻撃を1.5倍にする（回復は変わらない）。',
        effects: [{ type: 'atkMultiplier', value: 1.5 }]
      }
    },
    {
      id: 'watashimori', name: '冥府の渡し守', glyph: '冥', maxHp: 145, element: 'dark',
      subTypes: ['船頭', '霊媒'],
      leaderSkill: { name: '彼岸の灯', text: '味方の固有スキルのダメージの数字+4（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 4 }] },
      trait: { name: '冥府の水', text: '毒に強い：毒にならない。', effects: [{ type: 'poisonResist' }] },
      moves: [
        { name: '櫂の一撃', atk: 20, heal: 0 },
        { name: '魂送りの歌', atk: 0, heal: 18 },
        { name: '冥き水底', atk: 24, heal: 0 },
        { name: '渡し賃', atk: 8, heal: 8 },
        { name: '霊火', atk: 14, heal: 0, fx: { type: 'drain', percent: 30 } },
        { name: '黄泉の霧', atk: 10, heal: 6 },
        { name: '冥府の大渦', atk: 32, heal: 0 },
        { name: '鎮魂の調べ', atk: 0, heal: 26 },
        { name: '三途の灯', atk: 16, heal: 12 }
      ],
      skill: {
        name: '魂の渡し', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×14のダメージ（属性倍率なし・結界は有効）。さらに味方前衛全員をそれぞれ回復力×10回復する。',
        effects: [{ type: 'damage', amount: 14, ignoreDefense: false }, { type: 'heal', amount: 10 }]
      }
    },
    // ---- 自動追加 2026-11-03 ----
    {
      id: 'shiodamari', name: '潮溜まりの漁り子', glyph: '漁', maxHp: 90, element: 'water',
      subTypes: ['漁師'],
      leaderSkill: { name: '潮騒の励まし', text: '水脈属性の味方の通常技の攻撃の数字+2（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'water', value: 2 }] },
      moves: [
        { name: '浜石つぶて', atk: 9, heal: 0 },
        { name: '潮水の手当', atk: 0, heal: 9 },
        { name: '網すくい', atk: 12, heal: 0 },
        { name: '貝殻の笛', atk: 0, heal: 6 },
        { name: '銛の稽古', atk: 14, heal: 0 },
        { name: '浜昼寝', atk: 2, heal: 4 },
        { name: '大網漁', atk: 18, heal: 0 },
        { name: '潮の子守唄', atk: 0, heal: 13 },
        { name: '波乗り突き', atk: 11, heal: 7 }
      ],
      skill: {
        name: '潮しぶき', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×7のダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 7, ignoreDefense: false }]
      }
    },
    {
      id: 'hanakanmuri', name: '花冠の見習い巫女', glyph: '冠', maxHp: 95, element: 'holy',
      subTypes: ['巫女'],
      leaderSkill: { name: '花冠の祝福', text: '味方全員の最大HPと初期HPを3%上げる（端数切り捨て）。', effects: [{ type: 'maxHp', scope: 'all', percent: 3 }] },
      moves: [
        { name: '花びら散らし', atk: 8, heal: 0 },
        { name: '祈りの花', atk: 0, heal: 10 },
        { name: '見習いの灯', atk: 11, heal: 0 },
        { name: '花の香り', atk: 0, heal: 8 },
        { name: '聖花の棘', atk: 12, heal: 0 },
        { name: '花冠の加護', atk: 3, heal: 3 },
        { name: '光の花弾', atk: 17, heal: 0 },
        { name: '満開の祈り', atk: 0, heal: 15 },
        { name: '花吹雪', atk: 10, heal: 8 }
      ],
      skill: {
        name: '花の癒し', cd: 3,
        text: '味方前衛全員を、それぞれ回復力×9回復する。',
        effects: [{ type: 'heal', amount: 9 }]
      }
    },
    {
      id: 'kirisame', name: '霧雨の薬売り', glyph: '薬', maxHp: 110, element: 'water',
      subTypes: ['薬師', '旅人'],
      leaderSkill: { name: '雨上がりの香', text: '味方の固有スキルの回復の数字+2（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 2 }] },
      moves: [
        { name: '霧の小瓶', atk: 12, heal: 0 },
        { name: '潤いの薬', atk: 0, heal: 14 },
        { name: '雨粒の針', atk: 16, heal: 0 },
        { name: '霧吹き', atk: 4, heal: 8 },
        { name: '水薬の投擲', atk: 18, heal: 0 },
        { name: '軒先の一服', atk: 0, heal: 6 },
        { name: '豪雨の瓶', atk: 24, heal: 0 },
        { name: '秘伝の霊薬', atk: 0, heal: 22 },
        { name: '霧雨の帳', atk: 12, heal: 12 }
      ],
      skill: {
        name: '霧雨の調合', cd: 4,
        text: '味方前衛全員を、それぞれ回復力×14回復する。さらに、このターンの通常技の攻撃の数字に3を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'heal', amount: 14 }, { type: 'atkBonus', value: 3 }]
      }
    },
    {
      id: 'hakuyoku', name: '白翼の伝令', glyph: '翼', maxHp: 114, element: 'holy',
      subTypes: ['騎士', '伝令'],
      leaderSkill: { name: '白翼の行軍', text: '聖光属性の味方の通常技の攻撃の数字+3（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'holy', value: 3 }] },
      moves: [
        { name: '羽根の矢', atk: 15, heal: 0 },
        { name: '白き祈り', atk: 0, heal: 12 },
        { name: '急降下', atk: 18, heal: 0 },
        { name: '羽ばたきの風', atk: 8, heal: 0 },
        { name: '伝令の槍', atk: 16, heal: 0 },
        { name: '翼の盾', atk: 4, heal: 6 },
        { name: '天翔ける一閃', atk: 26, heal: 0 },
        { name: '癒しの羽音', atk: 0, heal: 20 },
        { name: '白翼の舞', atk: 16, heal: 8 }
      ],
      skill: {
        name: '急ぎの報せ', cd: 3,
        text: '確定した数字を振り直す。さらに、このターンの通常技の攻撃の数字に2を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'reroll' }, { type: 'atkBonus', value: 2 }]
      }
    },
    {
      id: 'ishiban', name: '苔むす庭の石番', glyph: '石', maxHp: 158, element: 'nature',
      subTypes: ['守護者', '石像'],
      leaderSkill: { name: '苔庭の静けさ', text: '味方全員の最大HPと初期HPを7%上げる（端数切り捨て）。', effects: [{ type: 'maxHp', scope: 'all', percent: 7 }] },
      trait: { name: '苔むす石の心', text: '根性：1戦に1回、倒れるダメージを受けても HP1 で耐える（HP が2以上のとき）。', effects: [{ type: 'guts' }] },
      moves: [
        { name: '石拳', atk: 18, heal: 0 },
        { name: '苔の癒し', atk: 0, heal: 16 },
        { name: '岩落とし', atk: 22, heal: 0 },
        { name: '根の守り', atk: 6, heal: 10 },
        { name: '大地の震え', atk: 15, heal: 0, fx: { type: 'weaken', stat: 'atk', percent: 25, turns: 2 } },
        { name: '静かな瞑想', atk: 0, heal: 12 },
        { name: '巨岩崩し', atk: 32, heal: 0 },
        { name: '古苔の息吹', atk: 0, heal: 26 },
        { name: '石庭の守り', atk: 14, heal: 14 }
      ],
      skill: {
        name: '石の守り', cd: 4,
        text: '味方前衛全員に結界を付ける。さらに、このターンの通常技の攻撃の数字に5を加える（攻撃0の技には加算しない）。',
        effects: [{ type: 'barrier' }, { type: 'atkBonus', value: 5 }]
      }
    },
    {
      id: 'kyuuketsu', name: '夜霧の吸血姫', glyph: '血', maxHp: 128, element: 'dark',
      subTypes: ['王族', '魔物'],
      leaderSkill: { name: '紅き夜会', text: '呪闇属性の味方の通常技の攻撃の数字+4（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'dark', value: 4 }] },
      trait: { name: '血の匂い', text: '追撃：相手の前衛がピンチ（HP3割以下）なら、通常技がもう1回当たる（2回目は1回目の半分）。', effects: [{ type: 'pursuit', percent: 50, under: 30 }] },
      moves: [
        { name: '吸血の牙', atk: 18, heal: 0, fx: { type: 'drain', percent: 30 } },
        { name: '血の契り', atk: 6, heal: 10 },
        { name: '夜霧の爪', atk: 24, heal: 0 },
        { name: '蝙蝠の群れ', atk: 18, heal: 0 },
        { name: '深紅の口づけ', atk: 10, heal: 8 },
        { name: '月下の休息', atk: 0, heal: 14 },
        { name: '紅月の饗宴', atk: 34, heal: 0 },
        { name: '不死の眠り', atk: 0, heal: 24 },
        { name: '血霧の舞', atk: 20, heal: 10 }
      ],
      skill: {
        name: '血の渇き', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×16のダメージ（属性倍率なし・結界は有効）。さらに味方前衛全員をそれぞれ回復力×6回復する。',
        effects: [{ type: 'damage', amount: 16, ignoreDefense: false }, { type: 'heal', amount: 6 }]
      }
    },
    // ---- 自動追加 2026-11-04 ----
    {
      id: 'kataribe', name: '森番の語り部', glyph: '語', maxHp: 94, element: 'nature',
      subTypes: ['語り部'],
      leaderSkill: { name: '語らいの輪', text: '味方全員の通常技の回復の数字+1（回復0の技は除く）。', effects: [{ type: 'healBonus', value: 1 }] },
      moves: [
        { name: '薪くべ', atk: 9, heal: 0 },
        { name: '森の昔話', atk: 0, heal: 9 },
        { name: '落ち葉払い', atk: 12, heal: 0 },
        { name: '温もりの輪', atk: 0, heal: 7 },
        { name: '松ぼっくり投げ', atk: 13, heal: 0 },
        { name: '木霊の声', atk: 3, heal: 3 },
        { name: '倒木の一撃', atk: 18, heal: 0 },
        { name: '炉辺の夜話', atk: 0, heal: 14 },
        { name: '森祭りの踊り', atk: 11, heal: 7 }
      ],
      skill: {
        name: '森の言い伝え', cd: 3,
        text: 'このターンの通常技の攻撃の数字に5を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'atkBonus', value: 5 }]
      }
    },
    {
      id: 'sentakumusume', name: '川辺の洗濯娘', glyph: '洗', maxHp: 88, element: 'water',
      subTypes: ['村人'],
      leaderSkill: { name: '洗いたての朝', text: '味方全員の最大HPと初期HPを4%上げる（端数切り捨て）。', effects: [{ type: 'maxHp', scope: 'all', percent: 4 }] },
      moves: [
        { name: '洗濯棒', atk: 10, heal: 0 },
        { name: '冷たい水', atk: 0, heal: 10 },
        { name: '水しぶき', atk: 12, heal: 0 },
        { name: '干し布の陰', atk: 0, heal: 6 },
        { name: '桶投げ', atk: 14, heal: 0 },
        { name: '川面のうたた寝', atk: 2, heal: 4 },
        { name: '激流の洗い', atk: 18, heal: 0 },
        { name: '清流の癒し', atk: 0, heal: 14 },
        { name: '泡の舞', atk: 10, heal: 8 }
      ],
      skill: {
        name: '洗い流し', cd: 3,
        text: '味方前衛全員を、それぞれ回復力×8回復する。',
        effects: [{ type: 'heal', amount: 8 }]
      }
    },
    {
      id: 'hanabishi', name: '花火師の弟子', glyph: '火', maxHp: 106, element: 'fire',
      subTypes: ['職人'],
      leaderSkill: { name: '夏祭りの夜', text: '猛火属性の味方の通常技の攻撃の数字+3（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'fire', value: 3 }] },
      moves: [
        { name: '爆竹', atk: 16, heal: 0 },
        { name: '打ち上げ', atk: 18, heal: 0 },
        { name: '火薬の調合', atk: 0, heal: 10 },
        { name: '線香花火', atk: 6, heal: 6 },
        { name: '尺玉', atk: 20, heal: 0 },
        { name: '煙の幕', atk: 0, heal: 8 },
        { name: '大輪の花火', atk: 28, heal: 0 },
        { name: '夜空の癒し', atk: 0, heal: 18 },
        { name: '連発花火', atk: 18, heal: 6 }
      ],
      skill: {
        name: '仕掛け花火', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×10のダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 10, ignoreDefense: false }]
      }
    },
    {
      id: 'jufu', name: '呪符の書生', glyph: '符', maxHp: 112, element: 'dark',
      subTypes: ['術士', '学者'],
      leaderSkill: { name: '墨染めの夜', text: '味方の固有スキルのダメージの数字+2（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 2 }] },
      moves: [
        { name: '呪符投げ', atk: 14, heal: 0 },
        { name: '護符の守り', atk: 2, heal: 10 },
        { name: '黒墨の筆', atk: 16, heal: 0 },
        { name: '写経', atk: 0, heal: 12 },
        { name: '祟りの印', atk: 18, heal: 0 },
        { name: '夜更かし', atk: 6, heal: 0 },
        { name: '大呪符', atk: 24, heal: 0 },
        { name: '清めの札', atk: 0, heal: 20 },
        { name: '符術乱舞', atk: 16, heal: 8 }
      ],
      skill: {
        name: '封じの札', cd: 4,
        text: '味方前衛全員に結界を付ける。さらに、このターンの通常技の攻撃の数字に2を加える（攻撃0の技には加算しない）。',
        effects: [{ type: 'barrier' }, { type: 'atkBonus', value: 2 }]
      }
    },
    {
      id: 'hyouga', name: '氷河の狩人', glyph: '氷', maxHp: 138, element: 'water',
      subTypes: ['狩人'],
      leaderSkill: { name: '雪原の行軍', text: '水脈属性の味方の通常技の攻撃の数字+4（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'water', value: 4 }] },
      trait: { name: '獲物を追う', text: '追撃：相手の前衛がピンチ（HP3割以下）なら、通常技がもう1回当たる（2回目は1回目の半分）。', effects: [{ type: 'pursuit', percent: 50, under: 30 }] },
      moves: [
        { name: '氷の槍', atk: 22, heal: 0 },
        { name: '雪解け水', atk: 0, heal: 14 },
        { name: '吹雪の矢', atk: 19, heal: 0, fx: { type: 'weaken', stat: 'atk', percent: 25, turns: 2 } },
        { name: '氷の盾', atk: 8, heal: 8 },
        { name: '凍てつく一撃', atk: 26, heal: 0 },
        { name: '白い息', atk: 0, heal: 12 },
        { name: '氷河崩し', atk: 34, heal: 0 },
        { name: '雪原の癒し', atk: 0, heal: 24 },
        { name: '氷晶の舞', atk: 20, heal: 12 }
      ],
      skill: {
        name: '獲物の見極め', cd: 4,
        text: '確定した数字を振り直す。さらに、このターンの通常技の攻撃の数字に6を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'reroll' }, { type: 'atkBonus', value: 6 }]
      }
    },
    {
      id: 'senpu', name: '紅炎の戦斧士', glyph: '斧', maxHp: 150, element: 'fire',
      subTypes: ['戦士'],
      leaderSkill: { name: '炎斧の誓い', text: '猛火属性の味方の通常技の攻撃の数字+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'fire', value: 5 }] },
      trait: { name: '切り込み隊長', text: '先手：戦闘で自分の陣営の最初のターンだけ、通常技の攻撃1.5倍。', effects: [{ type: 'firstStrike', mult: 1.5 }] },
      moves: [
        { name: '斧振り', atk: 22, heal: 0 },
        { name: '戦士の休息', atk: 0, heal: 14 },
        { name: '炎の薙ぎ払い', atk: 22, heal: 0, fx: { type: 'multi', hits: 3 } },
        { name: '鉄の構え', atk: 6, heal: 10 },
        { name: '火炎斬', atk: 20, heal: 0 },
        { name: '雄叫び', atk: 10, heal: 0 },
        { name: '業炎の大斧', atk: 36, heal: 0 },
        { name: '焚火の手当', atk: 0, heal: 22 },
        { name: '斧の旋風', atk: 22, heal: 10 }
      ],
      skill: {
        name: '戦斧の咆哮', cd: 4,
        text: 'このターンの通常技の攻撃を1.5倍にする（回復は変わらない）。',
        effects: [{ type: 'atkMultiplier', value: 1.5 }]
      }
    },
    // ---- 自動追加 2026-11-05 ----
    {
      id: 'suzufuri', name: '鈴振りの少年僧', glyph: '鈴', maxHp: 92, element: 'holy',
      subTypes: ['僧侶'],
      leaderSkill: { name: '鈴の加護', text: '味方の固有スキルの回復の数字+1（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 1 }] },
      moves: [
        { name: '鈴の音', atk: 8, heal: 0 },
        { name: '合掌', atk: 0, heal: 10 },
        { name: '錫杖つき', atk: 12, heal: 0 },
        { name: '念仏', atk: 0, heal: 7 },
        { name: '托鉢の椀', atk: 13, heal: 0 },
        { name: '小さな祈願', atk: 3, heal: 4 },
        { name: '大鈴の響き', atk: 18, heal: 0 },
        { name: '慈悲の読経', atk: 0, heal: 14 },
        { name: '鈴鳴らしの舞', atk: 10, heal: 8 }
      ],
      skill: {
        name: '清めの鈴', cd: 3,
        text: '味方前衛全員を、それぞれ回復力×10回復する。',
        effects: [{ type: 'heal', amount: 10 }]
      }
    },
    {
      id: 'hachikai', name: '蜂飼いの娘', glyph: '蜂', maxHp: 90, element: 'nature',
      subTypes: ['村人'],
      leaderSkill: { name: '花蜜の恵み', text: '味方全員の通常技の回復の数字+2（回復0の技は除く）。', effects: [{ type: 'healBonus', value: 2 }] },
      moves: [
        { name: '蜂の一刺し', atk: 11, heal: 0 },
        { name: '蜂蜜の壺', atk: 0, heal: 10 },
        { name: '煙いぶし', atk: 9, heal: 0 },
        { name: '花畑の散歩', atk: 0, heal: 6 },
        { name: '蜂の群れ', atk: 14, heal: 0 },
        { name: '蜜蝋の膏薬', atk: 2, heal: 5 },
        { name: '女王蜂の怒り', atk: 18, heal: 0 },
        { name: '黄金の蜜', atk: 0, heal: 14 },
        { name: '羽音の嵐', atk: 11, heal: 7 }
      ],
      skill: {
        name: '蜂の群舞', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×8のダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 8, ignoreDefense: false }]
      }
    },
    {
      id: 'seikatai', name: '聖歌隊の少女', glyph: '歌', maxHp: 108, element: 'holy',
      subTypes: ['歌い手'],
      leaderSkill: { name: '聖歌の響き', text: '味方の固有スキルの回復の数字+3（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 3 }] },
      moves: [
        { name: '讃美歌', atk: 0, heal: 14 },
        { name: '高音の響き', atk: 16, heal: 0 },
        { name: '合唱の波', atk: 14, heal: 0 },
        { name: '鎮めの歌', atk: 4, heal: 8 },
        { name: '光の旋律', atk: 18, heal: 0 },
        { name: '祝福の鐘歌', atk: 0, heal: 10 },
        { name: '天上の合唱', atk: 24, heal: 0 },
        { name: '癒しの子守歌', atk: 0, heal: 22 },
        { name: '輪唱の舞', atk: 12, heal: 12 }
      ],
      skill: {
        name: '聖歌の調べ', cd: 4,
        text: '味方前衛全員を、それぞれ回復力×16回復する。',
        effects: [{ type: 'heal', amount: 16 }]
      }
    },
    {
      id: 'touzoku', name: '月夜の盗賊', glyph: '盗', maxHp: 110, element: 'dark',
      subTypes: ['盗賊'],
      leaderSkill: { name: '盗賊団の掟', text: '呪闇属性の味方の通常技の攻撃の数字+3（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'dark', value: 3 }] },
      moves: [
        { name: '短剣の一閃', atk: 12, heal: 0, fx: { type: 'drain', percent: 30 } },
        { name: '盗み食い', atk: 0, heal: 10 },
        { name: '背後からの突き', atk: 18, heal: 0 },
        { name: '煙玉', atk: 4, heal: 6 },
        { name: '投げナイフ', atk: 14, heal: 0 },
        { name: '闇に潜む', atk: 0, heal: 8 },
        { name: '急所狙い', atk: 26, heal: 0 },
        { name: '隠れ家の休息', atk: 0, heal: 18 },
        { name: '屋根伝いの逃走', atk: 16, heal: 8 }
      ],
      skill: {
        name: '早業', cd: 4,
        text: 'このターンの通常技の攻撃の数字に7を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'atkBonus', value: 7 }]
      }
    },
    {
      id: 'ooshika', name: '白樺の大鹿', glyph: '鹿', maxHp: 152, element: 'nature',
      subTypes: ['獣', '守護者'],
      leaderSkill: { name: '白樺の森', text: '味方の固有スキルの回復の数字+4（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 4 }] },
      trait: { name: '森の主の意地', text: '根性：1戦に1回、倒れるダメージを受けても HP1 で耐える（HP が2以上のとき）。', effects: [{ type: 'guts' }] },
      moves: [
        { name: '角の突進', atk: 22, heal: 0 },
        { name: '若芽の癒し', atk: 0, heal: 16 },
        { name: '蹄の一撃', atk: 20, heal: 0 },
        { name: '樹皮の鎧', atk: 0, heal: 10, fx: { type: 'guard' } },
        { name: '角払い', atk: 24, heal: 0 },
        { name: '森の静寂', atk: 0, heal: 12 },
        { name: '大角の怒り', atk: 32, heal: 0 },
        { name: '白樺の祝福', atk: 0, heal: 26 },
        { name: '鹿の跳躍', atk: 18, heal: 12 }
      ],
      skill: {
        name: '森の守り手', cd: 4,
        text: '味方前衛全員を、それぞれ回復力×18回復する。さらに、このターンの通常技の攻撃の数字に4を加える（敵前衛全員・攻撃0の技には加算しない）。',
        effects: [{ type: 'heal', amount: 18 }, { type: 'atkBonus', value: 4 }]
      }
    },
    {
      id: 'sabakuou', name: '灼熱の砂漠王', glyph: '砂', maxHp: 140, element: 'fire',
      subTypes: ['王族', '戦士'],
      leaderSkill: { name: '砂漠の覇気', text: '戦闘開始時、味方前衛全員に結界を付ける（各自、次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'startBarrier' }] },
      trait: { name: '砂漠の王の体', text: '毒に強い：毒にならない。', effects: [{ type: 'poisonResist' }] },
      moves: [
        { name: '砂嵐', atk: 20, heal: 0 },
        { name: 'オアシスの水', atk: 0, heal: 14 },
        { name: '熱砂の刃', atk: 24, heal: 0 },
        { name: '王の威厳', atk: 8, heal: 8 },
        { name: '灼熱の陽射し', atk: 17, heal: 0, fx: { type: 'poison', value: 3, turns: 3 } },
        { name: '日除けの天幕', atk: 0, heal: 10 },
        { name: '砂漠の大嵐', atk: 34, heal: 0 },
        { name: '王家の秘薬', atk: 0, heal: 24 },
        { name: '砂塵の舞', atk: 20, heal: 12 }
      ],
      skill: {
        name: '王の号令', cd: 4,
        text: '敵前衛全員に、それぞれ攻撃力×12のダメージ（属性倍率なし・結界は有効）。さらに、このターンの通常技の攻撃の数字に4を加える（攻撃0の技には加算しない）。',
        effects: [{ type: 'damage', amount: 12, ignoreDefense: false }, { type: 'atkBonus', value: 4 }]
      }
    }
  ];

  /* ---------- 経済（ガチャ・ログインボーナス・報酬） ---------- */
  const ECONOMY = {
    startStones: 300,          // はじめたときの石
    starterCount: 6,           // はじめに持っているキャラ数（ランダム）
    gachaCost: 100,            // 1回
    gacha10Cost: 900,          // 10回まとめて
    duplicateExp: 300,         // 持っているキャラが出たときの経験値
    kakeraExp: 300,            // かけら1個の経験値（どのキャラにも使える。重なったキャラを「かけらにする」と1個）
    limitBreakCrystals: 5,     // 限界突破に使う結晶の数＝これ×(今の上限÷30)（Lv30→5個、Lv60→10個、Lv90→15個…）
    crystal: {                 // 結晶の手に入り方
      floorWin: 1,             // ダンジョンの階を突破するたび
      clear: 2,                // ダンジョンを踏破（2回目以降）
      firstClear: 5,           // ダンジョンを初めて踏破
      matchFirstWin: 3,        // CPU 対戦（ランク戦）の初勝利
      matchWin: 1              // CPU 対戦の2回目以降の勝利
    },
    // 修練の書（2026-11-14〜）：編成の「レベルアップ」で経験値にする素材。ダンジョンの階の突破・踏破、CPU 対戦の勝利で手に入る
    books: {
      bookS: { name: '修練の書・初級', short: '初級', exp: 200 },
      bookM: { name: '修練の書・中級', short: '中級', exp: 1000 },
      bookL: { name: '修練の書・上級', short: '上級', exp: 4000 }
    },
    // 手に入る数。T＝難しさの段（推奨レベル 1〜9 は 1、10〜19 は 2、20〜29 は 3、30〜 は 4）
    //   ダンジョン：1階の突破で初級 1+T、2階で初級 2+T、3階で中級 T。初踏破で中級 T（T が 3 以上なら上級 1）、2回目以降の踏破で初級 1+T
    //   CPU 対戦：勝利で初級 1+T、初勝利なら加えて中級 1
    loginBonus: [50, 50, 80, 50, 50, 80, 200], // 連続ログイン1〜7日目（8日目からまた1日目）
    pvpWinStones: 20,          // 対人戦の勝利報酬
    pvpLoseStones: 5,          // 対人戦の参加報酬（負け）
    pvpRewardsPerDay: 5        // 対人戦の報酬を受け取れる回数（1日）
  };

  /*
   * ---------- ガチャの種類 ----------
   * 値段はどれも同じ（ECONOMY.gachaCost / gacha10Cost）。element があればその属性のキャラだけが出る。
   * どの種類でも、出るキャラの中では全員同じ確率。
   */
  // シリーズ（弾）：キャラの series（無ければ 1）。弾ごとのガチャは、その弾のキャラだけが出る（2026-11-14〜）
  //   limit：その弾に入れるキャラの数の目安（毎日のキャラ作りは、ここまで来たら止める）
  const SERIES = [
    { id: 1, name: '旅立ちの星泉', gacha: 'all' },
    { id: 2, name: '暁の新星', gacha: 's2', limit: 30 }
  ];
  const GACHAS = [
    { id: 'all', series: 1, name: '旅立ちの星泉ガチャ', text: '第1弾のキャラが同じ確率で出ます。' },
    { id: 's2', series: 2, name: '暁の新星ガチャ', text: '第2弾のキャラだけが出ます（その中では全員同じ確率）。' }
  ].concat(Object.keys(ELEMENTS).map(el => ({
    id: el, element: el, name: ELEMENTS[el].name + 'ガチャ', text: `${ELEMENTS[el].name}属性のキャラだけが出ます（すべての弾から。その中では全員同じ確率）。`
  })));

  /*
   * ---------- 対戦（CPUチームとの6対6） ----------
   * 上から順に解放（前の相手に1回勝つと次が開く）。enemies=敵チーム6体、level=敵のレベル、leader=敵リーダー
   * exp=勝利時にチーム6体それぞれが得る経験値（敗北は3割）、firstStones=初勝利の石、stones=2回目以降の勝利の石
   */
  const CPU_MATCHES = [
    { id: 'm1', rank: '見習い', name: '森の入口の一団', enemies: ['suiju', 'gyakufu', 'kohaku', 'raimei', 'gessen', 'mukai'], level: 1, leader: 2, exp: 60, firstStones: 100, stones: 10 },
    { id: 'm2', rank: '見習い', name: '苔むす小道の一団', enemies: ['gyakufu', 'suiju', 'mukai', 'ryogen', 'kohaku', 'gessen'], level: 2, enemyLevel: 1, leader: 0, exp: 80, firstStones: 100, stones: 10 },
    { id: 'm3', rank: '一人前', name: '木霊の泉の一団', enemies: ['mukai', 'gessen', 'suiju', 'raimei', 'gyakufu', 'kohaku'], level: 3, leader: 1, exp: 100, firstStones: 120, stones: 15 },
    { id: 'm4', rank: '一人前', name: '迷い路の一団', enemies: ['ryogen', 'kohaku', 'yoiyami', 'suiju', 'gyakufu', 'mukai'], level: 4, enemyLevel: 3, leader: 0, exp: 130, firstStones: 150, stones: 15 },
    { id: 'm5', rank: '腕利き', name: '森の主の一団', enemies: ['kohaku', 'suiju', 'gyakufu', 'gessen', 'ryogen', 'raimei'], level: 6, leader: 0, exp: 180, firstStones: 300, stones: 20 },
    { id: 'm6', rank: '腕利き', name: '塔の一階の一団', enemies: ['yoiyami', 'raimei', 'gessen', 'ryogen', 'mukai', 'kohaku'], level: 7, leader: 0, exp: 220, firstStones: 150, stones: 20 },
    { id: 'm7', rank: '精鋭', name: '月影の回廊の一団', enemies: ['gessen', 'yoiyami', 'raimei', 'suiju', 'ryogen', 'mukai'], level: 9, leader: 0, exp: 260, firstStones: 180, stones: 25 },
    { id: 'm8', rank: '精鋭', name: '雷鳴の間の一団', enemies: ['raimei', 'ryogen', 'yoiyami', 'kohaku', 'gessen', 'gyakufu'], level: 11, leader: 0, exp: 300, firstStones: 200, stones: 25 },
    { id: 'm9', rank: '達人', name: '虚空の書庫の一団', enemies: ['yoiyami', 'mukai', 'ryogen', 'raimei', 'kohaku', 'suiju'], level: 13, enemyLevel: 12, leader: 3, exp: 350, firstStones: 250, stones: 30 },
    { id: 'm10', rank: '達人', name: '宵闇の頂の一団', enemies: ['yoiyami', 'ryogen', 'raimei', 'gessen', 'kohaku', 'mukai'], level: 16, leader: 4, exp: 400, firstStones: 500, stones: 40 }
  ];

  /*
   * ---------- ダンジョンの敵（ボス） ----------
   * ガチャやチームには出てこない、ダンジョン専用のキャラ。1体で6人のチームと戦う。
   * 形式はキャラクターと同じ（moves は出目1〜6の順、skill は固有スキル）。
   */
  const BOSSES = [
    // 翠の迷い森
    { id: 'b-goblin', name: '苔ゴブリン', glyph: '苔', maxHp: 139, element: 'nature', subTypes: ['クリーチャー', '小鬼'], rank: '雑魚',
      moves: [{ name: 'こん棒', atk: 13, heal: 0 }, { name: 'ひっかき', atk: 10, heal: 0 }, { name: '苔をかじる', atk: 0, heal: 8 }, { name: '体当たり', atk: 17, heal: 0 }, { name: '石つぶて', atk: 12, heal: 0 }, { name: 'めった打ち', atk: 20, heal: 0 }],
      skill: { name: '仲間を呼ぶ声', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×7のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 7 }] } },
    { id: 'b-boar', name: '棘甲の大猪', glyph: '猪', maxHp: 268, element: 'nature', subTypes: ['クリーチャー', '剛力'], rank: '中ボス',
      moves: [{ name: '突進', atk: 22, heal: 0 }, { name: '牙の一撃', atk: 18, heal: 0 }, { name: '泥浴び', atk: 0, heal: 12 }, { name: '棘の背', atk: 19, heal: 0 }, { name: '踏みならし', atk: 16, heal: 0 }, { name: '猛突進', atk: 31, heal: 0 }],
      skill: { name: '怒りの咆哮', cd: 4, text: 'このターンに使う通常技の攻撃を2倍にする。', effects: [{ type: 'atkMultiplier', value: 2 }] } },
    { id: 'b-elder', name: '森の主・古樹ガルム', glyph: '樹', maxHp: 370, element: 'nature', subTypes: ['守護者', '古樹'], rank: '大ボス',
      moves: [{ name: '根の鞭', atk: 29, heal: 0 }, { name: '枝の槍', atk: 37, heal: 0 }, { name: '大地の恵み', atk: 0, heal: 20 }, { name: '木の葉嵐', atk: 32, heal: 0 }, { name: '樹液の盾', atk: 17, heal: 10 }, { name: '大樹の怒り', atk: 49, heal: 0 }],
      skill: { name: '古樹の結界', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    // 霧の海底神殿
    { id: 'b-jelly', name: '霧クラゲ', glyph: '海', maxHp: 170, element: 'water', subTypes: ['クリーチャー'], rank: '雑魚',
      moves: [{ name: 'しびれ触手', atk: 17, heal: 0 }, { name: '泡はじけ', atk: 14, heal: 0 }, { name: 'ただよう', atk: 0, heal: 9 }, { name: '霧の毒', atk: 20, heal: 0 }, { name: '水鉄砲', atk: 15, heal: 0 }, { name: '大放電', atk: 26, heal: 0 }],
      skill: { name: '霧の放電', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×10のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 10 }] } },
    { id: 'b-serpent', name: '渦潮の大海蛇', glyph: '蛇', maxHp: 320, element: 'water', subTypes: ['クリーチャー', '竜'], rank: '中ボス',
      moves: [{ name: '締めつけ', atk: 25, heal: 0 }, { name: '水流ブレス', atk: 29, heal: 0 }, { name: '脱皮', atk: 0, heal: 15 }, { name: '尾の一撃', atk: 22, heal: 0 }, { name: '渦潮', atk: 18, heal: 5 }, { name: '大津波', atk: 40, heal: 0 }],
      skill: { name: '渦の守り', cd: 4, text: '自分を回復力×30回復する。', effects: [{ type: 'heal', amount: 30 }] } },
    { id: 'b-nagi', name: '深淵の海神ナギ', glyph: '凪', maxHp: 460, element: 'water', subTypes: ['神', '王族'], rank: '大ボス',
      moves: [{ name: '深海の槍', atk: 34, heal: 0 }, { name: '潮騒', atk: 27, heal: 5 }, { name: '凪の祈り', atk: 0, heal: 22 }, { name: '大渦', atk: 38, heal: 0 }, { name: '冷たい霧', atk: 23, heal: 0 }, { name: '海神の怒り', atk: 53, heal: 0 }],
      skill: { name: '深淵の波動', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×18のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 18, ignoreDefense: true }] } },
    // 宵闇の塔
    { id: 'b-imp', name: '影の使い魔', glyph: '影', maxHp: 188, element: 'dark', subTypes: ['クリーチャー', '魔術師'], rank: '雑魚',
      moves: [{ name: '影の爪', atk: 19, heal: 0 }, { name: '闇の玉', atk: 15, heal: 0 }, { name: '影に潜む', atk: 0, heal: 10 }, { name: '呪いの針', atk: 24, heal: 0 }, { name: 'いたずら', atk: 10, heal: 3 }, { name: '影の嵐', atk: 29, heal: 0 }],
      skill: { name: '影分身', cd: 3, text: '確定した数字を1回振り直す。', effects: [{ type: 'reroll' }] } },
    { id: 'b-witch', name: '月喰いの魔女', glyph: '魔', maxHp: 367, element: 'dark', subTypes: ['魔術師', '哲学者'], rank: '中ボス',
      moves: [{ name: '月蝕の矢', atk: 31, heal: 0 }, { name: '黒い呪文', atk: 25, heal: 0 }, { name: '生命吸収', atk: 18, heal: 9 }, { name: '星くず', atk: 24, heal: 0 }, { name: '魔力の泉', atk: 0, heal: 15 }, { name: '月喰い', atk: 45, heal: 0 }],
      skill: { name: '虚無の詠唱', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×21のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 21, ignoreDefense: true }] } },
    { id: 'b-maou', name: '星喰いの魔王', glyph: '王', maxHp: 535, element: 'dark', subTypes: ['王族', '魔術師'], rank: '大ボス',
      moves: [{ name: '魔王の剣', atk: 34, heal: 0 }, { name: '暗黒波', atk: 28, heal: 0 }, { name: '闇の玉座', atk: 0, heal: 23 }, { name: '星喰らい', atk: 37, heal: 0 }, { name: '絶望の霧', atk: 19, heal: 6 }, { name: '終焉の一撃', atk: 50, heal: 0 }],
      skill: { name: '魔王の覚醒', cd: 4, text: 'このターンに使う通常技の攻撃を2倍にする。', effects: [{ type: 'atkMultiplier', value: 2 }] } },
    // 紅蓮の火山洞（2026-10-30 自動追加）
    { id: 'b-salamander', name: '火蜥蜴', glyph: '蜥', maxHp: 207, element: 'fire', subTypes: ['クリーチャー', '火竜の子'], rank: '雑魚',
      moves: [{ name: '火の息', atk: 25, heal: 0 }, { name: '尻尾払い', atk: 19, heal: 0 }, { name: '岩陰で休む', atk: 0, heal: 11 }, { name: '火炎弾', atk: 28, heal: 0 }, { name: '噛みつき', atk: 15, heal: 3 }, { name: '溶岩流', atk: 35, heal: 0 }],
      skill: { name: '火の粉の雨', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×13のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 13 }] } },
    { id: 'b-golem', name: '溶岩ゴーレム', glyph: '岩', maxHp: 405, element: 'fire', subTypes: ['守護者', '剛力'], rank: '中ボス',
      moves: [{ name: '溶岩の拳', atk: 38, heal: 0 }, { name: '岩なだれ', atk: 30, heal: 0 }, { name: '冷えて固まる', atk: 0, heal: 16 }, { name: '地響き', atk: 28, heal: 0 }, { name: '火山弾', atk: 24, heal: 5 }, { name: '大噴火', atk: 56, heal: 0 }],
      skill: { name: '溶岩の鎧', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    { id: 'b-dragon', name: '炎竜ヴァルグ', glyph: '竜', maxHp: 503, element: 'fire', subTypes: ['竜', '王族'], rank: '大ボス',
      moves: [{ name: '竜の爪', atk: 38, heal: 0 }, { name: '灼熱の吐息', atk: 31, heal: 0 }, { name: '鱗の再生', atk: 0, heal: 20 }, { name: '炎の翼', atk: 41, heal: 0 }, { name: '焦土', atk: 23, heal: 5 }, { name: '終末の業火', atk: 57, heal: 0 }],
      skill: { name: '業火の息吹', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×25のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 25, ignoreDefense: true }] } },
    // 白亜の天空神殿（2026-11-06）
    { id: 'b-cherub', name: '迷い羽の天使見習い', glyph: '羽', maxHp: 267, element: 'holy', subTypes: ['天使'], rank: '雑魚',
      moves: [{ name: '光の小矢', atk: 23, heal: 0 }, { name: '翼打ち', atk: 19, heal: 0 }, { name: '雲の上で休む', atk: 0, heal: 12 }, { name: '聖光弾', atk: 27, heal: 0 }, { name: 'つつき', atk: 14, heal: 3 }, { name: '天の雷', atk: 32, heal: 0 }],
      skill: { name: '聖なる光雨', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×18のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 18 }] } },
    { id: 'b-paladin', name: '神殿の石像騎士', glyph: '像', maxHp: 427, element: 'holy', subTypes: ['守護者', '騎士'], rank: '中ボス',
      moves: [{ name: '聖剣の一撃', atk: 35, heal: 0 }, { name: '大盾の突進', atk: 29, heal: 0 }, { name: '石の祈り', atk: 0, heal: 17 }, { name: '光の槍', atk: 27, heal: 0 }, { name: '守りの構え', atk: 22, heal: 5 }, { name: '天罰の剣', atk: 49, heal: 0 }],
      skill: { name: '聖盾の加護', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    { id: 'b-seraph', name: '熾天使ルミエル', glyph: '光', maxHp: 534, element: 'holy', subTypes: ['天使', '王族'], rank: '大ボス',
      moves: [{ name: '熾光の剣', atk: 35, heal: 0 }, { name: '審判の光', atk: 29, heal: 0 }, { name: '六翼の癒し', atk: 0, heal: 21 }, { name: '六翼の嵐', atk: 38, heal: 0 }, { name: '浄化の焔', atk: 21, heal: 5 }, { name: '終焉の福音', atk: 51, heal: 0 }],
      skill: { name: '天上の裁き', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×33のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 33, ignoreDefense: true }] } },
    // 亡霊の古城（2026-11-07）
    { id: 'b-wisp', name: 'さまよう鬼火', glyph: '燐', maxHp: 263, element: 'dark', subTypes: ['亡霊'], rank: '雑魚',
      moves: [{ name: '青い火の粉', atk: 21, heal: 0 }, { name: 'すり抜け', atk: 18, heal: 0 }, { name: '墓石に宿る', atk: 0, heal: 13 }, { name: '冷たい炎', atk: 27, heal: 0 }, { name: 'まとわりつく', atk: 13, heal: 4 }, { name: '燐光の渦', atk: 30, heal: 0 }],
      skill: { name: '鬼火の群れ', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×18のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 18 }] } },
    { id: 'b-armor', name: '呪われた黒甲冑', glyph: '鎧', maxHp: 446, element: 'dark', subTypes: ['亡霊', '騎士'], rank: '中ボス',
      moves: [{ name: '錆びた大剣', atk: 34, heal: 0 }, { name: '鉄靴の蹴り', atk: 27, heal: 0 }, { name: '怨念の修復', atk: 0, heal: 17 }, { name: '黒鉄の槌', atk: 26, heal: 0 }, { name: '盾で押す', atk: 20, heal: 5 }, { name: '処刑の一閃', atk: 48, heal: 0 }],
      skill: { name: '呪鎧の構え', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    { id: 'b-lich', name: '不死王ネクロス', glyph: '骸', maxHp: 538, element: 'dark', subTypes: ['亡霊', '王族'], rank: '大ボス',
      moves: [{ name: '死霊の杖', atk: 32, heal: 0 }, { name: '骨の槍', atk: 30, heal: 0 }, { name: '魂を喰らう', atk: 15, heal: 12 }, { name: '冥府の炎', atk: 37, heal: 0 }, { name: '命の吸い取り', atk: 21, heal: 6 }, { name: '永遠の眠り', atk: 51, heal: 0 }],
      skill: { name: '死者の行進', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×30のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 30, ignoreDefense: true }] } },
    // 蒼氷の大氷河（2026-11-08）
    { id: 'b-icicle', name: 'つららの小妖精', glyph: '氷', maxHp: 276, element: 'water', subTypes: ['妖精'], rank: '雑魚',
      moves: [{ name: '氷のつぶて', atk: 22, heal: 0 }, { name: 'こごえる息', atk: 19, heal: 0 }, { name: '雪にもぐる', atk: 0, heal: 13 }, { name: 'つらら落とし', atk: 28, heal: 0 }, { name: '霜のいたずら', atk: 14, heal: 4 }, { name: '吹雪の舞', atk: 32, heal: 0 }],
      skill: { name: '細雪の嵐', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×18のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 18 }] } },
    { id: 'b-icebear', name: '氷河の大白熊', glyph: '熊', maxHp: 470, element: 'water', subTypes: ['クリーチャー', '剛力'], rank: '中ボス',
      moves: [{ name: '氷爪の一撃', atk: 35, heal: 0 }, { name: '体当たり氷塊', atk: 28, heal: 0 }, { name: '雪で傷を冷やす', atk: 0, heal: 18 }, { name: '凍てつく咆哮', atk: 27, heal: 0 }, { name: '分厚い毛皮', atk: 21, heal: 5 }, { name: '氷山砕き', atk: 51, heal: 0 }],
      skill: { name: '白銀の毛皮', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    { id: 'b-icequeen', name: '氷の女王セルシア', glyph: '雪', maxHp: 564, element: 'water', subTypes: ['王族', '魔術師'], rank: '大ボス',
      moves: [{ name: '氷晶の剣', atk: 33, heal: 0 }, { name: '霜の槍', atk: 31, heal: 0 }, { name: '氷の玉座', atk: 0, heal: 22 }, { name: '絶対零度', atk: 39, heal: 0 }, { name: '雪華の舞', atk: 22, heal: 6 }, { name: '永久凍土', atk: 53, heal: 0 }],
      skill: { name: '白き終焉', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×31のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 31, ignoreDefense: true }] } },
    // 毒霧の大湿原（2026-11-09）
    { id: 'b-bogfrog', name: 'ぬかるみの大蛙', glyph: '蛙', maxHp: 265, element: 'nature', subTypes: ['クリーチャー'], rank: '雑魚',
      moves: [{ name: '舌の一撃', atk: 21, heal: 0 }, { name: '泥はね', atk: 17, heal: 0 }, { name: '沼にひたる', atk: 0, heal: 14 }, { name: '毒の唾', atk: 18, heal: 0, fx: { type: 'poison', value: 3, turns: 3 } }, { name: 'のしかかり跳び', atk: 14, heal: 4 }, { name: '大跳躍', atk: 30, heal: 0 }],
      skill: { name: '毒沼の泡', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×16のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 16 }] } },
    { id: 'b-mantis', name: '翠刃の大蟷螂', glyph: '鎌', maxHp: 447, element: 'nature', subTypes: ['クリーチャー', '剣士'], rank: '中ボス',
      moves: [{ name: '大鎌の一閃', atk: 33, heal: 0 }, { name: '鎌の連撃', atk: 27, heal: 0, fx: { type: 'multi', hits: 3 } }, { name: '葉陰に潜む', atk: 0, heal: 18 }, { name: '刈り取り', atk: 26, heal: 0 }, { name: '構え直し', atk: 19, heal: 5 }, { name: '断ち切りの鎌', atk: 48, heal: 0 }],
      skill: { name: '翠刃の構え', cd: 4, text: 'このターンに使う通常技の攻撃を1.5倍にする。', effects: [{ type: 'atkMultiplier', value: 1.5 }] } },
    { id: 'b-hydra', name: '沼の主ヒュドラ', glyph: '蛇', maxHp: 539, element: 'nature', subTypes: ['竜', '王族'], rank: '大ボス',
      moves: [{ name: '三つ首の噛みつき', atk: 31, heal: 0, fx: { type: 'multi', hits: 3 } }, { name: '毒霧の息', atk: 27, heal: 0, fx: { type: 'poison', value: 3, turns: 3 } }, { name: '首の再生', atk: 0, heal: 24 }, { name: '尾の薙ぎ払い', atk: 37, heal: 0 }, { name: '沼の生命', atk: 21, heal: 6, fx: { type: 'drain', percent: 30 } }, { name: '大湿原の怒り', atk: 50, heal: 0 }],
      skill: { name: '腐蝕の大毒霧', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×27のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 27, ignoreDefense: true }] } },
    // 灼砂の王墓（2026-11-10）
    { id: 'b-scorpion', name: '灼砂の大サソリ', glyph: '蠍', maxHp: 259, element: 'fire', subTypes: ['クリーチャー'], rank: '雑魚',
      moves: [{ name: 'はさみ打ち', atk: 20, heal: 0 }, { name: '砂かけ', atk: 17, heal: 0 }, { name: '砂にもぐる', atk: 0, heal: 14 }, { name: '毒針', atk: 18, heal: 0, fx: { type: 'poison', value: 3, turns: 3 } }, { name: '尾の払い', atk: 14, heal: 4 }, { name: '灼熱の一刺し', atk: 30, heal: 0 }],
      skill: { name: '熱砂の嵐', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×16のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 16 }] } },
    { id: 'b-sphinx', name: '炎眼のスフィンクス', glyph: '獅', maxHp: 435, element: 'fire', subTypes: ['守護者', '獣'], rank: '中ボス',
      moves: [{ name: '獅子の爪', atk: 32, heal: 0 }, { name: '謎かけの眼光', atk: 24, heal: 0, fx: { type: 'weaken', stat: 'atk', percent: 25, turns: 2 } }, { name: '砂の守り', atk: 0, heal: 19 }, { name: '翼の烈風', atk: 26, heal: 0 }, { name: '石の構え', atk: 19, heal: 5 }, { name: '炎眼の咆哮', atk: 47, heal: 0 }],
      skill: { name: '王墓の封印', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    { id: 'b-pharaoh', name: '灼陽王ネフェルカ', glyph: '陽', maxHp: 527, element: 'fire', subTypes: ['王族', '亡霊'], rank: '大ボス',
      moves: [{ name: '黄金の王笏', atk: 33, heal: 0 }, { name: '太陽の連弾', atk: 30, heal: 0, fx: { type: 'multi', hits: 3 } }, { name: '不死の包帯', atk: 0, heal: 25 }, { name: '灼光の裁き', atk: 38, heal: 0 }, { name: '王の生気', atk: 21, heal: 6, fx: { type: 'drain', percent: 30 } }, { name: '日輪の怒り', atk: 52, heal: 0 }],
      skill: { name: '灼陽の大審判', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×27のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 27, ignoreDefense: true }] } },
    // 雷鳴の霊峰（2026-11-11）
    { id: 'b-swallow', name: '雷つばめ', glyph: '燕', maxHp: 259, element: 'holy', subTypes: ['クリーチャー', '鳥'], rank: '雑魚',
      moves: [{ name: '電光のくちばし', atk: 21, heal: 0 }, { name: '稲妻急降下', atk: 17, heal: 0 }, { name: '雲間で休む', atk: 0, heal: 14 }, { name: 'しびれ羽', atk: 18, heal: 0, fx: { type: 'weaken', stat: 'atk', percent: 25, turns: 2 } }, { name: 'つばめ返し', atk: 14, heal: 4 }, { name: '雷光一閃', atk: 30, heal: 0 }],
      skill: { name: '群れ稲光', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×16のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 16 }] } },
    { id: 'b-raikoki', name: '雷鼓の鬼', glyph: '鼓', maxHp: 440, element: 'holy', subTypes: ['鬼', '剛力'], rank: '中ボス',
      moves: [{ name: '金棒の一撃', atk: 32, heal: 0 }, { name: '雷鼓の乱れ打ち', atk: 27, heal: 0, fx: { type: 'multi', hits: 3 } }, { name: '雲上の瞑想', atk: 0, heal: 19 }, { name: '稲光の拳', atk: 26, heal: 0 }, { name: '鬼の踏ん張り', atk: 19, heal: 5 }, { name: '轟雷の大太鼓', atk: 47, heal: 0 }],
      skill: { name: '怒りの連打', cd: 4, text: 'このターンに使う通常技の攻撃を1.5倍にする。', effects: [{ type: 'atkMultiplier', value: 1.5 }] } },
    { id: 'b-raiga', name: '天雷の神獣ライガ', glyph: '獣', maxHp: 505, element: 'holy', subTypes: ['神獣', '王族'], rank: '大ボス',
      moves: [{ name: '雷爪の一閃', atk: 33, heal: 0 }, { name: '落雷の連撃', atk: 30, heal: 0, fx: { type: 'multi', hits: 3 } }, { name: '雷光の結界', atk: 0, heal: 22, fx: { type: 'guard' } }, { name: '霹靂の牙', atk: 38, heal: 0 }, { name: '手負いの雷撃', atk: 24, heal: 0, fx: { type: 'pinch', mult: 2, under: 30 } }, { name: '天地鳴動', atk: 52, heal: 0 }],
      skill: { name: '万雷の裁き', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×27のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 27, ignoreDefense: true }] } },
    // 蝕月の宮殿（2026-11-12・1 周目のおわり）
    { id: 'b-moth', name: '月喰い蛾', glyph: '蛾', maxHp: 268, element: 'dark', subTypes: ['クリーチャー', '虫'], rank: '雑魚',
      moves: [{ name: '黒い羽ばたき', atk: 21, heal: 0 }, { name: '鱗粉まき', atk: 17, heal: 0 }, { name: '月影で眠る', atk: 0, heal: 14 }, { name: '鱗粉吸い', atk: 19, heal: 0, fx: { type: 'drain', percent: 30 } }, { name: 'まとわり羽', atk: 14, heal: 4 }, { name: '闇夜の乱舞', atk: 31, heal: 0 }],
      skill: { name: '眠りの鱗粉', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×17のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 17 }] } },
    { id: 'b-gargoyle', name: '夜石のガーゴイル', glyph: '番', maxHp: 455, element: 'dark', subTypes: ['守護者', '魔物'], rank: '中ボス',
      moves: [{ name: '石爪の一撃', atk: 33, heal: 0 }, { name: '急降下の体当たり', atk: 28, heal: 0 }, { name: '石に戻る', atk: 0, heal: 14, fx: { type: 'guard' } }, { name: '翼の打ち下ろし', atk: 27, heal: 0 }, { name: '尖塔に留まる', atk: 19, heal: 5 }, { name: '夜空の落石', atk: 49, heal: 0 }],
      skill: { name: '宮殿の番人', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    { id: 'b-noctia', name: '蝕月の女帝ノクティア', glyph: '蝕', maxHp: 545, element: 'dark', subTypes: ['王族', '魔術師'], rank: '大ボス',
      moves: [{ name: '新月の大鎌', atk: 33, heal: 0 }, { name: '欠けゆく月光', atk: 29, heal: 0, fx: { type: 'multi', hits: 3 } }, { name: '満ちる月の癒し', atk: 0, heal: 25 }, { name: '影縫いの呪い', atk: 24, heal: 0, fx: { type: 'weaken', stat: 'heal', percent: 25, turns: 2 } }, { name: '夜の生気', atk: 20, heal: 6, fx: { type: 'drain', percent: 30 } }, { name: '皆既の帳', atk: 53, heal: 0 }],
      skill: { name: '永夜の蝕', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×26のダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 26, ignoreDefense: true }] } },
    // 潮騒の入り江（2026-11-13・2 周目のはじまり）
    { id: 'b-crab', name: '浜辺の小ガニ', glyph: '蟹', maxHp: 139, element: 'water', subTypes: ['クリーチャー'], rank: '雑魚',
      moves: [{ name: 'はさみ挟み', atk: 13, heal: 0 }, { name: '横歩き突撃', atk: 10, heal: 0 }, { name: '砂に隠れる', atk: 0, heal: 8 }, { name: '泡ふき', atk: 17, heal: 0 }, { name: '貝がら飛ばし', atk: 12, heal: 0 }, { name: '大ばさみ', atk: 20, heal: 0 }],
      skill: { name: '潮だまりの群れ', cd: 4, text: '敵前衛全員に、それぞれ攻撃力×7のダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 7 }] } },
    { id: 'b-octopus', name: '岩場の大ダコ', glyph: '蛸', maxHp: 268, element: 'water', subTypes: ['クリーチャー', '海の獣'], rank: '中ボス',
      moves: [{ name: '足の巻きつき', atk: 22, heal: 0 }, { name: '八本足の連打', atk: 16, heal: 0, fx: { type: 'multi', hits: 3 } }, { name: 'たこつぼに潜る', atk: 0, heal: 12 }, { name: '墨はき', atk: 19, heal: 0 }, { name: '吸盤の一撃', atk: 16, heal: 0 }, { name: '大渦の締めつけ', atk: 31, heal: 0 }],
      skill: { name: '墨の煙幕', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    { id: 'b-turtle', name: '入り江の主・千年亀', glyph: '亀', maxHp: 335, element: 'water', subTypes: ['守護者', '海の獣'], rank: '大ボス',
      moves: [{ name: '甲羅の体当たり', atk: 29, heal: 0 }, { name: '大波よび', atk: 37, heal: 0 }, { name: '潮の恵み', atk: 0, heal: 20 }, { name: '水しぶき砲', atk: 32, heal: 0 }, { name: '甲羅にこもる', atk: 17, heal: 10 }, { name: '千年の大津波', atk: 49, heal: 0 }],
      skill: { name: '満ち潮の怒り', cd: 4, text: 'このターンに使う通常技の攻撃を1.5倍にする。', effects: [{ type: 'atkMultiplier', value: 1.5 }] } }
  ];

  /*
   * ---------- ダンジョン（3階層：雑魚 → 中ボス → 大ボス） ----------
   * 6人のチームで、1体ずつ3回戦う。HPと戦闘不能は次の階層に引き継ぐ（階層の間に生存キャラが少し回復）。
   * floors: boss=敵（BOSSES の id）、level=敵のレベル、exp=勝利時にチーム6体それぞれが得る経験値
   * clearStones=大ボスまで倒したときの石（初回は firstClearStones）、requires=解放条件（そのダンジョンを踏破）
   */
  const DUNGEON_RULES = {
    healBetweenFloorsPercent: 20, // 階層の間に、生存キャラが最大HPの何%回復するか
    loseExpPercent: 30            // 負けた階層でもらえる経験値（%）
  };
  const DUNGEONS = [
    { id: 'forest', name: '翠の迷い森', text: '木々がささやく、はじまりの森。', recommend: 'Lv1〜', requires: null, firstClearStones: 300, clearStones: 40,
      floors: [{ boss: 'b-goblin', level: 1, exp: 50 }, { boss: 'b-boar', level: 2, exp: 80 }, { boss: 'b-elder', level: 5, exp: 140 }] },
    { id: 'sea', name: '霧の海底神殿', text: '霧に沈んだ、海神をまつる神殿。', recommend: 'Lv5〜', requires: 'forest', firstClearStones: 400, clearStones: 60,
      floors: [{ boss: 'b-jelly', level: 6, exp: 120 }, { boss: 'b-serpent', level: 7, exp: 180 }, { boss: 'b-nagi', level: 8, exp: 280 }] },
    { id: 'tower', name: '宵闇の塔', text: '星を喰らう魔王が棲む、夜の塔。', recommend: 'Lv10〜', requires: 'sea', firstClearStones: 600, clearStones: 80,
      floors: [{ boss: 'b-imp', level: 9, exp: 220 }, { boss: 'b-witch', level: 10, exp: 320 }, { boss: 'b-maou', level: 11, exp: 450 }] },
    { id: 'volcano', name: '紅蓮の火山洞', text: '溶岩が流れる、炎竜の眠る洞窟。', recommend: 'Lv13〜', requires: 'tower', firstClearStones: 650, clearStones: 90,
      floors: [{ boss: 'b-salamander', level: 12, exp: 260 }, { boss: 'b-golem', level: 13, exp: 380 }, { boss: 'b-dragon', level: 14, exp: 520 }] },
    { id: 'skytemple', name: '白亜の天空神殿', text: '雲の上に浮かぶ、天使たちの神殿。', recommend: 'Lv16〜', requires: 'volcano', firstClearStones: 700, clearStones: 100,
      floors: [{ boss: 'b-cherub', level: 15, exp: 300 }, { boss: 'b-paladin', level: 16, exp: 420 }, { boss: 'b-seraph', level: 17, exp: 580 }] },
    { id: 'ghostkeep', name: '亡霊の古城', text: '霧の谷に沈む、死者たちの城。', recommend: 'Lv16〜', requires: 'volcano', firstClearStones: 700, clearStones: 100,
      floors: [{ boss: 'b-wisp', level: 15, exp: 300 }, { boss: 'b-armor', level: 16, exp: 420 }, { boss: 'b-lich', level: 17, exp: 580 }] },
    { id: 'glacier', name: '蒼氷の大氷河', text: '分かれ道の先で一つになる、凍てつく氷の大地。', recommend: 'Lv20〜', requires: ['skytemple', 'ghostkeep'], firstClearStones: 800, clearStones: 110,
      floors: [{ boss: 'b-icicle', level: 19, exp: 340 }, { boss: 'b-icebear', level: 20, exp: 480 }, { boss: 'b-icequeen', level: 21, exp: 660 }] },
    { id: 'marsh', name: '毒霧の大湿原', text: '毒の霧が立ちこめる、底なしの沼地。', recommend: 'Lv24〜', requires: 'glacier', firstClearStones: 900, clearStones: 120,
      floors: [{ boss: 'b-bogfrog', level: 23, exp: 380 }, { boss: 'b-mantis', level: 24, exp: 530 }, { boss: 'b-hydra', level: 25, exp: 730 }] },
    { id: 'tomb', name: '灼砂の王墓', text: '熱砂に眠る、太陽王の古い墓所。', recommend: 'Lv27〜', requires: 'marsh', firstClearStones: 950, clearStones: 130,
      floors: [{ boss: 'b-scorpion', level: 26, exp: 410 }, { boss: 'b-sphinx', level: 27, exp: 570 }, { boss: 'b-pharaoh', level: 28, exp: 790 }] },
    { id: 'thunderpeak', name: '雷鳴の霊峰', text: '稲妻が絶えず落ちる、雲の上の霊峰。', recommend: 'Lv27〜', requires: 'marsh', firstClearStones: 950, clearStones: 130,
      floors: [{ boss: 'b-swallow', level: 26, exp: 410 }, { boss: 'b-raikoki', level: 27, exp: 570 }, { boss: 'b-raiga', level: 28, exp: 790 }] },
    { id: 'eclipse', name: '蝕月の宮殿', text: '分かれ道の先で一つになる、月が欠けたまま昇らない夜の宮殿。', recommend: 'Lv30〜', requires: ['tomb', 'thunderpeak'], firstClearStones: 1000, clearStones: 140,
      floors: [{ boss: 'b-moth', level: 29, exp: 440 }, { boss: 'b-gargoyle', level: 30, exp: 610 }, { boss: 'b-noctia', level: 31, exp: 850 }] },
    { id: 'cove', name: '潮騒の入り江', text: '波の音がひびく、岩場と砂浜の入り江。', recommend: 'Lv1〜', requires: 'forest', firstClearStones: 300, clearStones: 40,
      floors: [{ boss: 'b-crab', level: 1, exp: 50 }, { boss: 'b-octopus', level: 2, exp: 80 }, { boss: 'b-turtle', level: 5, exp: 140 }] }
  ];

  const Data = { CONFIG, ELEMENTS, ELEMENT_ADVANTAGE, RANKS, CHARACTERS, ECONOMY, SERIES, GACHAS, CPU_MATCHES, BOSSES, DUNGEON_RULES, DUNGEONS };

  if (typeof module === 'object' && module.exports) module.exports = Data;
  else global.RikuyouData = Data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
