// 戦闘ロジックの自動テスト（node --test tests/engine.test.js）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const CPU = require('../src/cpu.js');

// 指定した出目を必ず出す乱数
const fixed = d => () => (d - 1) / 6 + 0.01;
//          0 燎原(火)  1 月泉(聖光) 2 逆風(自然) 3 琥珀(自然) 4 宵闇(呪闇) 5 霧海(水)
const P = ['ryogen', 'gessen', 'gyakufu', 'kohaku', 'yoiyami', 'mukai'];
//          0 翠樹(自然) 1 雷鳴(聖光) 2 霧海(水) 3 琥珀(自然) 4 月泉(聖光) 5 燎原(火)
const C = ['suiju', 'raimei', 'mukai', 'kohaku', 'gessen', 'ryogen'];

function battle(fp = [0, 1, 2], fc = [0, 1, 2], p = P, c = C) {
  const s = E.createBattle(p, c);
  // 既存の数値テストはリーダーなし（null）で行い、リーダースキルは専用のテストで確認する
  assert.ok(E.chooseFormation(s, 'player', fp, null).ok);
  assert.ok(E.chooseFormation(s, 'cpu', fc, null).ok);
  assert.ok(E.rollInitiative(s, playerFirst()).ok);
  return s;
}
const hps = (s, side) => s.teams[side].map(u => u.hp);
// 先攻・後攻のサイコロで、プレイヤーが先攻になる乱数（6 対 1）
const playerFirst = () => { const seq = [0.99, 0.01]; let k = 0; return () => seq[k++ % seq.length]; };

// CPUのターンを「何も起こらない／自分だけの行動」で消化する補助（出目指定で前衛の技を使う）
function cpuMove(s, dice, unit) {
  assert.equal(s.turnSide, 'cpu');
  assert.ok(E.roll(s, 'cpu', fixed(dice)).ok);
  const r = E.useMove(s, 'cpu', unit === undefined ? s.front.cpu[0] : unit);
  assert.ok(r.ok, r.error);
}
function playerMove(s, dice, unit) {
  assert.equal(s.turnSide, 'player');
  assert.ok(E.roll(s, 'player', fixed(dice)).ok);
  const r = E.useMove(s, 'player', unit === undefined ? s.front.player[0] : unit);
  assert.ok(r.ok, r.error);
}

test('6体編成と前衛3体・後衛3体の配置', () => {
  assert.throws(() => E.createBattle(P.slice(0, 5), C));
  assert.throws(() => E.createBattle(['ryogen', 'ryogen', 'gessen', 'kohaku', 'mukai', 'suiju'], C));
  const s = E.createBattle(P, C);
  assert.equal(s.phase, 'formation');
  assert.equal(E.roll(s, 'player', fixed(1)).ok, false, '配置前は数字を出せない');
  assert.equal(E.chooseFormation(s, 'player', [0, 1]).ok, false);
  assert.equal(E.chooseFormation(s, 'player', [0, 0, 1]).ok, false);
  assert.match(E.chooseFormation(s, 'player', [5, 3, 1]).error, /リーダー/, 'リーダーは必須');
  assert.equal(E.chooseFormation(s, 'player', [5, 3, 1], 9).ok, false);
  assert.ok(E.chooseFormation(s, 'player', [5, 3, 1], 1).ok);
  assert.equal(s.leader.player, 1);
  assert.equal(E.chooseFormation(s, 'player', [0, 1, 2], 0).ok, false, '配置は1回だけ');
  assert.equal(s.phase, 'formation');
  assert.ok(E.chooseFormation(s, 'cpu', [0, 1, 2], 4).ok);
  assert.equal(s.phase, 'initiative', '配置後は先攻・後攻のサイコロ');
  assert.equal(E.roll(s, 'player', fixed(1)).ok, false);
  assert.ok(E.rollInitiative(s, playerFirst()).ok);
  assert.equal(s.phase, 'roll');
  assert.equal(s.round, 1);
  assert.deepEqual(s.front.player, [5, 3, 1]);
  assert.deepEqual(E.backAlive(s, 'player'), [0, 2, 4]);
  s.teams.player.concat(s.teams.cpu).forEach(u => assert.equal(u.hp, u.maxHp));
});

