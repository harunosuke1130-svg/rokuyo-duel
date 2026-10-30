// 技の構成（カスタム）とリーダースキルのテスト（node --test tests/custom.test.js）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const fixed = d => () => (d - 1) / 6 + 0.01;
//          0 燎原(火)  1 月泉(聖光) 2 逆風(自然) 3 琥珀(自然) 4 宵闇(呪闇) 5 霧海(水)
const P = ['ryogen', 'gessen', 'gyakufu', 'kohaku', 'yoiyami', 'mukai'];
//          0 翠樹(自然) 1 雷鳴(聖光) 2 霧海(水) 3 琥珀(自然) 4 月泉(聖光) 5 燎原(火)
const C = ['suiju', 'raimei', 'mukai', 'kohaku', 'gessen', 'ryogen'];
const hps = (s, side) => s.teams[side].map(u => u.hp);
// 先攻・後攻のサイコロで、プレイヤーが先攻になる乱数（6 対 1）
const playerFirst = () => { const seq = [0.99, 0.01]; let k = 0; return () => seq[k++ % seq.length]; };


function battle(pLeader, cLeader, fp = [0, 1, 2], fc = [0, 1, 2], opts) {
  const s = E.createBattle(P, C, opts);
  assert.ok(E.chooseFormation(s, 'player', fp, pLeader).ok);
  assert.ok(E.chooseFormation(s, 'cpu', fc, cLeader).ok);
  assert.ok(E.rollInitiative(s, playerFirst()).ok);
  return s;
}

test('技の構成：8個以上から6個を選び、順番を入れ替えられる（技力の上限あり）', () => {
  // 燎原の初期構成：火花8・斬り払い14・紅蓮の一閃32・息を整える回20・炎の輪22・燃え尽きる刃38 ＝ 技力134
  assert.equal(E.loadoutBudget('ryogen'), 134 + E.CONFIG.LOADOUT_POWER_MARGIN);
  assert.equal(E.loadoutError('ryogen', [5, 4, 3, 2, 1, 0]), null, '並べ替えだけなら常に可');
  assert.equal(E.loadoutError('ryogen', [0, 1, 2, 3, 4, 7], 6), null, '燃え尽きる刃38 → 灰燼の突き26（Lv6）');
  assert.equal(E.loadoutError('ryogen', [0, 1, 2, 6, 4, 5], 3), null, '息を整える20 → 焔の構え(18+6)：技力138 は上限141以内（Lv3）');
  assert.match(E.loadoutError('ryogen', [7, 1, 2, 3, 4, 5], 6), /上限/, '火花8 → 灰燼の突き26：技力152 は上限144超え（Lv6）');
  assert.match(E.loadoutError('ryogen', [0, 0, 1, 2, 3, 4]), /同じ技/);
  assert.match(E.loadoutError('ryogen', [0, 1, 2, 3, 4]), /6個/);
  assert.match(E.loadoutError('ryogen', [0, 1, 2, 3, 4, 99]), /存在しない/);
  assert.throws(() => E.createBattle(P, C, { loadouts: { player: { ryogen: [7, 1, 2, 3, 4, 5] } }, levels: { player: { ryogen: 6 } } }), /上限/);
});

test('レベルで技が解放され、技力の上限が上がる', () => {
  const L = E.CONFIG.LEVEL;
  assert.deepEqual([0, 5, 6, 7, 8].map(E.moveUnlockLevel), [1, 1, L.moveUnlock[0], L.moveUnlock[1], L.moveUnlock[2]]);
  assert.equal(E.loadoutBudget('ryogen', 10), E.loadoutBudget('ryogen') + 9 * L.powerPerLevel);
  assert.equal(E.loadoutBudget('ryogen', 999), E.loadoutBudget('ryogen', L.max), '上限は最大レベルまで');
  // 焔の構え（7個目）は Lv3 から
  assert.match(E.loadoutError('ryogen', [0, 1, 2, 6, 4, 5], 2), /Lv3で使えるようになります/);
  assert.equal(E.loadoutError('ryogen', [0, 1, 2, 6, 4, 5], 3), null);
  // 火花8 → 灰燼の突き26（技力152）：上限139＋(Lv−1)。Lv14 で152に届く
  assert.match(E.loadoutError('ryogen', [7, 1, 2, 3, 4, 5], 13), /上限/);
  assert.equal(E.loadoutError('ryogen', [7, 1, 2, 3, 4, 5], 14), null);
  assert.throws(() => E.createBattle(P, C, { loadouts: { player: { ryogen: [0, 1, 2, 6, 4, 5] } } }), /Lv3/, 'Lv1では戦闘に使えない');
  const s = E.createBattle(P, C, { loadouts: { player: { ryogen: [7, 1, 2, 3, 4, 5] } }, levels: { player: { ryogen: 14 } } });
  assert.equal(E.unitMove(s.teams.player[0], 1).name, '灰燼の突き');
});

