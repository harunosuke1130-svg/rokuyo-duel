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
    LOADOUT_POWER_MARGIN: 5,   // 技の入れ替えで、初期構成の技力（攻撃＋回復の合計）をどれだけ超えてよいか
    LEVEL: {
      max: 30,                 // 最大レベル
      hpPercentPerLevel: 4,    // 1レベルごとの最大HP上昇（基礎値に対する%）
      atkPerLevel: 1,          // 1レベルごとの通常技の攻撃加算（攻撃0の技は除く）
      expBase: 100,            // Lv1→2 に必要な経験値
      expStep: 50              // 以降1レベルごとに必要経験値が増える量
    },
    DICE_SIDES: 6,             // 出目の最大値（1〜6）
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
    fire:   { name: '火',   color: '#e2673b' },
    water:  { name: '水',   color: '#3d93d6' },
    nature: { name: '自然', color: '#5fae55' },
    holy:   { name: '聖光', color: '#e8cf6a' },
    dark:   { name: '呪闇', color: '#9a6ad6' }
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
   * skill.effects の種類:
   *   atkMultiplier {value}          このターンの通常技の攻撃を value 倍
   *   atkBonus      {value}          このターンの通常技の攻撃に加算（攻撃0の技には加算しない）
   *   heal          {amount}         味方の生存前衛全員をそれぞれ回復
   *   barrier                        味方の生存前衛全員に結界（すでに持つキャラは変化なし）
   *   reroll                         確定した数字を振り直す
   *   damage        {amount, ignoreDefense}  敵の生存前衛全員にそれぞれ直接ダメージ（属性倍率なし）
   * 通常技の攻撃は「敵の生存前衛全員」、回復は「味方の生存前衛全員」に、それぞれ全量が入ります。
   * subTypes: 副属性（表示・分類のみ。複数追加可）
   */
  const CHARACTERS = [
    {
      id: 'ryogen', name: '燎原の剣士', glyph: '燎', maxHp: 120, element: 'fire',
      subTypes: ['騎士', '剣士'],
      leaderSkill: { name: '騎士団の先陣', text: '味方全員の通常技の攻撃+3（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'all', value: 3 }] },
      moves: [
        { name: '火花', atk: 8, heal: 0 },
        { name: '斬り払い', atk: 14, heal: 0 },
        { name: '紅蓮の一閃', atk: 32, heal: 0 },
        { name: '息を整える', atk: 0, heal: 20 },
        { name: '炎の輪', atk: 22, heal: 0 },
        { name: '燃え尽きる刃', atk: 38, heal: 0 },
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
      leaderSkill: { name: '月泉の加護', text: '味方全員の通常技の回復+4（回復0の技は除く）。', effects: [{ type: 'healBonus', value: 4 }] },
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
        text: '味方前衛全員をそれぞれ35回復する（後衛は回復しない）。',
        effects: [{ type: 'heal', amount: 35 }]
      }
    },
    {
      id: 'gyakufu', name: '逆風の射手', glyph: '風', maxHp: 95, element: 'nature',
      subTypes: ['射手', '風使い'],
      leaderSkill: { name: '追い風の号令', text: '自然属性の味方の通常技の攻撃+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'nature', value: 5 }] },
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
      moves: [
        { name: '岩の拳', atk: 18, heal: 0 },
        { name: '琥珀の槍', atk: 18, heal: 0 },
        { name: '大地の鼓動', atk: 18, heal: 0 },
        { name: '石の刃', atk: 18, heal: 0 },
        { name: '守人の息吹', atk: 10, heal: 20 },
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
      leaderSkill: { name: '虚空の導き', text: '味方の固有スキルの直接ダメージ+5（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 5 }] },
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
        text: '敵前衛全員に、それぞれ20ダメージ（防御・属性を無視）。',
        effects: [{ type: 'damage', amount: 20, ignoreDefense: true }]
      }
    },
    {
      id: 'suiju', name: '翠樹の薬師', glyph: '翠', maxHp: 110, element: 'nature',
      subTypes: ['薬師', '治癒師'],
      leaderSkill: { name: '森の恵み', text: '味方の固有スキルの回復+6（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 6 }] },
      moves: [
        { name: '若葉の薬', atk: 0, heal: 23 },
        { name: '棘の種', atk: 16, heal: 0 },
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
        text: '味方前衛全員をそれぞれ20回復する。さらに、このターンの通常技の攻撃に10を加える（攻撃0の技には加算しない）。',
        effects: [{ type: 'heal', amount: 20 }, { type: 'atkBonus', value: 10 }]
      }
    },
    {
      id: 'raimei', name: '雷鳴の渡り鳥', glyph: '雷', maxHp: 105, element: 'holy',
      subTypes: ['クリーチャー', '雷使い'],
      leaderSkill: { name: '雷雲の先導', text: '聖光属性の味方の通常技の攻撃+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'holy', value: 5 }] },
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
        text: '敵前衛全員に、それぞれ12ダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 12, ignoreDefense: false }]
      }
    },
    {
      id: 'mukai', name: '霧海の旅人', glyph: '霧', maxHp: 130, element: 'water',
      subTypes: ['旅人', '剣士'],
      leaderSkill: { name: '霧の帳', text: '戦闘開始時、味方前衛全員に結界を付ける（各自、次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'startBarrier' }] },
      moves: [
        { name: '潮の剣', atk: 22, heal: 0 },
        { name: '霧の休息', atk: 0, heal: 31 },
        { name: '波の刃', atk: 20, heal: 0 },
        { name: '返し波', atk: 16, heal: 10 },
        { name: '深海の渦', atk: 34, heal: 0 },
        { name: '凪の呼吸', atk: 10, heal: 23 },
        { name: '霧隠れ', atk: 0, heal: 20 },
        { name: '渦潮の刃', atk: 26, heal: 0 },
        { name: 'しぶき', atk: 10, heal: 0 }
      ],
      skill: {
        name: '潮のめぐり', cd: 3,
        text: '敵前衛全員に、それぞれ12ダメージ（属性倍率なし・結界は有効）。さらに味方前衛全員をそれぞれ16回復する。',
        effects: [{ type: 'damage', amount: 12, ignoreDefense: false }, { type: 'heal', amount: 16 }]
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
    loginBonus: [50, 50, 80, 50, 50, 80, 200], // 連続ログイン1〜7日目（8日目からまた1日目）
    pvpWinStones: 20,          // 対人戦の勝利報酬
    pvpLoseStones: 5,          // 対人戦の参加報酬（負け）
    pvpRewardsPerDay: 5        // 対人戦の報酬を受け取れる回数（1日）
  };

  /*
   * ---------- ダンジョン ----------
   * floors: enemies=敵チーム6体、level=敵のレベル、leader=敵リーダー（enemies の番号）
   *         exp=勝利時にチーム6体それぞれが得る経験値、firstStones=初回クリア報酬、stones=2回目以降の報酬
   * requires: 解放条件（そのダンジョンを最後までクリア）
   */
  const DUNGEONS = [
    {
      id: 'forest', name: '翠の迷い森', text: '木々がささやく、はじまりの森。', requires: null,
      floors: [
        { name: '森の入口', enemies: ['suiju', 'gyakufu', 'kohaku', 'raimei', 'gessen', 'mukai'], level: 1, leader: 2, exp: 60, firstStones: 100, stones: 10 },
        { name: '苔むす小道', enemies: ['gyakufu', 'suiju', 'mukai', 'ryogen', 'kohaku', 'gessen'], level: 2, leader: 0, exp: 80, firstStones: 100, stones: 10 },
        { name: '木霊の泉', enemies: ['mukai', 'gessen', 'suiju', 'raimei', 'gyakufu', 'kohaku'], level: 3, leader: 1, exp: 100, firstStones: 120, stones: 15 },
        { name: '迷い路', enemies: ['ryogen', 'kohaku', 'yoiyami', 'suiju', 'gyakufu', 'mukai'], level: 4, leader: 0, exp: 130, firstStones: 150, stones: 15 },
        { name: '森の主', enemies: ['kohaku', 'suiju', 'gyakufu', 'gessen', 'ryogen', 'raimei'], level: 6, leader: 0, exp: 180, firstStones: 300, stones: 20 }
      ]
    },
    {
      id: 'tower', name: '宵闇の塔', text: '星を喰らう魔術師が棲む、夜の塔。', requires: 'forest',
      floors: [
        { name: '塔の一階', enemies: ['yoiyami', 'raimei', 'gessen', 'ryogen', 'mukai', 'kohaku'], level: 7, leader: 0, exp: 220, firstStones: 150, stones: 20 },
        { name: '月影の回廊', enemies: ['gessen', 'yoiyami', 'raimei', 'suiju', 'ryogen', 'mukai'], level: 9, leader: 0, exp: 260, firstStones: 180, stones: 25 },
        { name: '雷鳴の間', enemies: ['raimei', 'ryogen', 'yoiyami', 'kohaku', 'gessen', 'gyakufu'], level: 11, leader: 0, exp: 300, firstStones: 200, stones: 25 },
        { name: '虚空の書庫', enemies: ['yoiyami', 'mukai', 'ryogen', 'raimei', 'kohaku', 'suiju'], level: 13, leader: 3, exp: 350, firstStones: 250, stones: 30 },
        { name: '宵闇の頂', enemies: ['yoiyami', 'ryogen', 'raimei', 'gessen', 'kohaku', 'mukai'], level: 16, leader: 4, exp: 400, firstStones: 500, stones: 40 }
      ]
    }
  ];

  const Data = { CONFIG, ELEMENTS, ELEMENT_ADVANTAGE, CHARACTERS, ECONOMY, DUNGEONS };

  if (typeof module === 'object' && module.exports) module.exports = Data;
  else global.RikuyouData = Data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
