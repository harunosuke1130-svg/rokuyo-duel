// レベル・先攻後攻・降参・プロフィール（ガチャ・ログインボーナス・ダンジョン・対人戦報酬）のテスト
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const P = require('../src/profile.js');
const D = require('../src/data.js');

const fixed = d => () => (d - 1) / 6 + 0.01;
const seq = vals => { let k = 0; return () => vals[k++ % vals.length]; };
const TEAM = ['ryogen', 'gessen', 'gyakufu', 'kohaku', 'yoiyami', 'mukai'];
const FOE = ['suiju', 'raimei', 'mukai', 'kohaku', 'gessen', 'ryogen'];

test('レベル：最大HPと通常技の攻撃が上がる（スキルの直接ダメージ・攻撃0の技は対象外）', () => {
  assert.equal(E.levelMaxHp(120, 1), 120);
  assert.equal(E.levelMaxHp(120, 11), 168);   // +40%
  assert.equal(E.levelMaxHp(95, 30), 205);    // 95×2.16=205.2
  assert.equal(E.levelAtkBonus(1), 0);
  assert.equal(E.levelAtkBonus(11), 10);
  assert.equal(E.clampLevel(99), D.CONFIG.LEVEL.max);
  assert.equal(E.clampLevel(0), 1);
  const s = E.createBattle(TEAM, FOE, { levels: { player: { ryogen: 11, yoiyami: 5 } } });
  assert.equal(s.teams.player[0].maxHp, 168);
  assert.equal(s.teams.player[0].hp, 168);
  assert.equal(s.teams.cpu[5].maxHp, 120, '相手はレベル1');
  E.chooseFormation(s, 'player', [0, 4, 1], null);
  E.chooseFormation(s, 'cpu', [0, 1, 2], null);
  E.rollInitiative(s, seq([0.99, 0.01]));
  E.roll(s, 'player', fixed(3));
  const before = s.teams.cpu.map(u => u.hp);
  E.useMove(s, 'player', 0); // 紅蓮の一閃 32+10=42：翠樹（自然）42×1.05=44.1→44、雷鳴42、霧海42
  assert.deepEqual(before.map((h, i) => h - s.teams.cpu[i].hp), [44, 42, 42, 0, 0, 0]);
  // スキルの直接ダメージにはレベル加算なし
  const s2 = E.createBattle(TEAM, FOE, { levels: { player: { yoiyami: 20 } } });
  E.chooseFormation(s2, 'player', [4, 0, 1], null);
  E.chooseFormation(s2, 'cpu', [0, 1, 2], null);
  E.rollInitiative(s2, seq([0.99, 0.01]));
  E.roll(s2, 'player', fixed(1));
  E.useSkill(s2, 'player', 4);
  assert.equal(s2.teams.cpu[0].hp, 110 - 20);
});

test('先攻・後攻はサイコロで決まり、同じ数は振り直し。巡は先攻側のターンで進む', () => {
  const s = E.createBattle(TEAM, FOE);
  E.chooseFormation(s, 'player', [0, 1, 2], null);
  E.chooseFormation(s, 'cpu', [0, 1, 2], null);
  assert.equal(s.phase, 'initiative');
  // 3-3（振り直し）→ 2-5：CPUが先攻
  const r = E.rollInitiative(s, seq([2 / 6 + 0.01, 2 / 6 + 0.01, 1 / 6 + 0.01, 4 / 6 + 0.01]));
  assert.ok(r.ok);
  assert.deepEqual(s.initiative.rolls, [[3, 3], [2, 5]]);
  assert.equal(s.firstSide, 'cpu');
  assert.equal(s.turnSide, 'cpu');
  assert.equal(s.round, 1);
  assert.equal(E.rollInitiative(s, Math.random).ok, false, '2回目は不可');
  E.roll(s, 'cpu', fixed(4)); E.useMove(s, 'cpu', 0);
  assert.equal(s.turnSide, 'player');
  assert.equal(s.round, 1, '後攻のターンでは巡は進まない');
  E.roll(s, 'player', fixed(4)); E.useMove(s, 'player', 0);
  assert.equal(s.round, 2);
  // 分布：おおむね半々
  let first = 0;
  const rng = E.createRng(77);
  for (let i = 0; i < 4000; i++) {
    const t = E.createBattle(TEAM, FOE);
    E.chooseFormation(t, 'player', [0, 1, 2], null); E.chooseFormation(t, 'cpu', [0, 1, 2], null);
    E.rollInitiative(t, rng);
    if (t.firstSide === 'player') first++;
  }
  assert.ok(first > 1850 && first < 2150, String(first));
});

