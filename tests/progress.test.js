// レベル・先攻後攻・降参・プロフィール（ガチャ・ログインボーナス・ダンジョン・対人戦報酬）のテスト
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const P = require('../src/profile.js');
const D = require('../src/data.js');
const CPU = require('../src/cpu.js');

const fixed = d => () => (d - 1) / 6 + 0.01;
const seq = vals => { let k = 0; return () => vals[k++ % vals.length]; };
const TEAM = ['ryogen', 'gessen', 'gyakufu', 'kohaku', 'yoiyami', 'mukai'];
const FOE = ['suiju', 'raimei', 'mukai', 'kohaku', 'gessen', 'ryogen'];

test('レベル：最大HP・攻撃力・回復力が上がる（攻撃力はスキルのダメージにも掛かる）', () => {
  assert.equal(E.levelMaxHp(120, 1), 120);
  assert.equal(E.levelMaxHp(120, 11), 168);   // +40%
  assert.equal(E.levelMaxHp(95, 30), 205);    // 95×2.16=205.2
  assert.equal(E.levelAtkBonus(1), 0);
  assert.equal(E.levelAtkBonus(11), 10);
  assert.equal(E.clampLevel(99), 99, 'Lv30を超えても上げられる');
  assert.equal(E.clampLevel(1e6), D.CONFIG.LEVEL.max);
  // Lv31〜90 は HP だけ少し緩く（+3%）、伸びは+1のまま。Lv91からは HP+1%・伸びは2レベルで+1
  assert.equal(E.levelMaxHp(100, 31), 219);
  assert.equal(E.levelMaxHp(100, 90), 396);
  assert.equal(E.levelMaxHp(100, 100), 406);
  assert.equal(E.levelAtkBonus(31), 30);
  assert.equal(E.levelAtkBonus(90), 89);
  assert.equal(E.levelAtkBonus(100), 94);
  assert.equal(E.clampLevel(0), 1);
  // 燎原の剣士（★3・猛火）：攻撃力 12×(1+10/15)=20、回復力 9×(1+10/15)=15、HP 1200×1.4=1680
  assert.deepEqual(E.charPower('ryogen', 1), { atk: 12, heal: 9, hp: 1200 });
  assert.deepEqual(E.charPower('ryogen', 11), { atk: 20, heal: 15, hp: 1680 });
  const s = E.createBattle(TEAM, FOE, { levels: { player: { ryogen: 11, yoiyami: 5 } } });
  assert.equal(s.teams.player[0].maxHp, 1680);
  assert.equal(s.teams.player[0].hp, 1680);
  assert.equal(s.teams.player[0].atkPow, 20);
  assert.equal(s.teams.cpu[5].maxHp, 1200, '相手はレベル1');
  E.chooseFormation(s, 'player', [0, 4, 1], null);
  E.chooseFormation(s, 'cpu', [0, 1, 2], null);
  E.rollInitiative(s, seq([0.99, 0.01]));
  E.roll(s, 'player', fixed(3));
  const before = s.teams.cpu.map(u => u.hp);
  E.useMove(s, 'player', 0); // 紅蓮の一閃 ×32・攻撃力20＝640：翠樹（自然）640×1.05=672、雷鳴640、霧海640
  assert.deepEqual(before.map((h, i) => h - s.teams.cpu[i].hp), [672, 640, 640, 0, 0, 0]);
  // スキルのダメージも攻撃力×数字（宵闇 Lv20 の攻撃力23 × 20 ＝ 460・防御無視）
  const s2 = E.createBattle(TEAM, FOE, { levels: { player: { yoiyami: 20 } } });
  assert.equal(s2.teams.player[4].atkPow, 23);
  E.chooseFormation(s2, 'player', [4, 0, 1], null);
  E.chooseFormation(s2, 'cpu', [0, 1, 2], null);
  E.rollInitiative(s2, seq([0.99, 0.01]));
  E.roll(s2, 'player', fixed(1));
  E.useSkill(s2, 'player', 4);
  assert.equal(s2.teams.cpu[0].hp, 1210 - 460);
});