test('数字を先に確定し、前衛の「その数字の技」を1つだけ使う', () => {
  const s = battle();
  assert.equal(E.useMove(s, 'player', 0).ok, false, '数字の前は使えない');
  assert.ok(E.roll(s, 'player', fixed(3)).ok);
  assert.equal(E.roll(s, 'player', fixed(6)).ok, false, '2回目の数字は出せない');
  assert.equal(s.dice, 3);
  assert.match(E.useMove(s, 'player', 3).error, /前衛だけ/, '後衛は通常技を使えない');
  const before = hps(s, 'cpu');
  assert.ok(E.useMove(s, 'player', 0).ok); // 燎原 3「紅蓮の一閃」攻撃32
  const dmg = before.map((h, i) => h - s.teams.cpu[i].hp);
  // 翠樹（自然）には火→自然で有利 32×1.05=33.6→34、雷鳴・霧海は等倍32。後衛は0
  assert.deepEqual(dmg, [34, 32, 32, 0, 0, 0]);
  assert.equal(s.log.filter(l => l.kind === 'move').length, 1, '技は1つだけ');
  assert.equal(s.turnSide, 'cpu');
  assert.equal(E.useMove(s, 'player', 1).ok, false, '同じターンに2つ目は使えない');
});

test('3体の技は合算されない（他の前衛の数値は無関係）', () => {
  const s = battle();
  E.roll(s, 'player', fixed(1));
  const before = hps(s, 'cpu');
  E.useMove(s, 'player', 2); // 逆風 1「風穿ち」攻撃40 のみ
  // 自然→水 有利：霧海 42、他 40
  assert.deepEqual(before.map((h, i) => h - s.teams.cpu[i].hp), [40, 40, 42, 0, 0, 0]);
});

test('回復は味方の生存前衛全員にそれぞれ全量・後衛と戦闘不能は対象外・上限あり', () => {
  const s = battle([0, 1, 2]);
  s.teams.player[0].hp = 50;   // 前衛
  s.teams.player[1].hp = 90;   // 前衛（上限100）
  s.teams.player[2].hp = 0;    // 前衛・戦闘不能
  s.teams.player[3].hp = 10;   // 後衛
  E.roll(s, 'player', fixed(1));
  E.useMove(s, 'player', 1);   // 月泉 1「泉の祝福」回復39
  assert.equal(s.teams.player[0].hp, 89);
  assert.equal(s.teams.player[1].hp, 100);
  assert.equal(s.teams.player[2].hp, 0, '戦闘不能は復活しない');
  assert.equal(s.teams.player[3].hp, 10, '後衛は回復しない');
});

test('攻撃と回復の両方を持つ技は両方処理する', () => {
  const s = battle();
  s.teams.player[0].hp = 60;
  E.roll(s, 'player', fixed(4));
  const before = hps(s, 'cpu');
  E.useMove(s, 'player', 1); // 月泉 4「満月の光」攻撃24＋回復16。聖光→（自然・聖光・水）は等倍
  assert.deepEqual(before.map((h, i) => h - s.teams.cpu[i].hp), [24, 24, 24, 0, 0, 0]);
  assert.equal(s.teams.player[0].hp, 76);
});

test('相手の攻撃は前衛全員にそれぞれ全量、後衛は受けない', () => {
  const s = battle();
  playerMove(s, 4, 0); // 燎原 4「息を整える」回復のみ
  const before = hps(s, 'player');
  cpuMove(s, 2, 1); // 雷鳴 2「雷の羽」攻撃20 聖光→（火・聖光・自然）等倍
  assert.deepEqual(before.map((h, i) => h - s.teams.player[i].hp), [20, 20, 20, 0, 0, 0]);
});

test('属性相性と防御は対象ごとに判定し、最後に四捨五入', () => {
  // 霧海（水）の攻撃：燎原（火）には有利、結界持ちには半減
  const s = battle([0, 1, 3], [0, 1, 2], P, ['ryogen', 'raimei', 'kohaku', 'suiju', 'gessen', 'mukai']);
  s.teams.cpu[1].barrier = true;
  s.teams.cpu[0].barrier = true;
  // 前衛に霧海を出してから攻撃（交代）
  E.roll(s, 'player', fixed(5));
  assert.ok(E.swap(s, 'player', 3, 5).ok);
  const before = hps(s, 'cpu');
  E.useMove(s, 'player', 5); // 霧海 5「深海の渦」攻撃34
  // 燎原：34×1.05×0.5=17.85→18、雷鳴：34×0.5=17、琥珀：34
  assert.deepEqual(before.map((h, i) => h - s.teams.cpu[i].hp), [18, 17, 34, 0, 0, 0]);
  assert.equal(s.teams.cpu[0].barrier, false, '結界は消費される');
  assert.equal(s.teams.cpu[1].barrier, false);
});