test('並べ替えた構成で、出目と技の対応が変わる（CPUは初期構成）', () => {
  const s = battle(null, null, [0, 1, 2], [0, 1, 2], { loadouts: { player: { ryogen: [5, 4, 3, 2, 1, 0] } } });
  assert.equal(E.unitMove(s.teams.player[0], 1).name, '燃え尽きる刃');
  assert.equal(E.unitMove(s.teams.cpu[5], 1).name, '火花');
  E.roll(s, 'player', fixed(1));
  const before = hps(s, 'cpu');
  E.useMove(s, 'player', 0); // 出目1 → 燃え尽きる刃38：翠樹（自然）は有利 39.9→40、雷鳴・霧海 38
  assert.deepEqual(before.map((h, i) => h - s.teams.cpu[i].hp), [40, 38, 38, 0, 0, 0]);
  assert.ok(s.log.some(l => l.text.includes('［出目1］「燃え尽きる刃」')));
  assert.deepEqual(s.teams.player[0].loadout, [5, 4, 3, 2, 1, 0]);
});

test('リーダースキル：最大HPアップ（琥珀の砦）は味方全員・初期HPも上がる', () => {
  const s = battle(3, null);
  // 120→132, 100→110, 95→104, 160→176, 100→110, 130→143（切り捨て）
  assert.deepEqual(s.teams.player.map(u => u.maxHp), [132, 110, 104, 176, 110, 143]);
  assert.deepEqual(hps(s, 'player'), [132, 110, 104, 176, 110, 143]);
  assert.deepEqual(s.teams.cpu.map(u => u.maxHp), [110, 105, 130, 160, 100, 120], '相手には影響しない');
  assert.ok(s.log.some(l => l.text.includes('リーダー：琥珀の守人「琥珀の砦」')));
});

test('リーダースキル：攻撃加算は属性倍率より前・倍化しない・攻撃0の技は対象外・予測と一致', () => {
  const s = battle(0, null); // 騎士団の先陣：通常技の攻撃+3
  E.roll(s, 'player', fixed(3));
  const p = E.previewMove(s, 'player', 0);
  const before = hps(s, 'cpu');
  E.useMove(s, 'player', 0); // 紅蓮の一閃 (32+3)=35：翠樹 36.75→37、雷鳴35、霧海35
  assert.deepEqual(before.map((h, i) => h - s.teams.cpu[i].hp), [37, 35, 35, 0, 0, 0]);
  assert.deepEqual(p.attacks.map(a => a.damage), [37, 35, 35]);
  // 紅蓮の誓い（×2）と併用：32×2＋3＝67
  const s2 = battle(0, null);
  E.roll(s2, 'player', fixed(3));
  E.useSkill(s2, 'player', 0);
  assert.equal(E.previewMove(s2, 'player', 0).attacks[1].boosted, 67);
  // 属性限定：追い風の号令は自然属性の味方だけ+5
  const s3 = battle(2, null);
  E.roll(s3, 'player', fixed(1));
  assert.equal(E.previewMove(s3, 'player', 2).attacks[1].boosted, 45, '逆風の射手（自然）は 40+5');
  assert.equal(E.previewMove(s3, 'player', 0).attacks[1].boosted, 8, '燎原（火）は加算なし');
  // 攻撃0の技には加算しない
  const s4 = battle(0, null);
  E.roll(s4, 'player', fixed(4));
  assert.equal(E.previewMove(s4, 'player', 0).attacks.length, 0);
});

test('リーダースキル：通常技の回復加算・スキルの回復加算・スキルのダメージ加算', () => {
  const s = battle(1, null); // 月泉の加護：通常技の回復+4
  s.teams.player.forEach(u => { u.hp = 30; });
  E.roll(s, 'player', fixed(4));
  const pv = E.previewMove(s, 'player', 0);
  E.useMove(s, 'player', 0); // 息を整える 20+4
  assert.deepEqual(hps(s, 'player'), [54, 54, 54, 30, 30, 30]);
  assert.equal(pv.heals[0].amount, 24);

  const s2 = battle(null, 0, [0, 1, 2], [4, 1, 2]); // 敵：翠樹がリーダー（森の恵み：スキル回復+6）
  s2.teams.cpu.forEach(u => { u.hp = 10; });
  E.roll(s2, 'player', fixed(4)); E.useMove(s2, 'player', 0);
  E.roll(s2, 'cpu', fixed(1));
  assert.ok(E.useSkill(s2, 'cpu', 4).ok); // 月泉の祝福 35+6 → 前衛（4,1,2）だけ
  assert.deepEqual(hps(s2, 'cpu'), [10, 51, 51, 10, 51, 10]);

  const s3 = battle(4, null, [4, 0, 1]); // 虚空の導き：スキルの直接ダメージ+5
  E.roll(s3, 'player', fixed(1));
  const sk = E.previewSkill(s3, 'player', 4)[0];
  const before = hps(s3, 'cpu');
  E.useSkill(s3, 'player', 4);
  assert.deepEqual(before.map((h, i) => h - s3.teams.cpu[i].hp), [25, 25, 25, 0, 0, 0]);
  assert.deepEqual(sk.targets.map(t => t.damage), [25, 25, 25]);
});