test('攻撃力・回復力・HP：★と属性で決まり、回復は回復力×技の数字', () => {
  const C = D.CONFIG.POWER;
  // ★ごとの基準（★3 は 10）＋属性の特色
  assert.deepEqual(E.basePower('suiju'), { atk: 10 + C.element.nature.atk, heal: 10 + C.element.nature.heal }, '★3 自然');
  assert.deepEqual(E.basePower('mukai'), { atk: 9, heal: 12 }, '★3 水脈：攻撃力-1・回復力+2');
  assert.deepEqual(E.basePower('gessen'), { atk: 9, heal: 10 }, '★2 聖光：回復力+1');
  assert.equal(E.baseMaxHp('kohaku'), 1760, '自然は HP+10%（160×10×1.1）');
  assert.equal(E.baseMaxHp('yoiyami'), 950, '呪闇は HP-5%');
  assert.deepEqual(E.basePower('b-goblin'), { atk: C.boss, heal: C.boss }, 'ダンジョンの敵は一律');
  assert.equal(E.baseMaxHp('b-goblin'), E.getChar('b-goblin').maxHp * 10, '敵は属性の補正なし');
  // ★が高いほど基準が高い
  const stars = Object.keys(C.stars).map(Number).sort();
  stars.slice(1).forEach((st, k) => assert.ok(C.stars[st] >= C.stars[stars[k]]));
  // 回復：霧海の旅人（回復力12）の回復技 → 回復力×数字が味方前衛それぞれに入る
  const s = E.createBattle(TEAM, FOE);
  E.chooseFormation(s, 'player', [5, 1, 2], null);
  E.chooseFormation(s, 'cpu', [0, 1, 2], null);
  E.rollInitiative(s, seq([0.99, 0.01]));
  const k = s.teams.player[5].loadout.findIndex(m => E.getChar('mukai').moves[m].heal > 0);
  assert.ok(k >= 0);
  E.roll(s, 'player', fixed(k + 1));
  s.teams.player[1].hp = 100;
  const pv = E.previewMove(s, 'player', 5);
  const heal = E.unitMove(s.teams.player[5], k + 1).heal;
  assert.equal(pv.healBase, heal * 12);
  E.useMove(s, 'player', 5);
  assert.equal(s.teams.player[1].hp, Math.min(s.teams.player[1].maxHp, 100 + heal * 12));
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
  assert.equal(P.ownedIds(a).length, D.CHARACTERS.length);
  // 保存データからの読み込み：管理用は不足分を補う・不正値は直す
  const s = P.sanitize({ name: 'x', stones: -5, chars: { ryogen: { level: 99, exp: 'a' }, nobody: { level: 3 } }, loadouts: { ryogen: [7, 1, 2, 3, 4, 5], gessen: [0, 1, 2, 3, 4, 6] } }, { uid: 'adm', isAdmin: true });
  assert.equal(s.stones, 0);
  assert.equal(s.chars.ryogen.level, 99);
  assert.equal(s.chars.ryogen.cap, 120, '上限が無い古いデータは、今のレベルが入る上限にする');
  assert.equal(s.chars.nobody, undefined);
  assert.deepEqual(s.items, { crystal: 0, kakera: 0, bookS: 0, bookM: 0, bookL: 0 }, '結晶・かけらが無い古いデータは0個');
  assert.equal(s.dupeMode, 'exp');
  const it = P.sanitize({ chars: { ryogen: { level: 30, cap: 45 } }, items: { crystal: '7', kakera: -3 }, dupeMode: 'kakera' }, { uid: 'u' });
  assert.equal(it.chars.ryogen.cap, 30, 'おかしな上限は直す');
  assert.deepEqual(it.items, { crystal: 7, kakera: 0, bookS: 0, bookM: 0, bookL: 0 });
  assert.equal(it.dupeMode, 'kakera');
  assert.equal(P.ownedIds(s).length, D.CHARACTERS.length);
  assert.deepEqual(s.loadouts, { ryogen: [7, 1, 2, 3, 4, 5] }, 'Lv30なら上限内なので残し、Lv1でまだ使えない技を含む構成は捨てる');
  const lo = P.sanitize({ chars: { ryogen: { level: 13 } }, loadouts: { ryogen: [7, 1, 2, 3, 4, 5] } }, { uid: 'u' });
  assert.deepEqual(lo.loadouts, {}, 'Lv13では上限超えなので捨てる');
  const f = P.sanitize({ formation: { front: ['ryogen', 'nobody', 7, 'gessen'], leader: 'nobody' } }, { uid: 'u' });
  assert.deepEqual(f.formation, { front: ['ryogen', 'gessen'], leader: null }, '前回の配置は知らないキャラを除いて保存');
  assert.equal(P.sanitize({ formation: 'x' }, { uid: 'u' }).formation, null);
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
  assert.equal(p.chars.ryogen.level, 30, '30で止まる（限界突破が必要）');
  assert.equal(p.chars.ryogen.exp, 0);
  assert.ok(P.atCap(p, 'ryogen'));
});