test('ダメージ計算の順序と端数処理', () => {
  assert.equal(E.finalizeDamage(40, true, false), 42);
  assert.equal(E.finalizeDamage(14, true, true), 7);   // 7.35 → 7
  assert.equal(E.finalizeDamage(30, true, false), 32); // 31.5 → 32
  assert.equal(E.finalizeDamage(13, false, true), 7);  // 6.5 → 7
  assert.ok(E.hasAdvantage('water', 'fire'));
  assert.ok(E.hasAdvantage('fire', 'nature'));
  assert.ok(E.hasAdvantage('nature', 'water'));
  assert.ok(E.hasAdvantage('holy', 'dark'));
  assert.ok(E.hasAdvantage('dark', 'holy'));
  assert.ok(!E.hasAdvantage('fire', 'water'), '不利による減少なし（等倍）');
  assert.ok(!E.hasAdvantage('thunder', 'fire'), '未設定の属性は等倍');
  const ryogen = E.getChar('ryogen');
  const nat = { charId: 'kohaku', barrier: false };
  const natB = { charId: 'kohaku', barrier: true };
  assert.equal(E.computeAttack(32, { mult: 2, bonus: 0 }, ryogen, nat).damage, 67);  // 64×1.05=67.2
  assert.equal(E.computeAttack(14, { mult: 1, bonus: 10 }, ryogen, nat).damage, 25); // (14+10)×1.05=25.2
  assert.equal(E.computeAttack(14, { mult: 1, bonus: 10 }, ryogen, natB).damage, 13); // 12.6
  assert.equal(E.computeAttack(0, { mult: 2, bonus: 10 }, ryogen, nat).damage, 0);
  assert.equal(E.computeSkillDamage(12, false, natB).damage, 6);
  assert.equal(E.computeSkillDamage(20, true, natB).damage, 20);
  assert.equal(E.CONFIG.ADVANTAGE_MULTIPLIER, 1.05);
  const orig = E.CONFIG.ADVANTAGE_MULTIPLIER;
  try { E.CONFIG.ADVANTAGE_MULTIPLIER = 1.5; assert.equal(E.finalizeDamage(40, true, false), 60); }
  finally { E.CONFIG.ADVANTAGE_MULTIPLIER = orig; }
});

test('予測表示と実際の結果が対象ごとに一致する', () => {
  const s = battle();
  s.teams.cpu[1].barrier = true;
  E.roll(s, 'player', fixed(3));
  E.useSkill(s, 'player', 0); // 紅蓮の誓い ×2
  const p = E.previewMove(s, 'player', 0);
  const before = hps(s, 'cpu');
  E.useMove(s, 'player', 0);
  p.attacks.forEach(a => assert.equal(before[a.idx] - s.teams.cpu[a.idx].hp, a.damage));
  assert.deepEqual(p.attacks.map(a => a.damage), [67, 32, 64]);
});

