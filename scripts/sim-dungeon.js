#!/usr/bin/env node
/* ダンジョンの勝率の試算（CPU 同士）。
 *   node scripts/sim-dungeon.js <ダンジョンID> <味方のレベル> [回数=300]
 * 味方は「仲間キャラから毎回ランダムに6体・すべて指定レベル・初期構成」。3階を HP 引き継ぎで連戦し、
 * 大ボスまで倒せた割合（踏破率）と、各階まで到達・突破した割合を出す。乱数はシード固定。 */
const E = require('../src/engine.js');
const P = require('../src/profile.js');
const CPU = require('../src/cpu.js');

const [id, lvArg, nArg] = process.argv.slice(2);
const d = P.getDungeon(id);
if (!d || !lvArg) { console.error('使い方：node scripts/sim-dungeon.js <ダンジョンID> <レベル> [回数]'); process.exit(1); }
const level = Number(lvArg), N = Number(nArg || 300);

let seed = 12345;
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pool = E.CHARACTERS.map(c => c.id);

function fight(team, floor, startHp) {
  const en = P.floorEnemy(id, floor);
  const s = E.createBattle(team, en.ids, {
    levels: { player: Object.fromEntries(team.map(t => [t, level])), cpu: en.levels },
    enemyKind: 'boss', startHp: startHp ? { player: startHp } : undefined
  });
  E.chooseFormation(s, 'cpu', CPU.chooseFormation(s, 'cpu', rng), null); // ボスはリーダーなし（画面と同じ）
  for (let guard = 0; s.phase !== 'over' && guard < 5000; guard++) {
    if (s.phase === 'initiative') { E.rollInitiative(s, rng); continue; }
    let moved = false;
    for (const side of ['player', 'cpu']) {
      if (s.phase === 'over') break;
      const r = CPU.act(s, side, rng);
      if (r.ok) moved = true;
    }
    if (!moved) throw new Error('進まない状態：' + s.phase);
  }
  return s;
}

let clears = 0;
const reach = [0, 0, 0], win = [0, 0, 0];
for (let k = 0; k < N; k++) {
  const team = pool.slice().sort(() => rng() - 0.5).slice(0, 6);
  let hp = null;
  for (let f = 0; f < d.floors.length; f++) {
    reach[f]++;
    const s = fight(team, f, hp);
    if (s.winner !== 'player') break;
    win[f]++;
    if (f === d.floors.length - 1) clears++;
    hp = P.carryOverHp(s.teams.player);
  }
}
const pct = x => (100 * x / N).toFixed(1) + '%';
console.log(`${d.name}（${id}）Lv${level} ×${N}回：踏破率 ${pct(clears)}`);
d.floors.forEach((f, i) => console.log(`  ${i + 1}階 ${E.getChar(f.boss).name}：到達 ${pct(reach[i])}・突破 ${pct(win[i])}`));