test('限界突破（結晶）：30レベルごとに止まり、結晶で次の30レベルへ', () => {
  const p = P.newProfile({ isAdmin: true });
  assert.equal(P.limitBreak(p, 'ryogen').ok, false, 'Lv30になる前はできない');
  P.addExp(p, 'ryogen', 1e9);
  assert.equal(P.limitBreakCost(30), 5); assert.equal(P.limitBreakCost(60), 10); assert.equal(P.limitBreakCost(90), 15);
  p.items.crystal = 4;
  assert.match(P.limitBreak(p, 'ryogen').error, /結晶が足りません/);
  p.items.crystal = 12;
  assert.deepEqual(P.limitBreak(p, 'ryogen'), { ok: true, cost: 5, from: 30, cap: 60 });
  assert.equal(p.items.crystal, 7);
  P.addExp(p, 'ryogen', 1e9);
  assert.equal(p.chars.ryogen.level, 60);
  assert.equal(P.limitBreak(p, 'ryogen').ok, false, '2回目は結晶10個');
  p.items.crystal = 10;
  assert.equal(P.limitBreak(p, 'ryogen').cap, 90);
  // 保存して読み込んでも上限は残る
  assert.equal(P.sanitize(JSON.parse(JSON.stringify(p)), { uid: 'u' }).chars.ryogen.cap, 90);
});

test('結晶の手に入り方：ダンジョンの階の突破・踏破、CPU対戦の勝利', () => {
  const p = P.newProfile({ uid: 'u' }, E.createRng(4));
  const t = p.team;
  assert.equal(P.applyDungeonFloor(p, 'forest', 0, t, true).crystals, D.ECONOMY.crystal.floorWin);
  assert.equal(P.applyDungeonFloor(p, 'forest', 1, t, false).crystals, 0, '負けると無し');
  assert.equal(P.applyDungeonFloor(p, 'forest', 2, t, true).crystals, D.ECONOMY.crystal.floorWin + D.ECONOMY.crystal.firstClear);
  assert.equal(P.applyDungeonFloor(p, 'forest', 2, t, true).crystals, D.ECONOMY.crystal.floorWin + D.ECONOMY.crystal.clear);
  const m = D.CPU_MATCHES[0].id;
  assert.equal(P.applyMatchResult(p, m, t, true).crystals, D.ECONOMY.crystal.matchFirstWin);
  assert.equal(P.applyMatchResult(p, m, t, true).crystals, D.ECONOMY.crystal.matchWin);
  assert.equal(P.applyMatchResult(p, m, t, false).crystals, 0);
  const C = D.ECONOMY.crystal;
  assert.equal(p.items.crystal, C.floorWin * 3 + C.firstClear + C.clear + C.matchFirstWin + C.matchWin);
});