test('降参で相手の勝利・ログの呼び名を対人戦用に変えられる', () => {
  const s = E.createBattle(TEAM, FOE, { labels: { player: { team: 'はるのチーム', who: 'はる' }, cpu: { team: 'ゆきチーム', who: 'ゆき' } } });
  E.chooseFormation(s, 'player', [0, 1, 2], null);
  E.chooseFormation(s, 'cpu', [0, 1, 2], null);
  E.rollInitiative(s, seq([0.99, 0.01]));
  assert.ok(s.log.some(l => l.text.includes('はるの先攻')));
  assert.ok(E.surrender(s, 'cpu').ok);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 'player');
  assert.ok(s.log.some(l => l.text.includes('ゆきは降参した')));
  assert.equal(E.surrender(s, 'player').ok, false);
});

test('プロフィール：初期は6体所持・石300、管理用アカウントは全キャラ所持', () => {
  const p = P.newProfile({ uid: 'u1', name: 'テスト' }, E.createRng(1));
  assert.equal(P.ownedIds(p).length, 6);
  assert.equal(p.stones, 300);
  assert.equal(P.teamError(p, p.team), null);
  const a = P.newProfile({ uid: 'adm', name: '管理', isAdmin: true });
  assert.equal(P.ownedIds(a).length, 8);
  // 保存データからの読み込み：管理用は不足分を補う・不正値は直す
  const s = P.sanitize({ name: 'x', stones: -5, chars: { ryogen: { level: 99, exp: 'a' }, nobody: { level: 3 } }, loadouts: { ryogen: [7, 1, 2, 3, 4, 5] } }, { uid: 'adm', isAdmin: true });
  assert.equal(s.stones, 0);
  assert.equal(s.chars.ryogen.level, D.CONFIG.LEVEL.max);
  assert.equal(s.chars.nobody, undefined);
  assert.equal(P.ownedIds(s).length, 8);
  assert.deepEqual(s.loadouts, {}, '上限超えの技構成は捨てる');
  const n = P.sanitize({ chars: { ryogen: { level: 2 } } }, { uid: 'u' });
  assert.equal(P.ownedIds(n).length, 1, '一般ユーザーは所持分だけ');
});

test('経験値とレベルアップ（必要経験値は100から50ずつ増える）', () => {
  const p = P.newProfile({ isAdmin: true });
  assert.equal(P.expToNext(1), 100);
  assert.equal(P.expToNext(2), 150);
  const r = P.addExp(p, 'ryogen', 260); // 100で2、150で3、残り10
  assert.deepEqual([r.from, r.to], [1, 3]);
  assert.equal(p.chars.ryogen.exp, 10);
  P.addExp(p, 'ryogen', 1e9);
  assert.equal(p.chars.ryogen.level, D.CONFIG.LEVEL.max);
  assert.equal(p.chars.ryogen.exp, 0);
});

test('ガチャ：石を消費し、新キャラは所持、持っているキャラは経験値に', () => {
  const p = P.newProfile({ uid: 'u' }, E.createRng(3));
  const missing = P.ALL_IDS.filter(id => !P.owns(p, id));
  assert.equal(missing.length, 2);
  // 未所持キャラが出る乱数
  const idx = P.ALL_IDS.indexOf(missing[0]);
  const r = P.drawGacha(p, 1, () => (idx + 0.5) / P.ALL_IDS.length);
  assert.ok(r.ok);
  assert.equal(p.stones, 200);
  assert.deepEqual(r.results, [{ id: missing[0], isNew: true }]);
  assert.ok(P.owns(p, missing[0]));
  // 重複
  const r2 = P.drawGacha(p, 1, () => (idx + 0.5) / P.ALL_IDS.length);
  assert.equal(r2.results[0].isNew, false);
  assert.equal(r2.results[0].exp, D.ECONOMY.duplicateExp);
  assert.equal(p.chars[missing[0]].level, 3); // 300 = 100 + 150 + 50
  // 石不足・不正回数
  assert.match(P.drawGacha(p, 10, Math.random).error, /石が足りません/);
  assert.equal(P.drawGacha(p, 3, Math.random).ok, false);
  p.stones = 900;
  const r10 = P.drawGacha(p, 10, E.createRng(9));
  assert.equal(r10.results.length, 10);
  assert.equal(p.stones, 0);
  assert.equal(P.ownedIds(p).length, P.ALL_IDS.length - (P.owns(p, missing[1]) ? 0 : 1));
});

