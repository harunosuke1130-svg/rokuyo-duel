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
      max: 30,                 // 最大レベル
      hpPercentPerLevel: 4,    // 1レベルごとの最大HP上昇（基礎値に対する%）
      atkPerLevel: 1,          // 1レベルごとの通常技の攻撃加算（攻撃0の技は除く）
      expBase: 100,            // Lv1→2 に必要な経験値
      expStep: 50,             // 以降1レベルごとに必要経験値が増える量
      moveUnlock: [3, 6, 10],  // 技の候補の7・8・9個目が使えるようになるレベル（1〜6個目は最初から）
      powerPerLevel: 1         // 1レベルごとに技力の上限が上がる量
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
   * skill.effects の種類:
   *   atkMultiplier {value}          このターンの通常技の攻撃を value 倍
   *   atkBonus      {value}          このターンの通常技の攻撃に加算（攻撃0の技には加算しない）
   *   heal          {amount}         味方の生存前衛全員をそれぞれ回復
   *   barrier                        味方の生存前衛全員に結界（すでに持つキャラは変化なし）
   *   reroll                         確定した数字を振り直す
   *   damage        {amount, ignoreDefense}  敵の生存前衛全員にそれぞれ直接ダメージ（属性倍率なし）
   *   fatigueReset  {rounds}         味方の回復疲労をなくす（この巡から数え直し。回復量が100%に戻る）。rounds があればその巡数ぶんだけ戻す。
   *                                  1戦に1回まで（陣営ごと。2回目以降は何もしない）。heal より前に書くと、その回復にも効く
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
    },
    {
      // ★4（合計 HP168＋攻撃の平均12＋回復の平均16＝196）。回復役：疲労を消すスキル（1戦に1回）と、毎ターン少し回復するリーダー
      // CPU同士300戦の試算：片側だけにいると勝率約62%（★3で最も高い琥珀の守人は約57%）。決着しない戦闘なし
      id: 'aoizumi', name: '蒼泉の聖女', glyph: '蒼', maxHp: 168, element: 'water',
      subTypes: ['聖女', '治癒師'],
      leaderSkill: { name: '泉のめぐみ', text: '自分のターンの開始時に、味方前衛全員をそれぞれ5回復する（回復疲労の影響を受ける）。', effects: [{ type: 'regen', value: 5 }] },
      moves: [
        { name: 'さざ波の杖', atk: 12, heal: 16 },
        { name: '清めの雫', atk: 0, heal: 24 },
        { name: '蒼の波紋', atk: 16, heal: 14 },
        { name: '泉の祈り', atk: 0, heal: 28 },
        { name: '水鏡の一閃', atk: 24, heal: 6 },
        { name: '潮騒の裁き', atk: 20, heal: 8 },
        { name: '霧雨の恵み', atk: 0, heal: 30 },
        { name: '渦潮の矛', atk: 28, heal: 2 },
        { name: '蒼泉の奇跡', atk: 14, heal: 18 }
      ],
      skill: {
        name: '蒼泉の再生', cd: 4,
        text: '味方の回復疲労をなくし（この巡から数え直し、回復量が100%に戻る。1戦に1回まで）、さらに味方前衛全員をそれぞれ20回復する。',
        effects: [{ type: 'fatigueReset' }, { type: 'heal', amount: 20 }]
      }
    },
    // ---- 自動追加 2026-10-30 ----
    {
      id: 'benitetsu', name: '紅鉄の鍛冶師', glyph: '鉄', maxHp: 140, element: 'fire',
      subTypes: ['鍛冶師', '戦士'],
      leaderSkill: { name: '鍛冶場の熱気', text: '猛火属性の味方の通常技の攻撃+4（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'fire', value: 4 }] },
      moves: [
        { name: '火打ちの槌', atk: 12, heal: 0 },
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
        text: '味方前衛全員に結界を付ける。さらに、このターンの通常技の攻撃に6を加える（攻撃0の技には加算しない）。',
        effects: [{ type: 'barrier' }, { type: 'atkBonus', value: 6 }]
      }
    },
    {
      id: 'kokuyou', name: '黒曜の騎士', glyph: '曜', maxHp: 125, element: 'dark',
      subTypes: ['騎士', '守護者'],
      leaderSkill: { name: '闇夜の軍旗', text: '呪闇属性の味方の通常技の攻撃+5（攻撃0の技は除く）。', effects: [{ type: 'atkBonus', scope: 'element', element: 'dark', value: 5 }] },
      moves: [
        { name: '黒曜の剣', atk: 18, heal: 0 },
        { name: '影踏み', atk: 24, heal: 0 },
        { name: '盾打ち', atk: 10, heal: 8 },
        { name: '夜断ち', atk: 32, heal: 0 },
        { name: '静寂の祈り', atk: 0, heal: 24 },
        { name: '闇の突進', atk: 22, heal: 0 },
        { name: '黒曜の盾', atk: 0, heal: 26 },
        { name: '闇裂き', atk: 30, heal: 0 },
        { name: '夜の誓い', atk: 14, heal: 14 }
      ],
      skill: {
        name: '黒曜の断罪', cd: 3,
        text: '敵前衛全員に、それぞれ16ダメージ（属性倍率なし・結界は有効）。',
        effects: [{ type: 'damage', amount: 16, ignoreDefense: false }]
      }
    },
    {
      id: 'homurao', name: '焔尾の狐', glyph: '狐', maxHp: 100, element: 'fire',
      subTypes: ['獣', '術士'],
      leaderSkill: { name: '陽だまりの尾', text: '味方全員の通常技の回復+3（回復0の技は除く）。', effects: [{ type: 'healBonus', value: 3 }] },
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
      leaderSkill: { name: '暗殺者の心得', text: '味方の固有スキルの直接ダメージ+3（対象1体ごと）。', effects: [{ type: 'skillDamageBonus', value: 3 }] },
      moves: [
        { name: '暗器投げ', atk: 16, heal: 0 },
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
        text: '敵前衛全員に、それぞれ14ダメージ（防御・属性無視）。',
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
        text: '味方前衛全員をそれぞれ15回復する（後衛は回復しない）。',
        effects: [{ type: 'heal', amount: 15 }]
      }
    },
    {
      id: 'tomoshibi', name: '灯火の修道士', glyph: '灯', maxHp: 85, element: 'holy',
      subTypes: ['修道士', '治癒師'],
      leaderSkill: { name: '灯火の導き', text: '味方の固有スキルの回復+3（対象1体ごと）。', effects: [{ type: 'skillHealBonus', value: 3 }] },
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
   * ---------- ガチャの種類 ----------
   * 値段はどれも同じ（ECONOMY.gachaCost / gacha10Cost）。element があればその属性のキャラだけが出る。
   * どの種類でも、出るキャラの中では全員同じ確率。
   */
  const GACHAS = [
    { id: 'all', name: '通常ガチャ', text: 'すべてのキャラが同じ確率で出ます。' }
  ].concat(Object.keys(ELEMENTS).map(el => ({
    id: el, element: el, name: ELEMENTS[el].name + 'ガチャ', text: `${ELEMENTS[el].name}属性のキャラだけが出ます（その中では全員同じ確率）。`
  })));

  /*
   * ---------- 対戦（CPUチームとの6対6） ----------
   * 上から順に解放（前の相手に1回勝つと次が開く）。enemies=敵チーム6体、level=敵のレベル、leader=敵リーダー
   * exp=勝利時にチーム6体それぞれが得る経験値（敗北は3割）、firstStones=初勝利の石、stones=2回目以降の勝利の石
   */
  const CPU_MATCHES = [
    { id: 'm1', rank: '見習い', name: '森の入口の一団', enemies: ['suiju', 'gyakufu', 'kohaku', 'raimei', 'gessen', 'mukai'], level: 1, leader: 2, exp: 60, firstStones: 100, stones: 10 },
    { id: 'm2', rank: '見習い', name: '苔むす小道の一団', enemies: ['gyakufu', 'suiju', 'mukai', 'ryogen', 'kohaku', 'gessen'], level: 2, leader: 0, exp: 80, firstStones: 100, stones: 10 },
    { id: 'm3', rank: '一人前', name: '木霊の泉の一団', enemies: ['mukai', 'gessen', 'suiju', 'raimei', 'gyakufu', 'kohaku'], level: 3, leader: 1, exp: 100, firstStones: 120, stones: 15 },
    { id: 'm4', rank: '一人前', name: '迷い路の一団', enemies: ['ryogen', 'kohaku', 'yoiyami', 'suiju', 'gyakufu', 'mukai'], level: 4, leader: 0, exp: 130, firstStones: 150, stones: 15 },
    { id: 'm5', rank: '腕利き', name: '森の主の一団', enemies: ['kohaku', 'suiju', 'gyakufu', 'gessen', 'ryogen', 'raimei'], level: 6, leader: 0, exp: 180, firstStones: 300, stones: 20 },
    { id: 'm6', rank: '腕利き', name: '塔の一階の一団', enemies: ['yoiyami', 'raimei', 'gessen', 'ryogen', 'mukai', 'kohaku'], level: 7, leader: 0, exp: 220, firstStones: 150, stones: 20 },
    { id: 'm7', rank: '精鋭', name: '月影の回廊の一団', enemies: ['gessen', 'yoiyami', 'raimei', 'suiju', 'ryogen', 'mukai'], level: 9, leader: 0, exp: 260, firstStones: 180, stones: 25 },
    { id: 'm8', rank: '精鋭', name: '雷鳴の間の一団', enemies: ['raimei', 'ryogen', 'yoiyami', 'kohaku', 'gessen', 'gyakufu'], level: 11, leader: 0, exp: 300, firstStones: 200, stones: 25 },
    { id: 'm9', rank: '達人', name: '虚空の書庫の一団', enemies: ['yoiyami', 'mukai', 'ryogen', 'raimei', 'kohaku', 'suiju'], level: 13, leader: 3, exp: 350, firstStones: 250, stones: 30 },
    { id: 'm10', rank: '達人', name: '宵闇の頂の一団', enemies: ['yoiyami', 'ryogen', 'raimei', 'gessen', 'kohaku', 'mukai'], level: 16, leader: 4, exp: 400, firstStones: 500, stones: 40 }
  ];

  /*
   * ---------- ダンジョンの敵（ボス） ----------
   * ガチャやチームには出てこない、ダンジョン専用のキャラ。1体で6人のチームと戦う。
   * 形式はキャラクターと同じ（moves は出目1〜6の順、skill は固有スキル）。
   */
  const BOSSES = [
    // 翠の迷い森
    { id: 'b-goblin', name: '苔ゴブリン', glyph: '苔', maxHp: 150, element: 'nature', subTypes: ['クリーチャー', '小鬼'], rank: '雑魚',
      moves: [{ name: 'こん棒', atk: 14, heal: 0 }, { name: 'ひっかき', atk: 11, heal: 0 }, { name: '苔をかじる', atk: 0, heal: 8 }, { name: '体当たり', atk: 18, heal: 0 }, { name: '石つぶて', atk: 13, heal: 0 }, { name: 'めった打ち', atk: 22, heal: 0 }],
      skill: { name: '仲間を呼ぶ声', cd: 4, text: '敵前衛全員に、それぞれ8ダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 8 }] } },
    { id: 'b-boar', name: '棘甲の大猪', glyph: '猪', maxHp: 290, element: 'nature', subTypes: ['クリーチャー', '剛力'], rank: '中ボス',
      moves: [{ name: '突進', atk: 24, heal: 0 }, { name: '牙の一撃', atk: 19, heal: 0 }, { name: '泥浴び', atk: 0, heal: 12 }, { name: '棘の背', atk: 20, heal: 0 }, { name: '踏みならし', atk: 17, heal: 0 }, { name: '猛突進', atk: 34, heal: 0 }],
      skill: { name: '怒りの咆哮', cd: 4, text: 'このターンに使う通常技の攻撃を2倍にする。', effects: [{ type: 'atkMultiplier', value: 2 }] } },
    { id: 'b-elder', name: '森の主・古樹ガルム', glyph: '樹', maxHp: 400, element: 'nature', subTypes: ['守護者', '古樹'], rank: '大ボス',
      moves: [{ name: '根の鞭', atk: 31, heal: 0 }, { name: '枝の槍', atk: 40, heal: 0 }, { name: '大地の恵み', atk: 0, heal: 20 }, { name: '木の葉嵐', atk: 35, heal: 0 }, { name: '樹液の盾', atk: 18, heal: 10 }, { name: '大樹の怒り', atk: 53, heal: 0 }],
      skill: { name: '古樹の結界', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    // 霧の海底神殿
    { id: 'b-jelly', name: '霧クラゲ', glyph: '海', maxHp: 170, element: 'water', subTypes: ['クリーチャー'], rank: '雑魚',
      moves: [{ name: 'しびれ触手', atk: 17, heal: 0 }, { name: '泡はじけ', atk: 14, heal: 0 }, { name: 'ただよう', atk: 0, heal: 9 }, { name: '霧の毒', atk: 20, heal: 0 }, { name: '水鉄砲', atk: 15, heal: 0 }, { name: '大放電', atk: 26, heal: 0 }],
      skill: { name: '霧の放電', cd: 4, text: '敵前衛全員に、それぞれ10ダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 10 }] } },
    { id: 'b-serpent', name: '渦潮の大海蛇', glyph: '蛇', maxHp: 320, element: 'water', subTypes: ['クリーチャー', '竜'], rank: '中ボス',
      moves: [{ name: '締めつけ', atk: 25, heal: 0 }, { name: '水流ブレス', atk: 29, heal: 0 }, { name: '脱皮', atk: 0, heal: 15 }, { name: '尾の一撃', atk: 22, heal: 0 }, { name: '渦潮', atk: 18, heal: 5 }, { name: '大津波', atk: 40, heal: 0 }],
      skill: { name: '渦の守り', cd: 4, text: '自分を30回復する。', effects: [{ type: 'heal', amount: 30 }] } },
    { id: 'b-nagi', name: '深淵の海神ナギ', glyph: '凪', maxHp: 460, element: 'water', subTypes: ['神', '王族'], rank: '大ボス',
      moves: [{ name: '深海の槍', atk: 34, heal: 0 }, { name: '潮騒', atk: 27, heal: 5 }, { name: '凪の祈り', atk: 0, heal: 22 }, { name: '大渦', atk: 38, heal: 0 }, { name: '冷たい霧', atk: 23, heal: 0 }, { name: '海神の怒り', atk: 53, heal: 0 }],
      skill: { name: '深淵の波動', cd: 4, text: '敵前衛全員に、それぞれ18ダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 18, ignoreDefense: true }] } },
    // 宵闇の塔
    { id: 'b-imp', name: '影の使い魔', glyph: '影', maxHp: 180, element: 'dark', subTypes: ['クリーチャー', '魔術師'], rank: '雑魚',
      moves: [{ name: '影の爪', atk: 19, heal: 0 }, { name: '闇の玉', atk: 15, heal: 0 }, { name: '影に潜む', atk: 0, heal: 10 }, { name: '呪いの針', atk: 22, heal: 0 }, { name: 'いたずら', atk: 10, heal: 3 }, { name: '影の嵐', atk: 27, heal: 0 }],
      skill: { name: '影分身', cd: 3, text: '確定した数字を1回振り直す。', effects: [{ type: 'reroll' }] } },
    { id: 'b-witch', name: '月喰いの魔女', glyph: '魔', maxHp: 350, element: 'dark', subTypes: ['魔術師', '哲学者'], rank: '中ボス',
      moves: [{ name: '月蝕の矢', atk: 29, heal: 0 }, { name: '黒い呪文', atk: 23, heal: 0 }, { name: '生命吸収', atk: 18, heal: 9 }, { name: '星くず', atk: 22, heal: 0 }, { name: '魔力の泉', atk: 0, heal: 15 }, { name: '月喰い', atk: 43, heal: 0 }],
      skill: { name: '虚無の詠唱', cd: 4, text: '敵前衛全員に、それぞれ20ダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 20, ignoreDefense: true }] } },
    { id: 'b-maou', name: '星喰いの魔王', glyph: '王', maxHp: 510, element: 'dark', subTypes: ['王族', '魔術師'], rank: '大ボス',
      moves: [{ name: '魔王の剣', atk: 32, heal: 0 }, { name: '暗黒波', atk: 26, heal: 0 }, { name: '闇の玉座', atk: 0, heal: 23 }, { name: '星喰らい', atk: 35, heal: 0 }, { name: '絶望の霧', atk: 19, heal: 6 }, { name: '終焉の一撃', atk: 48, heal: 0 }],
      skill: { name: '魔王の覚醒', cd: 4, text: 'このターンに使う通常技の攻撃を2倍にする。', effects: [{ type: 'atkMultiplier', value: 2 }] } },
    // 紅蓮の火山洞（2026-10-30 自動追加）
    { id: 'b-salamander', name: '火蜥蜴', glyph: '蜥', maxHp: 190, element: 'fire', subTypes: ['クリーチャー', '火竜の子'], rank: '雑魚',
      moves: [{ name: '火の息', atk: 20, heal: 0 }, { name: '尻尾払い', atk: 16, heal: 0 }, { name: '岩陰で休む', atk: 0, heal: 11 }, { name: '火炎弾', atk: 23, heal: 0 }, { name: '噛みつき', atk: 12, heal: 3 }, { name: '溶岩流', atk: 28, heal: 0 }],
      skill: { name: '火の粉の雨', cd: 4, text: '敵前衛全員に、それぞれ10ダメージ（属性倍率なし・結界は有効）。', effects: [{ type: 'damage', amount: 10 }] } },
    { id: 'b-golem', name: '溶岩ゴーレム', glyph: '岩', maxHp: 370, element: 'fire', subTypes: ['守護者', '剛力'], rank: '中ボス',
      moves: [{ name: '溶岩の拳', atk: 30, heal: 0 }, { name: '岩なだれ', atk: 24, heal: 0 }, { name: '冷えて固まる', atk: 0, heal: 16 }, { name: '地響き', atk: 23, heal: 0 }, { name: '火山弾', atk: 19, heal: 5 }, { name: '大噴火', atk: 44, heal: 0 }],
      skill: { name: '溶岩の鎧', cd: 4, text: '自分に結界を付ける（次に受ける防御可能なダメージ1回を半減）。', effects: [{ type: 'barrier' }] } },
    { id: 'b-dragon', name: '炎竜ヴァルグ', glyph: '竜', maxHp: 460, element: 'fire', subTypes: ['竜', '王族'], rank: '大ボス',
      moves: [{ name: '竜の爪', atk: 30, heal: 0 }, { name: '灼熱の吐息', atk: 25, heal: 0 }, { name: '鱗の再生', atk: 0, heal: 20 }, { name: '炎の翼', atk: 33, heal: 0 }, { name: '焦土', atk: 18, heal: 5 }, { name: '終末の業火', atk: 45, heal: 0 }],
      skill: { name: '業火の息吹', cd: 4, text: '敵前衛全員に、それぞれ20ダメージ（防御と属性を無視）。', effects: [{ type: 'damage', amount: 20, ignoreDefense: true }] } }
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
      floors: [{ boss: 'b-salamander', level: 12, exp: 260 }, { boss: 'b-golem', level: 13, exp: 380 }, { boss: 'b-dragon', level: 14, exp: 520 }] }
  ];

  const Data = { CONFIG, ELEMENTS, ELEMENT_ADVANTAGE, RANKS, CHARACTERS, ECONOMY, GACHAS, CPU_MATCHES, BOSSES, DUNGEON_RULES, DUNGEONS };

  if (typeof module === 'object' && module.exports) module.exports = Data;
  else global.RikuyouData = Data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