test('かけら：ガチャで重なったキャラを残すか経験値にするか選べる・どのキャラにも使える', () => {
  const p = P.newProfile({ uid: 'u' }, E.createRng(4));
  const id = p.team[0], other = p.team[1];
  p.stones = 10000;
  const pick = () => (P.gachaPool('all').indexOf(id) + 0.5) / P.gachaPool('all').length;
  // いつもどおり：そのキャラの経験値
  let r = P.drawGacha(p, 1, pick, 'all');
  assert.equal(r.results[0].exp, D.ECONOMY.duplicateExp);
  assert.equal(p.items.kakera, 0);
  // かけらにする
  P.setDupeMode(p, 'kakera');
  r = P.drawGacha(p, 10, pick, 'all');
  assert.ok(r.results.every(x => x.kakera === 1));
  assert.equal(p.items.kakera, 10);
  // 別のキャラに使う。上限を超える分は使わない
  const u = P.useKakera(p, other, 3);
  assert.deepEqual([u.ok, u.used, u.exp], [true, 3, 3 * D.ECONOMY.kakeraExp]);
  assert.equal(p.items.kakera, 7);
  const need = P.kakeraToCap(p, other);
  assert.ok(need > 7);
  P.addExp(p, other, 1e9);
  assert.equal(P.useKakera(p, other, 1).ok, false, '上限のレベルでは使えない');
  assert.equal(p.items.kakera, 7);
  // 上限で止まっているキャラが重なったら、経験値のままでも、かけらになる
  P.setDupeMode(p, 'exp');
  P.addExp(p, id, 1e9);
  r = P.drawGacha(p, 1, pick, 'all');
  assert.equal(r.results[0].kakera, 1);
  assert.equal(p.items.kakera, 8);
});