test('交代：HP・CD・結界を保持し、数字は変わらず、1ターン1回・スキルの前後どちらでも可', () => {
  const s = battle();
  s.teams.player[0].hp = 77;
  s.teams.player[0].cd = 2;
  s.teams.player[0].barrier = true;
  E.roll(s, 'player', fixed(2));
  assert.equal(E.swap(s, 'player', 0, 1).ok, false, '前衛同士は交代できない');
  assert.equal(E.swap(s, 'player', 3, 4).ok, false, '後衛同士は交代できない');
  s.teams.player[4].hp = 0;
  assert.equal(E.swap(s, 'player', 0, 4).ok, false, '戦闘不能は出せない');
  assert.ok(E.swap(s, 'player', 0, 3).ok);
  assert.equal(s.dice, 2, '交代で数字は変わらない');
  assert.deepEqual(s.front.player, [3, 1, 2]);
  assert.equal(s.teams.player[0].hp, 77);
  assert.equal(s.teams.player[0].cd, 2);
  assert.equal(s.teams.player[0].barrier, true, '結界は本人に残る');
  assert.equal(s.teams.player[3].barrier, false, '結界は移らない');
  assert.equal(E.swap(s, 'player', 1, 5).ok, false, '交代は1ターン1回');
  assert.equal(s.turnSide, 'player', '交代だけではターンは終わらない');
  // 新しく出た前衛の技が使える
  assert.equal(E.useMove(s, 'player', 0).ok, false, '下げたキャラは技を使えない');
  assert.ok(E.useMove(s, 'player', 3).ok);
  // スキル使用後でも交代できる（1ターン1回はそのまま）
  cpuMove(s, 4, 1); // 雷鳴 4 天雷42 … 前衛が被弾
  const s2 = battle();
  E.roll(s2, 'player', fixed(5));
  assert.ok(E.useSkill(s2, 'player', 0).ok);
  assert.ok(E.swap(s2, 'player', 1, 3).ok, 'スキルの後でも交代できる');
  // 通常技の後は不可（ターンが終わる）
  E.useMove(s2, 'player', 3);
  assert.equal(E.swap(s2, 'player', 3, 1).ok, false);
});

test('後衛に下がっても回復しない・CDは後衛でも進む', () => {
  const s = battle();
  E.roll(s, 'player', fixed(1));
  E.useSkill(s, 'player', 1); // 月泉の祝福 CD3（第1ターン）
  E.useMove(s, 'player', 2);
  cpuMove(s, 5); // 翠樹 5 森の目覚め 攻撃26 + 自分側回復
  E.roll(s, 'player', fixed(6));
  E.swap(s, 'player', 1, 3); // 月泉を後衛へ
  const hpBack = s.teams.player[1].hp;
  E.useMove(s, 'player', 3);
  cpuMove(s, 5);
  assert.equal(s.teams.player[1].hp, hpBack, '後衛は回復も被弾もしない');
  assert.equal(s.teams.player[1].cd, 1, '第3ターン開始：残り1（後衛でも進む）');
  E.roll(s, 'player', fixed(6));
  assert.match(E.skillBlockReason(s, 'player', 1), /再使用/, '後衛でもCDは有効');
  E.useMove(s, 'player', 3);
  cpuMove(s, 5);
  assert.equal(s.teams.player[1].cd, 0, '第4ターン：再使用可能');
});

test('複数体が同時に倒れたら補充し、補充キャラは直前の攻撃を受けない', () => {
  const s = battle();
  s.teams.cpu[0].hp = 5;
  s.teams.cpu[2].hp = 10;
  E.roll(s, 'player', fixed(6)); // 燎原 6 燃え尽きる刃 38
  E.useMove(s, 'player', 0);
  assert.equal(s.teams.cpu[0].hp, 0);
  assert.equal(s.teams.cpu[2].hp, 0);
  assert.equal(s.teams.cpu[1].hp, 105 - 38);
  assert.equal(s.phase, 'replace');
  assert.deepEqual(s.pendingReplace, { side: 'cpu', resume: 'endTurn', need: 2 });
  assert.deepEqual(s.front.cpu, [1]);
  // 補充中は他の操作ができない
  assert.equal(E.roll(s, 'cpu', fixed(1)).ok, false);
  assert.equal(E.useMove(s, 'player', 1).ok, false);
  assert.equal(E.chooseReplacement(s, 'player', 3).ok, false, '補充するのは相手');
  assert.equal(E.chooseReplacement(s, 'cpu', 0).ok, false, '戦闘不能は出せない');
  assert.equal(E.chooseReplacement(s, 'cpu', 1).ok, false, 'すでに前衛');
  const turns = s.turnCount.cpu;
  assert.ok(E.chooseReplacement(s, 'cpu', 3).ok);
  assert.equal(s.phase, 'replace');
  assert.ok(E.chooseReplacement(s, 'cpu', 5).ok);
  assert.deepEqual(s.front.cpu, [1, 3, 5]);
  assert.equal(s.teams.cpu[3].hp, s.teams.cpu[3].maxHp, '補充キャラは直前の攻撃を受けない');
  assert.equal(s.teams.cpu[5].hp, s.teams.cpu[5].maxHp);
  assert.equal(s.turnSide, 'cpu');
  assert.equal(s.turnCount.cpu, turns + 1, '補充はターンを消費しない（相手のターンが1回始まるだけ）');
  assert.equal(s.swapUsed, false);
});

