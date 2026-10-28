/*
 * 六耀の決闘 — 戦闘ロジック（画面処理に依存しない）
 * 6体編成・前衛3体／後衛3体。通常技の攻撃は敵の生存前衛全員、回復は味方の生存前衛全員に、それぞれ全量が入る。
 * 状態はすべてプレーンなオブジェクトで、操作関数はルール違反を { ok:false, error } で拒否します。
 * 画面表示用の予測（preview*）と実際の処理は同じ計算関数を使います。
 */
(function (global) {
  'use strict';

  const Data = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./data.js')
    : global.RikuyouData;

  const { CONFIG, ELEMENTS, ELEMENT_ADVANTAGE, CHARACTERS } = Data;
  const SIDES = ['player', 'cpu'];
  // ログに使う陣営の呼び名（CPU戦は「味方／敵」「あなた／相手」、対人戦はプレイヤー名）
  const DEFAULT_LABELS = { player: { team: '味方', who: 'あなた' }, cpu: { team: '敵', who: '相手' } };
  const team = (state, side) => ((state.labels || DEFAULT_LABELS)[side] || DEFAULT_LABELS[side]).team;
  const who = (state, side) => ((state.labels || DEFAULT_LABELS)[side] || DEFAULT_LABELS[side]).who;
  const CHAR_MAP = {};
  CHARACTERS.forEach(c => { CHAR_MAP[c.id] = c; });

  /* ---------- 乱数 ---------- */
  // シード付き乱数（テスト・再現用）。シードなしなら Math.random を使う。
  function createRng(seed) {
    if (seed === undefined || seed === null || seed === '') return Math.random;
    let a = (Number(seed) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rollDie(rng) {
    const r = (rng || Math.random)();
    return Math.min(CONFIG.DICE_SIDES, Math.floor(r * CONFIG.DICE_SIDES) + 1);
  }

  /* ---------- 基本ヘルパー ---------- */
  const opp = side => (side === 'player' ? 'cpu' : 'player');
  const getChar = id => CHAR_MAP[id];
  const unitChar = unit => CHAR_MAP[unit.charId];
  const isAlive = unit => !!unit && unit.hp > 0;
  const unitName = unit => unitChar(unit).name;
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const aliveIndexes = (state, side) =>
    state.teams[side].map((u, i) => (u.hp > 0 ? i : -1)).filter(i => i >= 0);
  const allDown = (state, side) => state.teams[side].every(u => u.hp <= 0);
  const isFront = (state, side, idx) => state.front[side].indexOf(idx) >= 0;
  // 生存している前衛（枠の順）
  const frontAlive = (state, side) => state.front[side].filter(i => isAlive(state.teams[side][i]));
  // 生存している後衛
  const backAlive = (state, side) => aliveIndexes(state, side).filter(i => !isFront(state, side, i));

  /* ---------- 計算 ---------- */
  function hasAdvantage(attackElement, defendElement) {
    const list = ELEMENT_ADVANTAGE[attackElement];
    return !!list && list.indexOf(defendElement) >= 0;
  }

  // 端数処理は最後に1回だけ（四捨五入）。浮動小数の誤差を避けるため整数で計算する。
  const SCALE = 10000;
  function finalizeDamage(amount, advantage, barrier) {
    const adv = advantage ? Math.round(CONFIG.ADVANTAGE_MULTIPLIER * SCALE) : SCALE;
    const def = barrier ? Math.round(CONFIG.BARRIER_MULTIPLIER * SCALE) : SCALE;
    const num = Math.round(amount * SCALE) * adv * def;
    const den = SCALE * SCALE * SCALE;
    return Math.floor((2 * num + den) / (2 * den));
  }

  function healPercent(round) {
    const f = CONFIG.FATIGUE;
    if (round <= f.normalUntilRound) return 100;
    return Math.max(f.minPercent, 100 - f.stepPercent * (round - f.normalUntilRound));
  }

  function fatiguedHeal(base, round) {
    return Math.floor(base * healPercent(round) / 100);
  }

  // 通常技の攻撃を1体分計算：基礎 → 攻撃強化 → 属性倍率（対象ごと）→ 防御効果（対象ごと）→ 四捨五入
  function computeAttack(base, boost, attackerChar, defenderUnit) {
    if (!base || base <= 0 || !defenderUnit) {
      return { base: base || 0, boosted: 0, advantage: false, barrier: false, damage: 0 };
    }
    const mult = boost && boost.mult ? boost.mult : 1;
    const bonus = boost && boost.bonus ? boost.bonus : 0;
    const boosted = base * mult + bonus;
    const advantage = hasAdvantage(attackerChar.element, unitChar(defenderUnit).element);
    const barrier = !!defenderUnit.barrier;
    return { base, boosted, advantage, barrier, damage: finalizeDamage(boosted, advantage, barrier) };
  }

  // スキルの直接ダメージ：属性倍率なし。防御無視なら結界も無視（消費しない）。
  function computeSkillDamage(amount, ignoreDefense, defenderUnit) {
    const barrier = !ignoreDefense && !!defenderUnit.barrier;
    return { base: amount, barrier, damage: finalizeDamage(amount, false, barrier) };
  }

  /* ---------- 技の構成（出目1〜6に割り当てる6技） ---------- */
  // loadout は技の候補（ch.moves）の番号を出目1〜6の順に並べた配列
  const movePower = m => m.atk + m.heal;
  function defaultLoadout(charId) {
    return getChar(charId).moves.slice(0, CONFIG.LOADOUT_SIZE).map((m, i) => i);
  }
  function loadoutPower(charId, loadout) {
    const moves = getChar(charId).moves;
    return loadout.reduce((sum, k) => sum + (moves[k] ? movePower(moves[k]) : 0), 0);
  }
  // 技力の上限 = 初期構成の技力 + CONFIG.LOADOUT_POWER_MARGIN
  function loadoutBudget(charId) {
    return loadoutPower(charId, defaultLoadout(charId)) + CONFIG.LOADOUT_POWER_MARGIN;
  }
  // 構成として正しくない理由（正しければ null）
  function loadoutError(charId, loadout) {
    const c = getChar(charId);
    if (!c) return '不明なキャラクターです';
    if (!Array.isArray(loadout) || loadout.length !== CONFIG.LOADOUT_SIZE) return `技を${CONFIG.LOADOUT_SIZE}個選んでください`;
    if (!loadout.every(k => Number.isInteger(k) && k >= 0 && k < c.moves.length)) return '存在しない技が含まれています';
    if (new Set(loadout).size !== loadout.length) return '同じ技は2回入れられません';
    const power = loadoutPower(charId, loadout);
    const budget = loadoutBudget(charId);
    if (power > budget) return `技力の合計が上限を超えています（${power} / ${budget}）`;
    return null;
  }
  // そのユニットの「出目 dice に対応する技」
  function unitMove(unit, dice) {
    return unitChar(unit).moves[unit.loadout[dice - 1]];
  }

  /* ---------- リーダースキル ---------- */
  function leaderEffects(state, side) {
    const l = state.leader ? state.leader[side] : null;
    if (l === null || l === undefined) return [];
    const ls = unitChar(state.teams[side][l]).leaderSkill;
    return ls ? ls.effects : [];
  }
  function leaderSum(state, side, type) {
    return leaderEffects(state, side).filter(e => e.type === type).reduce((a, e) => a + (e.value || 0), 0);
  }
  function leaderAtkBonus(state, side, attackerChar) {
    return leaderEffects(state, side)
      .filter(e => e.type === 'atkBonus' && (e.scope === 'all' || (e.scope === 'element' && e.element === attackerChar.element)))
      .reduce((a, e) => a + e.value, 0);
  }
  // 通常技の攻撃強化：スキルの倍率・加算（そのターンのみ）＋リーダーの加算
  // 通常技の攻撃強化：スキルの倍率・加算（そのターンのみ）＋リーダーの加算＋レベルの加算
  function attackBoost(state, side, unit) {
    const b = (state.turnSide === side && state.phase === 'action') ? state.boost : { mult: 1, bonus: 0 };
    return { mult: b.mult, bonus: b.bonus + leaderAtkBonus(state, side, unitChar(unit)) + levelAtkBonus(unit.level || 1) };
  }
  // 通常技の回復の基礎値（リーダーの加算込み・疲労補正前）
  function moveHealBase(state, side, move) {
    return move.heal > 0 ? move.heal + leaderSum(state, side, 'healBonus') : 0;
  }

  /* ---------- レベル ---------- */
  function clampLevel(lv) {
    const n = Math.floor(Number(lv) || 1);
    return Math.max(1, Math.min(CONFIG.LEVEL.max, n));
  }
  // レベルによる最大HP（基礎×(100＋上昇率×(Lv−1))%、切り捨て）
  function levelMaxHp(baseHp, lv) {
    return Math.floor(baseHp * (100 + CONFIG.LEVEL.hpPercentPerLevel * (clampLevel(lv) - 1)) / 100);
  }
  // レベルによる通常技の攻撃加算（攻撃0の技には加算しない）
  function levelAtkBonus(lv) {
    return CONFIG.LEVEL.atkPerLevel * (clampLevel(lv) - 1);
  }

  /* ---------- 状態の生成 ---------- */
  function makeUnit(charId, index, loadout, level) {
    const c = getChar(charId);
    if (!c) throw new Error('不明なキャラクター: ' + charId);
    const lo = loadout || defaultLoadout(charId);
    const err = loadoutError(charId, lo);
    if (err) throw new Error(c.name + '：' + err);
    const lv = clampLevel(level);
    const hp = levelMaxHp(c.maxHp, lv);
    return { charId, index, level: lv, hp, maxHp: hp, cd: 0, barrier: false, loadout: lo.slice() };
  }

  function validateTeam(ids) {
    if (!Array.isArray(ids) || ids.length !== CONFIG.TEAM_SIZE) return false;
    if (new Set(ids).size !== ids.length) return false;
    return ids.every(id => !!getChar(id));
  }

  function randomTeam(rng) {
    const ids = CHARACTERS.map(c => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor((rng || Math.random)() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, CONFIG.TEAM_SIZE);
  }

  function freshTurnFlags() {
    return { dice: null, swapUsed: false, skillUsed: false, skillUsedBy: null, moveUsed: false, boost: { mult: 1, bonus: 0 } };
  }

  // opts.loadouts = { player: { charId: [技番号×6] }, cpu: {...} }（省略時は初期構成）
  // opts.levels   = { player: { charId: レベル }, cpu: {...} }（省略時はレベル1）
  // opts.labels   = { player: { team, who }, cpu: { team, who } }（ログの呼び名）
  function createBattle(playerIds, cpuIds, opts) {
    const lo = (opts && opts.loadouts) || {};
    const lv = (opts && opts.levels) || {};
    if (!validateTeam(playerIds) || !validateTeam(cpuIds)) {
      throw new Error('チームは異なる' + CONFIG.TEAM_SIZE + '体で編成してください');
    }
    return Object.assign({
      phase: 'formation',      // formation / initiative / roll / action / replace / over
      turnSide: 'player',
      round: 0,                // 巡（プレイヤーとCPUのターン1回ずつ）
      turnCount: { player: 0, cpu: 0 },
      pendingReplace: null,    // { side, resume: 'endTurn' | 'action', need }
      teams: {
        player: playerIds.map((id, i) => makeUnit(id, i, lo.player && lo.player[id], lv.player && lv.player[id])),
        cpu: cpuIds.map((id, i) => makeUnit(id, i, lo.cpu && lo.cpu[id], lv.cpu && lv.cpu[id]))
      },
      labels: (opts && opts.labels) || DEFAULT_LABELS,
      firstSide: null,         // 先攻（rollInitiative で決まる）
      initiative: null,        // { player: 出目, cpu: 出目, rolls: [[p, c], ...] }
      front: { player: [], cpu: [] }, // 前衛のユニット番号（最大 FRONT_SIZE）
      leader: { player: null, cpu: null }, // リーダーのユニット番号
      winner: null,
      log: [],
      seq: 0
    }, freshTurnFlags());
  }

  /* ---------- ログ ---------- */
  function addLog(state, ctx, text, kind) {
    const entry = { n: state.log.length + 1, round: state.round, side: state.turnSide, kind: kind || 'info', text };
    state.log.push(entry);
    ctx.logs.push(entry);
  }

  function newCtx() { return { logs: [], events: [] }; }
  const fail = error => ({ ok: false, error });
  function done(state, ctx) {
    state.seq++;
    return { ok: true, logs: ctx.logs, events: ctx.events };
  }

  /* ---------- 内部処理 ---------- */
  // 味方の生存前衛全員を回復（後衛・戦闘不能は対象外）
  function healFront(state, ctx, side, base, sourceLabel) {
    if (base <= 0) return;
    const pct = healPercent(state.round);
    const amount = fatiguedHeal(base, state.round);
    const parts = [];
    frontAlive(state, side).forEach(i => {
      const unit = state.teams[side][i];
      const before = unit.hp;
      unit.hp = Math.min(unit.maxHp, unit.hp + amount);
      const gained = unit.hp - before;
      parts.push(`${unitName(unit)} +${gained}（HP ${unit.hp}/${unit.maxHp}）`);
      ctx.events.push({ type: 'heal', side, idx: i, amount: gained });
    });
    const pctText = pct < 100 ? `・回復疲労${pct}%：${base}→${amount}` : '';
    addLog(state, ctx, `［${sourceLabel}${pctText}］${team(state, side)}前衛全員を回復：${parts.join('、') || '対象なし'}`, 'heal');
  }

  // 1体にダメージ（戦闘不能の判定は呼び出し側で一連の処理後に行う）
  function damageUnit(state, ctx, side, idx, damage, consumeBarrier) {
    const unit = state.teams[side][idx];
    if (consumeBarrier && unit.barrier) unit.barrier = false;
    unit.hp = Math.max(0, unit.hp - damage);
    ctx.events.push({ type: 'damage', side, idx, amount: damage });
    return unit;
  }

  // 一連の処理の後に戦闘不能を確定し、前衛枠から外す
  function settleKnockouts(state, ctx, side) {
    const fallen = state.front[side].filter(i => state.teams[side][i].hp <= 0);
    fallen.forEach(i => {
      const u = state.teams[side][i];
      u.barrier = false;
      addLog(state, ctx, `${team(state, side)}の${unitName(u)}は戦闘不能になった`, 'ko');
      ctx.events.push({ type: 'ko', side, idx: i });
    });
    state.front[side] = state.front[side].filter(i => state.teams[side][i].hp > 0);
    return fallen.length;
  }

  function startTurn(state, ctx, side) {
    state.turnSide = side;
    if (side === state.firstSide) state.round++;
    state.turnCount[side]++;
    Object.assign(state, freshTurnFlags());
    // CDは前衛・後衛に関係なく、自分のターン開始時に1進む
    state.teams[side].forEach(u => { if (u.cd > 0) u.cd--; });
    state.phase = 'roll';
    addLog(state, ctx, `― 第${state.round}巡　${who(state, side)}のターン ―`, 'turn');
    ctx.events.push({ type: 'turn', side });
  }

  function endTurn(state, ctx) {
    startTurn(state, ctx, opp(state.turnSide));
  }

  // 攻撃後の判定：戦闘不能 → 全滅 → 前衛の補充。補充が必要なら true
  function afterAttack(state, ctx, attackerSide, resume) {
    const defender = opp(attackerSide);
    settleKnockouts(state, ctx, defender);
    if (allDown(state, defender)) {
      state.phase = 'over';
      state.winner = attackerSide;
      state.dice = null;
      addLog(state, ctx, `${team(state, defender)}チームは全滅した。${who(state, attackerSide)}の勝利！`, 'result');
      ctx.events.push({ type: 'over', winner: attackerSide });
      return true;
    }
    const need = Math.min(CONFIG.FRONT_SIZE - state.front[defender].length, backAlive(state, defender).length);
    if (need > 0) {
      state.phase = 'replace';
      state.pendingReplace = { side: defender, resume, need };
      return true;
    }
    return false;
  }

  /* ---------- 操作（すべてルール検証あり） ---------- */
  // 初期配置：前衛にするユニット番号を FRONT_SIZE 体ぶん指定（残りが後衛）し、リーダーを1体選ぶ
  // leaderIdx に null を渡すとリーダーなし（テスト用。画面とCPUは必ずリーダーを選ぶ）
  function chooseFormation(state, side, frontIdxs, leaderIdx) {
    if (state.phase !== 'formation') return fail('今は配置を決める段階ではありません');
    if (SIDES.indexOf(side) < 0) return fail('不正な陣営です');
    if (state.front[side].length) return fail('配置はすでに決まっています');
    if (!Array.isArray(frontIdxs) || frontIdxs.length !== CONFIG.FRONT_SIZE || new Set(frontIdxs).size !== frontIdxs.length) {
      return fail(`前衛を${CONFIG.FRONT_SIZE}体選んでください`);
    }
    if (!frontIdxs.every(i => isAlive(state.teams[side][i]))) return fail('そのキャラは選べません');
    if (leaderIdx === undefined) return fail('リーダーを選んでください');
    if (leaderIdx !== null && !state.teams[side][leaderIdx]) return fail('リーダーはチームのキャラから選んでください');
    const ctx = newCtx();
    state.front[side] = frontIdxs.slice();
    state.leader[side] = leaderIdx;
    const names = i => unitName(state.teams[side][i]);
    const back = state.teams[side].map((u, i) => i).filter(i => frontIdxs.indexOf(i) < 0);
    addLog(state, ctx, `${team(state, side)}の配置　前衛：${frontIdxs.map(names).join('・')}　後衛：${back.map(names).join('・')}`, 'switch');
    if (leaderIdx !== null) {
      const ls = unitChar(state.teams[side][leaderIdx]).leaderSkill;
      addLog(state, ctx, `${team(state, side)}のリーダー：${names(leaderIdx)}「${ls.name}」${ls.text}`, 'skill');
      // 最大HPを上げるリーダースキルは配置の時点で反映（初期HPも同じだけ上がる）
      leaderEffects(state, side).filter(e => e.type === 'maxHp').forEach(e => {
        state.teams[side].forEach(u => {
          u.maxHp = Math.floor(u.maxHp * (100 + e.percent) / 100);
          u.hp = u.maxHp;
        });
      });
    }
    if (state.front.player.length && state.front.cpu.length) {
      // 戦闘開始時に結界を張るリーダースキル
      SIDES.forEach(sd => {
        if (leaderEffects(state, sd).some(e => e.type === 'startBarrier')) {
          state.front[sd].forEach(i => { state.teams[sd][i].barrier = true; });
          addLog(state, ctx, `${team(state, sd)}前衛全員に結界（リーダースキル）`, 'barrier');
        }
      });
      state.phase = 'initiative'; // 先攻・後攻をサイコロで決める（rollInitiative）
    }
    return done(state, ctx);
  }

  // 先攻・後攻：両陣営がサイコロを振り、大きい方が先攻（同じ数なら振り直し）
  function rollInitiative(state, rng) {
    if (state.phase !== 'initiative') return fail('今は先攻・後攻を決める段階ではありません');
    const ctx = newCtx();
    const rolls = [];
    let p, c;
    do {
      p = rollDie(rng);
      c = rollDie(rng);
      rolls.push([p, c]);
      addLog(state, ctx, `先攻・後攻のサイコロ：${who(state, 'player')} ${p}　${who(state, 'cpu')} ${c}${p === c ? '（同じ数なので振り直し）' : ''}`, 'dice');
    } while (p === c && rolls.length < 50);
    if (p === c) p = c + 1; // 念のための打ち切り（実質起きない）
    state.firstSide = p > c ? 'player' : 'cpu';
    state.initiative = { player: p, cpu: c, rolls };
    ctx.events.push({ type: 'initiative', player: p, cpu: c, first: state.firstSide, rolls });
    addLog(state, ctx, `決闘開始！ ${who(state, state.firstSide)}の先攻です`, 'turn');
    startTurn(state, ctx, state.firstSide);
    return done(state, ctx);
  }

  // 降参（対人戦の退出など）。相手の勝利で決着
  function surrender(state, side) {
    if (state.phase === 'over') return fail('勝敗はすでに決まっています');
    if (SIDES.indexOf(side) < 0) return fail('不正な陣営です');
    const ctx = newCtx();
    state.phase = 'over';
    state.winner = opp(side);
    state.dice = null;
    state.pendingReplace = null;
    state.surrendered = side;
    addLog(state, ctx, `${who(state, side)}は降参した。${who(state, opp(side))}の勝利！`, 'result');
    ctx.events.push({ type: 'over', winner: state.winner });
    return done(state, ctx);
  }

  function roll(state, side, rng) {
    if (state.phase === 'over') return fail('勝敗はすでに決まっています');
    if (state.turnSide !== side) return fail('相手のターンです');
    if (state.phase !== 'roll') return fail(state.dice ? '数字はすでに出ています' : '今は数字を出せません');
    const ctx = newCtx();
    state.dice = rollDie(rng);
    state.phase = 'action';
    addLog(state, ctx, `${who(state, side)}の出目：${state.dice}`, 'dice');
    ctx.events.push({ type: 'roll', side, value: state.dice });
    return done(state, ctx);
  }

  function actionBlockReason(state, side) {
    if (state.phase === 'over') return '勝敗が決まっています';
    if (state.turnSide !== side) return '相手のターンです';
    if (state.phase === 'replace') return '前衛の補充中です';
    if (state.phase !== 'action' || !state.dice) return '先に数字を出してください';
    if (state.moveUsed) return 'このターンはすでに通常技を使いました';
    return null;
  }

  // 任意交代ができない理由（できるなら null）
  function swapBlockReason(state, side) {
    const r = actionBlockReason(state, side);
    if (r) return r;
    if (state.swapUsed) return 'このターンはすでに交代しました';
    if (state.skillUsed) return '固有スキルを使った後は交代できません';
    if (!frontAlive(state, side).length) return '交代できる前衛がいません';
    if (!backAlive(state, side).length) return '交代できる後衛がいません';
    return null;
  }

  // 任意交代：生存前衛1体と生存後衛1体を入れ替える（1ターン1回・ターンは終わらない）
  function swap(state, side, frontIdx, backIdx) {
    const reason = swapBlockReason(state, side);
    if (reason) return fail(reason);
    const f = state.teams[side][frontIdx];
    const b = state.teams[side][backIdx];
    if (!isAlive(f) || !isFront(state, side, frontIdx)) return fail('下げるキャラは生存している前衛から選んでください');
    if (!isAlive(b) || isFront(state, side, backIdx)) return fail('出すキャラは生存している後衛から選んでください');
    const ctx = newCtx();
    const slot = state.front[side].indexOf(frontIdx);
    state.front[side][slot] = backIdx;
    state.swapUsed = true;
    addLog(state, ctx, `${team(state, side)}の交代：${unitName(f)}が後衛へ下がり、${unitName(b)}が前衛に出た`, 'switch');
    ctx.events.push({ type: 'switch', side, out: frontIdx, in: backIdx });
    return done(state, ctx);
  }

  // スキルが使えない理由（使えるなら null）
  function skillBlockReason(state, side, userIdx) {
    const unit = state.teams[side][userIdx];
    if (!unit) return '不正なキャラです';
    if (!isAlive(unit)) return '戦闘不能のため使えません';
    const r = actionBlockReason(state, side);
    if (r === '先に数字を出してください') return '数字を出してから使えます';
    if (r) return r;
    if (state.skillUsed) return 'このターンはすでに固有スキルを使いました';
    if (unit.cd > 0) return `再使用まであと${unit.cd}ターン`;
    const skill = unitChar(unit).skill;
    if (skill.effects.length === 1 && skill.effects[0].type === 'barrier' &&
        frontAlive(state, side).every(i => state.teams[side][i].barrier)) return '前衛全員がすでに結界を持っています';
    return null;
  }

  function useSkill(state, side, userIdx, rng) {
    const reason = skillBlockReason(state, side, userIdx);
    if (reason) return fail(reason);
    const user = state.teams[side][userIdx];
    const skill = unitChar(user).skill;
    const ctx = newCtx();
    state.skillUsed = true;
    state.skillUsedBy = userIdx;
    user.cd = skill.cd;
    addLog(state, ctx, `${team(state, side)}の${unitName(user)}が固有スキル「${skill.name}」を使った（CD${skill.cd}）`, 'skill');
    ctx.events.push({ type: 'skill', side, idx: userIdx, name: skill.name });

    let damaged = false;
    const targetSide = opp(side);
    for (const eff of skill.effects) {
      if (eff.type === 'atkMultiplier') {
        state.boost.mult *= eff.value;
        addLog(state, ctx, `このターンの通常技の攻撃が${eff.value}倍になる`, 'skill');
      } else if (eff.type === 'atkBonus') {
        state.boost.bonus += eff.value;
        addLog(state, ctx, `このターンの通常技の攻撃に+${eff.value}（攻撃0の技は除く）`, 'skill');
      } else if (eff.type === 'heal') {
        healFront(state, ctx, side, eff.amount + leaderSum(state, side, 'skillHealBonus'), skill.name);
      } else if (eff.type === 'barrier') {
        const got = frontAlive(state, side).filter(i => !state.teams[side][i].barrier);
        got.forEach(i => { state.teams[side][i].barrier = true; ctx.events.push({ type: 'barrier', side, idx: i }); });
        addLog(state, ctx, `${team(state, side)}前衛に琥珀の結界：${got.map(i => unitName(state.teams[side][i])).join('・')}`, 'barrier');
      } else if (eff.type === 'reroll') {
        const before = state.dice;
        state.dice = rollDie(rng);
        addLog(state, ctx, `出目を振り直した：${before} → ${state.dice}`, 'dice');
        ctx.events.push({ type: 'roll', side, value: state.dice, reroll: true });
      } else if (eff.type === 'damage') {
        const targets = frontAlive(state, targetSide); // 処理開始時の敵前衛だけが対象
        const parts = targets.map(i => {
          const t = state.teams[targetSide][i];
          const r = computeSkillDamage(eff.amount + leaderSum(state, side, 'skillDamageBonus'), eff.ignoreDefense, t);
          damageUnit(state, ctx, targetSide, i, r.damage, r.barrier);
          return `${unitName(t)} ${r.damage}${r.barrier ? '（結界で半減）' : ''}（HP ${t.hp}/${t.maxHp}）`;
        });
        addLog(state, ctx, `［${skill.name}${eff.ignoreDefense ? '・防御無視' : ''}］${team(state, targetSide)}前衛全員にダメージ：${parts.join('、')}`, 'damage');
        damaged = true;
      }
    }
    if (damaged) afterAttack(state, ctx, side, 'action');
    return done(state, ctx);
  }

  function moveBlockReason(state, side, idx) {
    const unit = state.teams[side][idx];
    if (!unit) return '不正なキャラです';
    const r = actionBlockReason(state, side);
    if (r) return r;
    if (!isAlive(unit)) return '戦闘不能のため使えません';
    if (!isFront(state, side, idx)) return '通常技を使えるのは前衛だけです';
    return null;
  }

  // 通常技：前衛1体の「出目に対応する技」を1つだけ使う
  function useMove(state, side, idx) {
    const reason = moveBlockReason(state, side, idx);
    if (reason) return fail(reason);
    const unit = state.teams[side][idx];
    const ch = unitChar(unit);
    const move = unitMove(unit, state.dice);
    const boost = attackBoost(state, side, unit);
    const ctx = newCtx();
    state.moveUsed = true;
    addLog(state, ctx, `${team(state, side)}の${ch.name}の通常技［出目${state.dice}］「${move.name}」`, 'move');
    ctx.events.push({ type: 'move', side, idx, dice: state.dice, name: move.name });

    const targetSide = opp(side);
    let attacked = false;
    if (move.atk > 0) {
      const targets = frontAlive(state, targetSide); // 攻撃開始時の敵前衛に一度だけ
      const parts = targets.map(i => {
        const t = state.teams[targetSide][i];
        const r = computeAttack(move.atk, boost, ch, t);
        damageUnit(state, ctx, targetSide, i, r.damage, r.barrier);
        const notes = [];
        if (r.advantage) notes.push('属性有利');
        if (r.barrier) notes.push('結界で半減');
        return `${unitName(t)} ${r.damage}${notes.length ? '（' + notes.join('・') + '）' : ''}（HP ${t.hp}/${t.maxHp}）`;
      });
      const boostNote = (boost.mult !== 1 || boost.bonus) ? `・強化後${move.atk * boost.mult + boost.bonus}` : '';
      addLog(state, ctx, `［${move.name}・攻撃${move.atk}${boostNote}］${team(state, targetSide)}前衛全員にダメージ：${parts.join('、')}`, 'damage');
      attacked = targets.length > 0;
    }
    if (move.heal > 0) healFront(state, ctx, side, moveHealBase(state, side, move), move.name);
    if (move.atk <= 0 && move.heal <= 0) addLog(state, ctx, '何も起こらなかった', 'info');

    // 技の効果をすべて処理してから、戦闘不能・勝敗・補充を判定
    if (!(attacked && afterAttack(state, ctx, side, 'endTurn'))) endTurn(state, ctx);
    return done(state, ctx);
  }

  // 前衛の補充（強制）：空いた前衛枠に生存後衛を1体ずつ出す。ターン・任意交代の回数は消費しない
  function chooseReplacement(state, side, idx) {
    if (state.phase !== 'replace' || !state.pendingReplace) return fail('今は前衛を補充する段階ではありません');
    if (state.pendingReplace.side !== side) return fail('補充するのは相手です');
    const unit = state.teams[side][idx];
    if (!isAlive(unit)) return fail('戦闘不能のキャラは出せません');
    if (isFront(state, side, idx)) return fail('そのキャラはすでに前衛です');
    const ctx = newCtx();
    state.front[side].push(idx);
    state.pendingReplace.need--;
    addLog(state, ctx, `${team(state, side)}の前衛補充：${unitName(unit)}が前衛に出た`, 'switch');
    ctx.events.push({ type: 'switch', side, in: idx });
    if (state.pendingReplace.need <= 0 || !backAlive(state, side).length) {
      const resume = state.pendingReplace.resume;
      state.pendingReplace = null;
      if (resume === 'action') state.phase = 'action'; // 同じ出目で通常技へ戻る（スキルは使用済みのまま）
      else endTurn(state, ctx);
    }
    return done(state, ctx);
  }

  /* ---------- 画面表示用の予測（実処理と同じ計算） ---------- */
  function previewMove(state, side, idx, dice) {
    const d = dice || state.dice;
    const unit = state.teams[side][idx];
    if (!d || !unit) return null;
    const ch = unitChar(unit);
    const move = unitMove(unit, d);
    const targetSide = opp(side);
    const boost = attackBoost(state, side, unit);
    const attacks = move.atk > 0 ? frontAlive(state, targetSide).map(i => {
      const t = state.teams[targetSide][i];
      return Object.assign({ idx: i, name: unitName(t), hp: t.hp }, computeAttack(move.atk, boost, ch, t));
    }) : [];
    const round = Math.max(1, state.round);
    const healBase = moveHealBase(state, side, move);
    const amount = fatiguedHeal(healBase, round);
    const heals = move.heal > 0 ? frontAlive(state, side).map(i => {
      const t = state.teams[side][i];
      return { idx: i, name: unitName(t), amount, effective: Math.min(amount, t.maxHp - t.hp) };
    }) : [];
    return { dice: d, move, user: idx, attacks, heals, healBase, healPercent: healPercent(round), boosted: attacks.length ? attacks[0].boosted : move.atk };
  }

  function previewSkill(state, side, userIdx) {
    const unit = state.teams[side][userIdx];
    const skill = unitChar(unit).skill;
    const round = Math.max(1, state.round);
    const targetSide = opp(side);
    return skill.effects.map(e => {
      if (e.type === 'heal') {
        const base = e.amount + leaderSum(state, side, 'skillHealBonus');
        const amount = fatiguedHeal(base, round);
        return { type: 'heal', base, percent: healPercent(round), amount,
          targets: frontAlive(state, side).map(i => { const t = state.teams[side][i]; return { idx: i, name: unitName(t), effective: Math.min(amount, t.maxHp - t.hp) }; }) };
      }
      if (e.type === 'damage') {
        const base = e.amount + leaderSum(state, side, 'skillDamageBonus');
        return { type: 'damage', base, ignoreDefense: !!e.ignoreDefense,
          targets: frontAlive(state, targetSide).map(i => { const t = state.teams[targetSide][i]; const r = computeSkillDamage(base, e.ignoreDefense, t); return { idx: i, name: unitName(t), damage: r.damage, barrier: r.barrier }; }) };
      }
      if (e.type === 'barrier') {
        return { type: 'barrier', targets: frontAlive(state, side).map(i => ({ idx: i, name: unitName(state.teams[side][i]), already: !!state.teams[side][i].barrier })) };
      }
      return Object.assign({}, e);
    });
  }

  const Engine = {
    CONFIG, ELEMENTS, ELEMENT_ADVANTAGE, CHARACTERS, SIDES,
    createRng, rollDie, opp, getChar, unitChar, isAlive, aliveIndexes, allDown, isFront, frontAlive, backAlive, clone,
    hasAdvantage, finalizeDamage, healPercent, fatiguedHeal, computeAttack, computeSkillDamage,
    validateTeam, randomTeam, createBattle,
    movePower, defaultLoadout, loadoutPower, loadoutBudget, loadoutError, unitMove,
    leaderEffects, leaderAtkBonus, attackBoost, moveHealBase,
    chooseFormation, rollInitiative, surrender, roll, swap, useSkill, useMove, chooseReplacement,
    clampLevel, levelMaxHp, levelAtkBonus,
    actionBlockReason, swapBlockReason, skillBlockReason, moveBlockReason,
    previewMove, previewSkill
  };

  if (typeof module === 'object' && module.exports) module.exports = Engine;
  else global.RikuyouEngine = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