test('ガチャ：石を消費し、新キャラは所持、持っているキャラは経験値に', () => {
  const p = P.newProfile({ uid: 'u' }, E.createRng(3));
  const missing = P.ALL_IDS.filter(id => !P.owns(p, id));
  assert.equal(missing.length, D.CHARACTERS.length - 6);
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
  const owned10 = P.ownedIds(p).length;
  const r10 = P.drawGacha(p, 10, E.createRng(9));
  assert.equal(r10.results.length, 10);
  assert.equal(p.stones, 0);
  assert.equal(P.ownedIds(p).length, owned10 + r10.results.filter(x => x.isNew).length, '新キャラの数だけ所持が増える');
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

test('対戦（ランク戦）：順番に解放・勝利で経験値と石（初勝利は多め）・敗北は経験値3割', () => {
  const p = P.newProfile({ isAdmin: true });
  p.isAdmin = false; // 全キャラを持った一般アカウントとして、解放の順番を確かめる
  assert.ok(P.matchUnlocked(p, 'm1'));
  assert.ok(!P.matchUnlocked(p, 'm2'));
  const lose = P.applyMatchResult(p, 'm1', ['ryogen'], false);
  assert.deepEqual([lose.exp, lose.stones, lose.firstWin], [18, 0, false]);
  assert.ok(!P.matchUnlocked(p, 'm2'));
  const win = P.applyMatchResult(p, 'm1', ['ryogen', 'gessen'], true);
  assert.deepEqual([win.exp, win.stones, win.firstWin], [60, 100, true]);
  assert.ok(P.matchUnlocked(p, 'm2'));
  assert.equal(P.applyMatchResult(p, 'm1', [], true).stones, 10, '2回目以降');
  assert.equal(P.applyMatchResult(p, 'm5', [], true).ok, false, '未解放は不可');
  const e = P.matchEnemy('m10');
  assert.equal(e.ids.length, 6);
  D.CPU_MATCHES.forEach(m => { assert.ok(E.validateTeam(m.enemies), m.name); assert.ok(m.leader >= 0 && m.leader < 6); });
});

test('ダンジョン：3階（雑魚→中ボス→大ボス）・各階1体・大ボスで踏破と石・次のダンジョンが解放', () => {
  D.DUNGEONS.forEach(d => {
    assert.equal(d.floors.length, 3, d.name);
    assert.deepEqual(d.floors.map(f => E.getChar(f.boss).rank), ['雑魚', '中ボス', '大ボス']);
    d.floors.forEach(f => {
      assert.ok(E.isBoss(f.boss));
      assert.equal(E.getChar(f.boss).moves.length, 6);
      assert.equal(E.loadoutError(f.boss, E.defaultLoadout(f.boss)), null);
    });
  });
  const p = P.newProfile({ isAdmin: true });
  p.isAdmin = false; // 解放の順番は一般アカウントで確かめる
  assert.ok(P.dungeonUnlocked(p, 'forest'));
  assert.ok(!P.dungeonUnlocked(p, 'sea'));
  const f1 = P.applyDungeonFloor(p, 'forest', 0, ['ryogen'], true);
  assert.deepEqual([f1.exp, f1.stones, f1.cleared, f1.last], [50, 0, false, false]);
  const lose = P.applyDungeonFloor(p, 'forest', 1, ['ryogen'], false);
  assert.deepEqual([lose.exp, lose.stones, lose.cleared], [24, 0, false]);
  const boss = P.applyDungeonFloor(p, 'forest', 2, ['ryogen'], true);
  assert.deepEqual([boss.exp, boss.stones, boss.cleared, boss.firstClear], [140, 300, true, true]);
  assert.ok(P.dungeonCleared(p, 'forest'));
  assert.ok(P.dungeonUnlocked(p, 'sea'));
  assert.equal(P.applyDungeonFloor(p, 'forest', 2, [], true).stones, 40, '2回目以降の踏破');
  assert.equal(P.applyDungeonFloor(p, 'tower', 0, [], true).ok, false, '未解放は不可');
  // 分かれ道と合流：requires が配列なら、どれか1つの踏破で解放
  const q = P.newProfile({ isAdmin: false }); q.isAdmin = false;
  const fake = [{ id: 'fork-root', requires: null, floors: [] }, { id: 'fork-a', requires: 'fork-root', floors: [] }, { id: 'fork-b', requires: 'fork-root', floors: [] }, { id: 'join', requires: ['fork-a', 'fork-b'], floors: [] }];
  D.DUNGEONS.push(...fake);
  try {
    assert.deepEqual(P.dungeonSiblings('fork-a').map(d => d.id), ['fork-b']);
    assert.equal(P.dungeonUnlocked(q, 'join'), false);
    q.dungeon.cleared['fork-b'] = true;
    assert.equal(P.dungeonUnlocked(q, 'join'), true);
    assert.deepEqual(P.dungeonRequires(P.getDungeon('forest')), []);
  } finally { D.DUNGEONS.splice(D.DUNGEONS.length - fake.length, fake.length); }
  // ダンジョンのIDは重ならず、解放の条件は実在するダンジョン
  assert.equal(new Set(D.DUNGEONS.map(d => d.id)).size, D.DUNGEONS.length);
  D.DUNGEONS.forEach(d => P.dungeonRequires(d).forEach(r => assert.ok(P.getDungeon(r), d.id + ' の条件 ' + r)));
  const en = P.floorEnemy('forest', 2);
  assert.deepEqual(en.ids, ['b-elder']);
  // ボスはガチャ・チームには出てこない
  assert.ok(P.ALL_IDS.every(id => !E.isBoss(id)));
  assert.equal(E.validateTeam(['b-goblin', 'ryogen', 'gessen', 'gyakufu', 'kohaku', 'mukai']), false);
});

test('階をまたぐHP：生存キャラは最大HPの20%回復、戦闘不能はそのまま', () => {
  const hp = P.carryOverHp([{ charId: 'a', hp: 50, maxHp: 120 }, { charId: 'b', hp: 0, maxHp: 100 }, { charId: 'c', hp: 95, maxHp: 100 }]);
  assert.deepEqual(hp, { a: 74, b: 0, c: 100 });
});

test('階をまたぐHP：その階でレベルが上がったキャラは、戦闘不能でも復活して満タンで次の階へ', () => {
  const units = [{ charId: 'a', hp: 0, maxHp: 120 }, { charId: 'b', hp: 10, maxHp: 100 }, { charId: 'c', hp: 0, maxHp: 100 }];
  const hp = P.carryOverHp(units, [{ id: 'a', from: 3, to: 4 }, { id: 'b', from: 3, to: 5 }, { id: 'c', from: 30, to: 30 }]);
  assert.equal(hp.a, P.FULL_HP); assert.equal(hp.b, P.FULL_HP);
  assert.equal(hp.c, 0, 'レベルが上がらなければ戦闘不能のまま');
  // 次の階の戦闘では、新しいレベルの最大HPで出る
  const team = ['ryogen', 'gessen', 'gyakufu', 'kohaku', 'yoiyami', 'mukai'];
  const s = E.createBattle(team, ['b-boar'], { enemyKind: 'boss', levels: { player: { ryogen: 4 }, cpu: { 'b-boar': 2 } },
    startHp: { player: { ryogen: P.FULL_HP, gessen: 0 } } });
  const r = s.teams.player.find(u => u.charId === 'ryogen');
  assert.equal(r.hp, r.maxHp); assert.equal(s.teams.player.find(u => u.charId === 'gessen').hp, 0);
});

test('ボス戦：敵1体でも進行し、前衛が3体未満の配置・HPの引き継ぎ・リーダーのHPアップは減ったHPを保つ', () => {
  const team = ['ryogen', 'gessen', 'gyakufu', 'kohaku', 'yoiyami', 'mukai'];
  const s = E.createBattle(team, ['b-goblin'], {
    enemyKind: 'boss', levels: { cpu: { 'b-goblin': 3 } },
    startHp: { player: { ryogen: 0, gessen: 0, gyakufu: 0, kohaku: 0, yoiyami: 40, mukai: 10 } }
  });
  assert.equal(s.teams.cpu.length, 1);
  assert.equal(s.teams.cpu[0].maxHp, E.charPower('b-goblin', 3).hp);
  assert.equal(E.frontRequired(s, 'player'), 2, '生存2体なら前衛2体');
  assert.equal(E.frontRequired(s, 'cpu'), 1);
  assert.equal(E.chooseFormation(s, 'player', [4, 5, 0], 3).ok, false, '戦闘不能は前衛にできない');
  assert.ok(E.chooseFormation(s, 'player', [4, 5], 3).ok); // 琥珀の砦：最大HP+10%（倒れているキャラも最大HPは上がる）
  assert.equal(s.teams.player[4].maxHp, 1045, '宵闇 950 の 10%増し');
  assert.equal(s.teams.player[4].hp, 135, '40＋上がった95');
  assert.equal(s.teams.player[0].hp, 0, '戦闘不能は復活しない');
  assert.ok(E.chooseFormation(s, 'cpu', [0], null).ok);
  assert.ok(E.rollInitiative(s, E.createRng(9)).ok);
  // CPU同士で決着まで
  const rng = E.createRng(5);
  let n = 0;
  while (s.phase !== 'over' && n++ < 3000) {
    const side = s.phase === 'replace' ? s.pendingReplace.side : s.turnSide;
    assert.ok(CPU.act(s, side, rng).ok);
  }
  assert.equal(s.phase, 'over');
  assert.throws(() => E.createBattle(team, ['b-goblin'], { enemyKind: 'boss', startHp: { player: { ryogen: 0, gessen: 0, gyakufu: 0, kohaku: 0, yoiyami: 0, mukai: 0 } } }), /戦えるキャラ/);
  assert.throws(() => E.createBattle(team, ['b-goblin']), '通常の対戦ではボス1体は不可');
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

test('管理用アカウント：すべての対戦・ダンジョンを選べて、レベルを直接変えられる', () => {
  const a = P.newProfile({ uid: 'adm', name: '管理', isAdmin: true });
  assert.ok(D.CPU_MATCHES.every(m => P.matchUnlocked(a, m.id)), '対戦はすべて解放');
  assert.ok(D.DUNGEONS.every(d => P.dungeonUnlocked(a, d.id)), 'ダンジョンはすべて解放');
  assert.deepEqual(P.setLevel(a, 'ryogen', 25), { ok: true, level: 25 });
  assert.equal(P.levelOf(a, 'ryogen'), 25);
  assert.equal(a.chars.ryogen.exp, 0);
  assert.equal(P.setLevel(a, 'ryogen', 99).level, 99, 'Lv30を超えても');
  assert.equal(a.chars.ryogen.cap, 120, '上限も合わせる');
  assert.equal(P.setLevel(a, 'ryogen', 1e6).level, D.CONFIG.LEVEL.max, '最大レベルまで');
  assert.equal(P.setLevel(a, 'ryogen', 0).level, 1, '最低はLv1');
  // 一般アカウントは今までどおり
  const n = P.newProfile({ uid: 'u', name: '一般' }, E.createRng(1));
  assert.equal(P.matchUnlocked(n, D.CPU_MATCHES[1].id), false);
  assert.equal(P.dungeonUnlocked(n, 'sea'), false);
  const id = P.ownedIds(n)[0];
  assert.equal(P.setLevel(n, id, 10).ok, false);
  assert.equal(P.levelOf(n, id), 1);
});

test('属性ガチャ：その属性のキャラだけが出る・値段は通常と同じ', () => {
  const D2 = require('../src/data.js');
  assert.deepEqual(D2.GACHAS.map(g => g.id), ['all', 'fire', 'water', 'nature', 'holy', 'dark']);
  for (const g of D2.GACHAS.filter(x => x.element)) {
    const pool = P.gachaPool(g.id);
    assert.ok(pool.length >= 1, g.name + 'に1体以上');
    assert.ok(pool.every(id => E.getChar(id).element === g.element));
    const p = P.newProfile({ uid: 'g' }, E.createRng(5));
    p.stones = 900;
    let k = 0;
    const r = P.drawGacha(p, 10, () => ((k++ * 0.37) % 1), g.id);
    assert.ok(r.ok, r.error);
    assert.equal(p.stones, 0, '10回は900石（通常と同じ）');
    assert.ok(r.results.every(x => E.getChar(x.id).element === g.element), g.name + 'はその属性だけ');
  }
  assert.equal(P.gachaPool('all').length, E.CHARACTERS.length);
  assert.equal(P.drawGacha(P.newProfile({ uid: 'h' }), 1, Math.random, 'nothing').ok, false, '無い種類は引けない');
});

test('修練の書：ダンジョン・CPU対戦で手に入り、レベルアップのタブで経験値にできる（上限を超える分は使わない）', () => {
  const p = P.newProfile({ uid: 'u' }, E.createRng(4));
  assert.deepEqual([p.items.bookS, p.items.bookM, p.items.bookL], [0, 0, 0]);
  // 古い保存データ（書の項目なし）も 0 で読める
  const old = JSON.parse(JSON.stringify(p)); delete old.items.bookS; delete old.items.bookM; delete old.items.bookL;
  assert.deepEqual(P.sanitize(old).items, { crystal: 0, kakera: 0, bookS: 0, bookM: 0, bookL: 0 });
  // 森（T=1）：1階 初級2、2階 初級3、3階 中級1＋初踏破 中級1
  const team = p.team.slice();
  assert.deepEqual(P.applyDungeonFloor(p, 'forest', 0, team, true).books, { bookS: 2, bookM: 0, bookL: 0 });
  P.applyDungeonFloor(p, 'forest', 1, team, true);
  const last = P.applyDungeonFloor(p, 'forest', 2, team, true);
  assert.deepEqual(last.books, { bookS: 0, bookM: 2, bookL: 0 });
  assert.equal(P.applyDungeonFloor(p, 'forest', 0, team, false).books.bookS, 0, '負けた階では手に入らない');
  assert.deepEqual([p.items.bookS, p.items.bookM], [5, 2]);
  // 後のダンジョンの初踏破は上級
  assert.equal(P.dungeonBooks(P.getDungeon('eclipse'), 2, true, true, true).bookL, 1);
  // CPU 対戦：初勝利は中級も
  const m = P.applyMatchResult(p, 'm1', team, true);
  assert.deepEqual(m.books, { bookS: 2, bookM: 1, bookL: 0 });
  // レベルアップ：経験値の少ない素材から使い、上限に届いたら残りは使わない
  const id = team[0];
  const plan = P.planItems(p, id, { bookS: 2, bookM: 1 });
  assert.equal(plan.exp, 2 * D.ECONOMY.books.bookS.exp + D.ECONOMY.books.bookM.exp);
  const before = { s: p.items.bookS, m: p.items.bookM };
  const r = P.useItems(p, id, { bookS: 2, bookM: 1 });
  assert.equal(r.ok, true);
  assert.ok(r.to > r.from, 'レベルが上がる');
  assert.deepEqual([p.items.bookS, p.items.bookM], [before.s - 2, before.m - 1]);
  p.items.bookL = 100;
  const big = P.useItems(p, id, { bookL: 100 });
  assert.equal(big.ok, true);
  assert.ok(p.items.bookL > 90, '上限に届いたら残りは使わない');
  assert.ok(P.atCap(p, id));
  assert.equal(P.useItems(p, id, { bookS: 1 }).ok, false, '上限のレベルでは使えない');
});