test('リーダースキル：霧の帳は戦闘開始時に前衛全員へ結界（後衛・相手には付かない）', () => {
  const s = battle(5, null);
  assert.deepEqual(s.teams.player.map(u => u.barrier), [true, true, true, false, false, false]);
  assert.ok(s.teams.cpu.every(u => !u.barrier));
});

test('リーダーが戦闘不能になってもリーダースキルは続く', () => {
  const s = battle(0, null);
  s.teams.player[0].hp = 0;
  s.front.player = [1, 2, 3];
  E.roll(s, 'player', fixed(1));
  assert.equal(E.previewMove(s, 'player', 2).attacks[0].boosted, 43, '風穿ち40＋3');
});

test('再戦（新しい戦闘）ではリーダー・構成・最大HPが初期化される', () => {
  const s = battle(3, null);
  assert.equal(s.teams.player[0].maxHp, 132);
  const n = E.createBattle(P, C);
  assert.deepEqual(n.leader, { player: null, cpu: null });
  assert.equal(n.teams.player[0].maxHp, 120);
  assert.deepEqual(n.teams.player[0].loadout, [0, 1, 2, 3, 4, 5]);
});

test('出撃準備の初期配置：前回の配置を優先し、無効な分はチームの並び順で補う', () => {
  const s = E.createBattle(P, C);
  assert.deepEqual(E.suggestFormation(s, 'player'), { front: [0, 1, 2], back: [3, 4, 5], leader: 0 }, '前回なし：並び順の先頭3体・先頭がリーダー');
  assert.deepEqual(E.suggestFormation(s, 'player', { front: ['mukai', 'kohaku', 'gessen'], leader: 'yoiyami' }),
    { front: [5, 3, 1], back: [0, 2, 4], leader: 4 }, '前回の配置を復元');
  // チームにいないキャラ・戦闘不能のキャラは前衛にしない（ダンジョンの引き継ぎ）
  s.teams.player[5].hp = 0;
  const f = E.suggestFormation(s, 'player', { front: ['mukai', 'raimei', 'kohaku'], leader: 'raimei' });
  assert.deepEqual(f.front, [3, 0, 1]);
  assert.deepEqual(f.back, [2, 4, 5]);
  assert.equal(f.leader, 0, 'チームにいないリーダーは先頭に');
  assert.ok(E.chooseFormation(s, 'player', f.front, f.leader).ok, '初期配置はそのまま出撃できる');
});

test('ランク（★）：基礎HP＋初期構成の攻撃の平均＋回復の平均で決まり、レベル・技の付け替えでは変わらない', () => {
  // 燎原：HP120・初期6技の攻撃 8+14+32+0+22+38=114 → 平均19、回復 20 → 平均3.33
  const r = E.rankParts('ryogen');
  assert.equal(r.hp, 120);
  assert.equal(r.atk, 19);
  assert.ok(Math.abs(r.heal - 20 / 6) < 1e-9);
  const stars = Object.fromEntries(['ryogen', 'gessen', 'gyakufu', 'kohaku', 'yoiyami', 'suiju', 'raimei', 'mukai'].map(id => [id, E.starsOf(id)]));
  assert.deepEqual(stars, { ryogen: 3, gessen: 2, gyakufu: 2, kohaku: 3, yoiyami: 2, suiju: 3, raimei: 2, mukai: 3 });
  // 境界：110未満は★1、110以上は★2、130以上は★3、195以上は★4
  E.CHARACTERS.forEach(c => { const sc = E.rankParts(c.id).score; assert.equal(E.starsOf(c.id), sc >= 195 ? 4 : sc >= 130 ? 3 : sc >= 110 ? 2 : 1, c.name); });
  // 合計値の上位側ほど星が多い（逆転しない）
  const sorted = E.CHARACTERS.slice().sort((a, b) => E.rankParts(b.id).score - E.rankParts(a.id).score);
  sorted.forEach((c, k) => { if (k) assert.ok(E.starsOf(c.id) <= E.starsOf(sorted[k - 1].id)); });
  // 戦闘中の状態（レベル・付け替え・残りHP）に関係なく同じ
  const s = E.createBattle(P, C, { levels: { player: { ryogen: 30 } }, loadouts: { player: { ryogen: [7, 1, 2, 3, 4, 5] } } });
  s.teams.player[0].hp = 1;
  assert.equal(E.starsOf(s.teams.player[0].charId), 3);
  assert.equal(E.starsOf('b-boar'), null, 'ボスには星を付けない');
});