test('後衛がいなければ前衛3体未満でも進行する', () => {
  const s = battle();
  [3, 4, 5].forEach(i => { s.teams.cpu[i].hp = 0; });
  s.teams.cpu[0].hp = 5;
  playerMove(s, 6, 0);
  assert.deepEqual(s.front.cpu, [1, 2]);
  assert.equal(s.phase, 'roll');
  assert.equal(s.turnSide, 'cpu');
  E.roll(s, 'cpu', fixed(4));
  assert.equal(E.useMove(s, 'cpu', 0).ok, false);
  assert.ok(E.useMove(s, 'cpu', 1).ok);
  // 前衛2体でも全員に当たる
  s.teams.cpu[1].hp = 1; s.teams.cpu[2].hp = 1;
  playerMove(s, 1, 0); // 火花 8
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 'player');
});

test('スキルで倒したら補充後、同じ数字で通常技に戻る（スキルの後も交代はできる）', () => {
  const s = battle([4, 0, 1]);
  s.teams.cpu[1].hp = 15;
  E.roll(s, 'player', fixed(2));
  const r = E.useSkill(s, 'player', 4); // 虚空の穿孔：敵前衛全員に20（防御無視）
  assert.ok(r.ok);
  assert.deepEqual(hps(s, 'cpu').slice(0, 3), [90, 0, 110]);
  assert.equal(s.phase, 'replace');
  assert.equal(s.pendingReplace.resume, 'action');
  E.chooseReplacement(s, 'cpu', 4);
  assert.equal(s.phase, 'action');
  assert.equal(s.dice, 2);
  assert.equal(s.skillUsed, true);
  assert.equal(E.useSkill(s, 'player', 0).ok, false, 'スキルは1ターン1回');
  assert.ok(E.swap(s, 'player', 0, 3).ok, 'スキルの後でも交代できる');
  assert.equal(E.swap(s, 'player', 3, 0).ok, false, '交代は1ターン1回');
  assert.equal(s.teams.cpu[4].hp, 100, '補充キャラはスキルを受けていない');
  assert.ok(E.useMove(s, 'player', 3).ok);
});

test('スキルだけで全滅したら通常技に進まず決着', () => {
  const s = battle([4, 0, 1]);
  s.teams.cpu.forEach((u, i) => { u.hp = i < 3 ? 20 : 0; });
  E.roll(s, 'player', fixed(1));
  E.useSkill(s, 'player', 4);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 'player');
  assert.equal(E.useMove(s, 'player', 0).ok, false);
  assert.equal(E.roll(s, 'cpu', fixed(1)).ok, false);
});

test('固有スキル：後衛からも使える・1ターン1回・全体効果・結界は本人に紐づく', () => {
  const s = battle([2, 1, 0]);
  E.roll(s, 'player', fixed(1));
  assert.equal(E.skillBlockReason(s, 'player', 3), null, '後衛（琥珀）でもスキルを使える');
  assert.ok(E.useSkill(s, 'player', 3).ok); // 後衛の琥珀の結界：対象は味方前衛全員（本人は後衛なので付かない）
  assert.deepEqual(s.front.player, [2, 1, 0], 'スキル使用で前衛は変わらない');
  assert.deepEqual(s.teams.player.map(u => u.barrier), [true, true, true, false, false, false]);
  assert.match(E.useSkill(s, 'player', 1).error, /すでに固有スキル/);
  E.useMove(s, 'player', 1, 0);
  // 雷鳴のスキル（12・結界有効）で前衛3体とも半減して消費
  E.roll(s, 'cpu', fixed(1));
  const b = hps(s, 'player');
  E.useSkill(s, 'cpu', 1);
  assert.deepEqual(b.map((h, i) => h - s.teams.player[i].hp), [6, 6, 6, 0, 0, 0], '後衛の琥珀は被弾しない');
  assert.ok(s.teams.player.every(u => !u.barrier));
  // 回復スキルは前衛全員
  const s2 = battle();
  s2.teams.player.forEach(u => { u.hp = 30; });
  E.roll(s2, 'player', fixed(1));
  E.useSkill(s2, 'player', 1); // 月泉の祝福 35
  assert.deepEqual(hps(s2, 'player'), [65, 65, 65, 30, 30, 30]);
  // 防御無視は結界を消費しない
  const s3 = battle([4, 0, 1]);
  s3.teams.cpu[0].barrier = true;
  E.roll(s3, 'player', fixed(1));
  E.useSkill(s3, 'player', 4);
  assert.equal(s3.teams.cpu[0].barrier, true);
  assert.equal(s3.teams.cpu[0].hp, 90);
});

