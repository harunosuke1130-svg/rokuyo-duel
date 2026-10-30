/*
 * 六耀の決闘 — CPU の思考
 * プレイヤーと同じ Engine の操作関数だけを使って行動します。
 * 「交代（任意）→ スキル（任意）→ 通常技」の組み合わせを状態の複製で試し、評価値が最も高い手順を選びます。
 * スキルの後でも交代は残っていれば使える（振り直しの後などは、次の decide で交代を検討し直す）。
 * 振り直しは「振り直した後の6通りの平均」で判断し、実際の出目やプレイヤーの今後の選択は先読みしません。
 */
(function (global) {
  'use strict';

  const Engine = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./engine.js')
    : global.RikuyouEngine;

  const { opp, isAlive, aliveIndexes, frontAlive, backAlive, unitChar } = Engine;

  // シミュレーション用の複製（ログは不要なので複製しない）
  function clone(state) {
    const log = state.log;
    state.log = [];
    const copy = Engine.clone(state);
    state.log = log;
    return copy;
  }

  const W = {
    alive: 45,          // 生存1体あたりの価値
    barrier: 10,        // 前衛の結界
    barrierBack: 5,     // 後衛の結界
    lowFrontHp: 30,     // 前衛のHPがこの値以下なら危険（相手の全体攻撃を受けるため）
    lowFrontPenalty: 16,
    cdPenalty: 2.2,     // 自分のCD1あたりの減点（スキルの無駄撃ち防止）
    win: 100000
  };

  function evaluate(state, side) {
    if (state.phase === 'over') return state.winner === side ? W.win : -W.win;
    let score = 0;
    const scoreTeam = (s, sign) => {
      state.teams[s].forEach((u, i) => {
        if (!isAlive(u)) return;
        let v = u.hp + W.alive;
        if (u.barrier) v += Engine.isFront(state, s, i) ? W.barrier : W.barrierBack;
        score += sign * v;
      });
    };
    scoreTeam(side, 1);
    scoreTeam(opp(side), -1);
    frontAlive(state, side).forEach(i => {
      const u = state.teams[side][i];
      if (u.hp <= W.lowFrontHp && !u.barrier) score -= W.lowFrontPenalty;
    });
    state.teams[side].forEach(u => { if (isAlive(u)) score -= u.cd * W.cdPenalty; });
    return score;
  }

  // シミュレーション内で前衛補充が起きた場合は「HPが高い後衛から」と仮定する
  function resolveReplaceForSim(state) {
    let guard = 0;
    while (state.phase === 'replace' && guard++ < 10) {
      const s = state.pendingReplace.side;
      Engine.chooseReplacement(state, s, chooseByHp(state, s, backAlive(state, s)));
    }
  }

  function chooseByHp(state, side, candidates, rng) {
    let best = -1, bestHp = -1;
    candidates.forEach(i => {
      const hp = state.teams[side][i].hp + (rng ? rng() * 0.5 : 0);
      if (hp > bestHp) { bestHp = hp; best = i; }
    });
    return best;
  }

  function bestMove(state, side, rng) {
    let best = null;
    for (const i of frontAlive(state, side)) {
      const sim = clone(state);
      const r = Engine.useMove(sim, side, i);
      if (!r.ok) continue;
      resolveReplaceForSim(sim);
      const score = evaluate(sim, side) + (rng ? rng() * 0.01 : 0);
      if (!best || score > best.score) best = { type: 'move', unit: i, score };
    }
    return best;
  }

  // スキル（またはスキルなし）→ 通常技 の最善値
  function bestAfterSwap(state, side, rng) {
    let best = bestMove(state, side, rng);
    if (best) best = { score: best.score, skill: null };
    if (state.skillUsed) return best;
    for (const u of aliveIndexes(state, side)) { // 前衛・後衛どちらのスキルも候補
      if (Engine.skillBlockReason(state, side, u)) continue;
      const skill = unitChar(state.teams[side][u]).skill;
      const sim = clone(state);
      const r = Engine.useSkill(sim, side, u, () => 0);
      if (!r.ok) continue;
      let score;
      if (sim.phase === 'over') score = evaluate(sim, side);
      else {
        resolveReplaceForSim(sim);
        if (skill.effects.some(e => e.type === 'reroll')) {
          let sum = 0;
          for (let v = 1; v <= Engine.CONFIG.DICE_SIDES; v++) {
            const s2 = clone(sim);
            s2.dice = v;
            const m = bestMove(s2, side);
            sum += m ? m.score : evaluate(s2, side);
          }
          score = sum / Engine.CONFIG.DICE_SIDES;
        } else {
          const m = bestMove(sim, side, rng);
          score = m ? m.score : evaluate(sim, side);
        }
      }
      if (!best || score > best.score + 0.5) best = { score, skill: u };
    }
    return best;
  }

  function chooseFormation(state, side, rng) {
    // HPが高い順に前衛へ（同値はランダム）
    const order = aliveIndexes(state, side)
      .map(i => ({ i, k: state.teams[side][i].hp + (rng ? rng() : 0) }))
      .sort((a, b) => b.k - a.k)
      .map(o => o.i);
    return order.slice(0, Engine.CONFIG.FRONT_SIZE);
  }

  // リーダーはチームからランダムに選ぶ（プレイヤーの選択は見ない）
  function chooseLeader(state, side, rng) {
    return Math.floor((rng || Math.random)() * state.teams[side].length);
  }

  // 現在の段階で取るべき行動を1つ返す
  function decide(state, side, rng) {
    if (state.phase === 'formation' && !state.front[side].length) {
      return { type: 'formation', units: chooseFormation(state, side, rng), leader: chooseLeader(state, side, rng) };
    }
    if (state.phase === 'replace' && state.pendingReplace && state.pendingReplace.side === side) {
      return { type: 'replace', unit: chooseByHp(state, side, backAlive(state, side), rng) };
    }
    if (state.turnSide !== side) return null;
    if (state.phase === 'roll') return { type: 'roll' };
    if (state.phase !== 'action') return null;

    let plan = bestAfterSwap(state, side, rng);
    let swapPlan = null;
    if (!Engine.swapBlockReason(state, side)) {
      for (const f of frontAlive(state, side)) {
        for (const b of backAlive(state, side)) {
          const sim = clone(state);
          if (!Engine.swap(sim, side, f, b).ok) continue;
          const p = bestAfterSwap(sim, side, rng);
          if (p && (!plan || p.score > plan.score + 1)) { plan = p; swapPlan = { f, b }; }
        }
      }
    }
    if (swapPlan) return { type: 'swap', out: swapPlan.f, in: swapPlan.b };
    if (plan && plan.skill !== null) return { type: 'skill', user: plan.skill };
    const m = bestMove(state, side, rng);
    return m;
  }

  // 決定した行動を Engine で実行する
  function act(state, side, rng) {
    const d = decide(state, side, rng);
    if (!d) return { ok: false, error: 'CPUが行動できる段階ではありません' };
    let r;
    if (d.type === 'formation') r = Engine.chooseFormation(state, side, d.units, d.leader);
    else if (d.type === 'replace') r = Engine.chooseReplacement(state, side, d.unit);
    else if (d.type === 'roll') r = Engine.roll(state, side, rng);
    else if (d.type === 'swap') r = Engine.swap(state, side, d.out, d.in);
    else if (d.type === 'skill') r = Engine.useSkill(state, side, d.user, rng);
    else r = Engine.useMove(state, side, d.unit);
    r.decision = d;
    return r;
  }

  const CPU = { evaluate, decide, act, chooseFormation, chooseLeader, chooseByHp, bestMove };

  if (typeof module === 'object' && module.exports) module.exports = CPU;
  else global.RikuyouCPU = CPU;
})(typeof globalThis !== 'undefined' ? globalThis : this);