test('ログインボーナス：1日1回・連続日数で額が変わる・途切れたら1日目から（日本時間）', () => {
  const p = P.newProfile({ uid: 'u' }, E.createRng(1));
  const day = (d, h = 12) => new Date(Date.UTC(2026, 9, d, h - 9)); // 日本時間 2026-10-d h時
  const a = P.claimLogin(p, day(1));
  assert.deepEqual([a.ok, a.amount, a.streak], [true, 50, 1]);
  assert.match(P.claimLogin(p, day(1, 23)).error, /受け取り済み/);
  assert.equal(P.claimLogin(p, day(2, 0)).amount, 50);   // 日本時間0時で日付が変わる
  assert.equal(P.claimLogin(p, day(3)).amount, 80);
  for (let d = 4; d <= 7; d++) P.claimLogin(p, day(d));
  assert.equal(p.login.streak, 7);
  assert.equal(p.stones, 300 + 50 + 50 + 80 + 50 + 50 + 80 + 200);
  assert.equal(P.claimLogin(p, day(8)).amount, 50, '8日目は一巡して1日目の額');
  const b = P.claimLogin(p, day(10)); // 9日を飛ばした
  assert.deepEqual([b.amount, b.streak], [50, 1]);
  assert.equal(P.dayKey(new Date(Date.UTC(2026, 9, 1, 15))), '2026-10-02', 'UTC15時＝日本時間0時');
});

test('ダンジョン：順番に解放・勝利で経験値と石（初回は多め）・敗北は経験値3割', () => {
  const p = P.newProfile({ isAdmin: true });
  assert.ok(P.floorUnlocked(p, 'forest', 0));
  assert.ok(!P.floorUnlocked(p, 'forest', 1));
  assert.ok(!P.dungeonUnlocked(p, 'tower'));
  const lose = P.applyDungeonResult(p, 'forest', 0, ['ryogen'], false);
  assert.deepEqual([lose.exp, lose.stones, lose.firstClear], [18, 0, false]);
  assert.ok(!P.floorUnlocked(p, 'forest', 1));
  const win = P.applyDungeonResult(p, 'forest', 0, ['ryogen', 'gessen'], true);
  assert.deepEqual([win.exp, win.stones, win.firstClear], [60, 100, true]);
  assert.equal(p.chars.gessen.exp, 60);
  assert.ok(P.floorUnlocked(p, 'forest', 1));
  assert.equal(P.applyDungeonResult(p, 'forest', 0, [], true).stones, 10, '2回目以降');
  assert.equal(P.applyDungeonResult(p, 'forest', 3, [], true).ok, false, '未解放は不可');
  for (let f = 1; f < 5; f++) P.applyDungeonResult(p, 'forest', f, [], true);
  assert.ok(P.dungeonCleared(p, 'forest'));
  assert.ok(P.floorUnlocked(p, 'tower', 0));
  const enemy = P.floorEnemy('tower', 4);
  assert.equal(enemy.levels.yoiyami, 16);
  assert.equal(enemy.ids.length, 6);
  D.DUNGEONS.forEach(d => d.floors.forEach(f => {
    assert.ok(E.validateTeam(f.enemies), d.name + f.name);
    assert.ok(f.leader >= 0 && f.leader < 6);
  }));
});

test('対人戦の報酬は1日の回数まで', () => {
  const p = P.newProfile({ uid: 'u' }, E.createRng(1));
  const now = new Date(Date.UTC(2026, 9, 1, 3));
  let total = 0;
  for (let i = 0; i < 7; i++) total += P.applyPvpResult(p, true, now).stones;
  assert.equal(total, D.ECONOMY.pvpWinStones * D.ECONOMY.pvpRewardsPerDay);
  assert.equal(p.pvp.wins, 7);
  assert.equal(P.applyPvpResult(p, false, new Date(Date.UTC(2026, 9, 2, 3))).stones, D.ECONOMY.pvpLoseStones, '翌日はまた受け取れる');
});

test('チーム編成は所持キャラ6体のみ・技構成の保存', () => {
  const p = P.newProfile({ uid: 'u' }, E.createRng(2));
  const notOwned = P.ALL_IDS.find(id => !P.owns(p, id));
  assert.match(P.setTeam(p, P.ownedIds(p).slice(0, 5).concat(notOwned)).error, /持っていない/);
  assert.ok(P.setTeam(p, P.ownedIds(p)).ok);
  const id = P.ownedIds(p)[0];
  assert.ok(P.setLoadout(p, id, [5, 4, 3, 2, 1, 0]).ok);
  assert.deepEqual(P.loadoutsFor(p, [id])[id], [5, 4, 3, 2, 1, 0]);
  assert.ok(P.setLoadout(p, id, [0, 1, 2, 3, 4, 5]).ok);
  assert.equal(p.loadouts[id], undefined, '初期構成に戻したら保存しない');
  assert.equal(P.setLoadout(p, notOwned, [0, 1, 2, 3, 4, 5]).ok, false);
});