test('CD：待ち3を第1ターンに使うと第4ターンに再使用・相手ターンでは減らない', () => {
  const s = battle([3, 0, 1]);
  E.roll(s, 'player', fixed(4));
  E.useSkill(s, 'player', 3);
  assert.equal(s.teams.player[3].cd, 3);
  E.useMove(s, 'player', 0);
  assert.equal(s.teams.player[3].cd, 3, '相手のターン開始では減らない');
  cpuMove(s, 5);
  assert.equal(s.teams.player[3].cd, 2);
  playerMove(s, 4, 0); cpuMove(s, 5);
  assert.equal(s.teams.player[3].cd, 1);
  playerMove(s, 4, 0); cpuMove(s, 5);
  assert.equal(s.teams.player[3].cd, 0);
  E.roll(s, 'player', fixed(4));
  assert.ok(E.useSkill(s, 'player', 3).ok);
});

test('振り直しスキルだけが数字を変える', () => {
  const s = battle([2, 0, 1]);
  E.roll(s, 'player', fixed(4));
  assert.ok(E.useSkill(s, 'player', 2, fixed(1)).ok);
  assert.equal(s.dice, 1);
  assert.equal(s.teams.player[2].cd, 3);
  E.previewMove(s, 'player', 0); E.moveBlockReason(s, 'player', 3);
  assert.equal(s.dice, 1, '確認・選び直しでは変わらない');
});

test('翠樹の活力：前衛全員回復＋攻撃+10（攻撃0の技は加算なし）', () => {
  const s = battle([0, 1, 2], [0, 1, 2], ['suiju', 'gessen', 'gyakufu', 'kohaku', 'yoiyami', 'mukai'], ['ryogen', 'raimei', 'kohaku', 'suiju', 'gessen', 'mukai']);
  s.teams.player.forEach(u => { u.hp = 50; });
  E.roll(s, 'player', fixed(2)); // 棘の種 16
  E.useSkill(s, 'player', 0);
  assert.deepEqual(hps(s, 'player'), [70, 70, 70, 50, 50, 50]);
  const b = hps(s, 'cpu');
  E.useMove(s, 'player', 0); // (16+10)=26：燎原（火）等倍26、雷鳴26、琥珀26
  assert.deepEqual(b.map((h, i) => h - s.teams.cpu[i].hp), [26, 26, 26, 0, 0, 0]);
});

test('回復疲労：16巡目90%、以降10ポイントずつ減り最低25%・切り捨て', () => {
  assert.equal(E.healPercent(15), 100);
  assert.equal(E.healPercent(16), 90);
  assert.equal(E.healPercent(17), 80);
  assert.equal(E.healPercent(23), 25);
  assert.equal(E.healPercent(60), 25);
  assert.equal(E.fatiguedHeal(39, 16), 35);
  const s = battle();
  s.round = 18; // 70%
  s.teams.player.forEach(u => { u.hp = 10; });
  E.roll(s, 'player', fixed(1));
  E.useSkill(s, 'player', 1); // 35 → 24
  assert.deepEqual(hps(s, 'player'), [34, 34, 34, 10, 10, 10]);
});

test('全滅で決着・新しい戦闘は初期状態', () => {
  const s = battle();
  s.teams.cpu.forEach((u, i) => { u.hp = i < 3 ? 1 : 0; });
  playerMove(s, 1, 0);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 'player');
  assert.equal(E.swap(s, 'player', 0, 3).ok, false);
  const n = E.createBattle(P, C);
  assert.equal(n.round, 0);
  assert.equal(n.log.length, 0);
  assert.equal(n.dice, null);
  assert.deepEqual(n.front, { player: [], cpu: [] });
  n.teams.player.concat(n.teams.cpu).forEach(u => { assert.equal(u.hp, u.maxHp); assert.equal(u.cd, 0); assert.equal(u.barrier, false); });
});

test('キャラクターデータ（技8個以上・初期構成・リーダースキル・属性・副属性・説明文の対象範囲）', () => {
  assert.ok(E.CHARACTERS.length >= 8);
  assert.equal(new Set(E.CHARACTERS.map(c => c.id)).size, E.CHARACTERS.length, 'IDの重複');
  assert.equal(new Set(E.CHARACTERS.map(c => c.name)).size, E.CHARACTERS.length, '名前の重複');
  assert.equal(E.CONFIG.TEAM_SIZE, 6);
  assert.equal(E.CONFIG.FRONT_SIZE, 3);
  E.CHARACTERS.forEach(c => {
    assert.ok(c.moves.length >= 8, c.name + 'の技が8個未満');
    assert.equal(new Set(c.moves.map(m => m.name)).size, c.moves.length, '技名の重複');
    assert.equal(E.loadoutError(c.id, E.defaultLoadout(c.id)), null, '初期構成が上限内');
    assert.ok(c.leaderSkill && c.leaderSkill.name && c.leaderSkill.text && c.leaderSkill.effects.length);
    assert.ok(E.ELEMENTS[c.element]);
    assert.ok(Array.isArray(c.subTypes) && c.subTypes.length >= 1);
    c.skill.effects.forEach(e => {
      if (e.type === 'damage') assert.match(c.skill.text, /敵前衛全員/);
      if (e.type === 'heal' || e.type === 'barrier') assert.match(c.skill.text, /味方前衛全員/);
    });
  });
});

test('CPUは状態を書き換えずに判断し、戦闘不能を使わない・通常技は前衛のみ', () => {
  const s = battle();
  playerMove(s, 4, 0);
  s.teams.cpu[0].hp = 0;
  E.roll(s, 'cpu', fixed(2));
  const snap = JSON.stringify(s);
  const d = CPU.decide(s, 'cpu', E.createRng(1));
  assert.equal(JSON.stringify(s), snap);
  if (d.type === 'move' || d.type === 'skill') {
    const u = d.type === 'move' ? d.unit : d.user;
    assert.ok(s.teams.cpu[u].hp > 0);
    if (d.type === 'move') assert.ok(E.isFront(s, 'cpu', u));
  }
});

test('CPUは倒せるときに倒す', () => {
  const s = battle([0, 1, 2], [1, 0, 2]);
  playerMove(s, 4, 0);
  s.teams.player.forEach((u, i) => { u.hp = i < 3 ? 20 : 0; });
  E.roll(s, 'cpu', fixed(4)); // 雷鳴 天雷42 で前衛全滅＝勝利
  const rng = E.createRng(3);
  while (s.turnSide === 'cpu' && s.phase === 'action') assert.ok(CPU.act(s, 'cpu', rng).ok);
  assert.equal(s.winner, 'cpu');
});

test('CPU同士の自動対戦が決着まで進む（120戦）', () => {
  const rounds = [];
  for (let g = 0; g < 120; g++) {
    const rng = E.createRng(1000 + g);
    const s = E.createBattle(E.randomTeam(rng), E.randomTeam(rng));
    let steps = 0;
    while (s.phase !== 'over') {
      assert.ok(++steps < 3000, '決着しない');
      if (s.phase === 'initiative') { assert.ok(E.rollInitiative(s, rng).ok); continue; }
      const side = s.phase === 'formation' ? (s.front.player.length ? 'cpu' : 'player')
        : s.phase === 'replace' ? s.pendingReplace.side : s.turnSide;
      const r = CPU.act(s, side, rng);
      assert.ok(r.ok, r.error);
      if (s.phase === 'roll' || s.phase === 'action') {
        ['player', 'cpu'].forEach(sd => {
          assert.ok(s.front[sd].every(i => s.teams[sd][i].hp > 0), '行動中の前衛に戦闘不能がいない');
          assert.equal(s.front[sd].length, Math.min(3, E.aliveIndexes(s, sd).length), '前衛は可能な限り3体');
        });
      }
    }
    assert.ok(E.allDown(s, s.winner === 'player' ? 'cpu' : 'player'));
    rounds.push(s.round);
  }
  rounds.sort((a, b) => a - b);
  assert.ok(rounds[rounds.length >> 1] <= 20, '中央値が長すぎる: ' + rounds[rounds.length >> 1]);
});
