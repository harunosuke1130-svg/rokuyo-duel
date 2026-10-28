// ブラウザ操作テスト（Playwright + Chromium）— この端末に保存するモード（Firebase なし）
// 単一HTML（dist/rikuyou-duel.html）を file:// で開く。対人戦だけは http で配信して2つのタブで遊ぶ。
// 実行：npm run e2e
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');
const H = require('./helpers.js');

const FILE = 'file://' + path.join(__dirname, '..', 'dist', 'rikuyou-duel.html');
const TAP_GUARD = 470;

let browser;
let server;
let httpBase;
test.before(async () => {
  browser = await chromium.launch();
  // 対人戦（BroadcastChannel・localStorage 共有）用の簡易サーバー
  server = http.createServer((req, res) => {
    const f = path.join(__dirname, '..', 'dist', 'rikuyou-duel.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  httpBase = `http://127.0.0.1:${server.address().port}/`;
});
test.after(async () => { await browser.close(); server.close(); });

async function open(kind, query = 'fast=1&seed=42', ctxIn) {
  const ctx = ctxIn || await browser.newContext(H.VIEWPORTS[kind]);
  const page = await ctx.newPage();
  const watch = H.watchPage(page);
  await page.goto(FILE + '?' + query);
  return Object.assign({ ctx, page }, watch);
}

for (const kind of ['mobile', 'desktop']) {
  test(`${kind}: はじめる→ログインボーナス→チーム→技カスタム→保存が残る`, async () => {
    const { ctx, page, errors, external } = await open(kind);
    await H.startLocal(page, 'はるの', { claim: true });
    let p = await H.profile(page);
    assert.equal(p.stones, 350, '初期300＋ログインボーナス50');
    assert.equal(Object.keys(p.chars).length, 6);
    assert.equal(p.login.streak, 1);
    assert.equal(await page.$('#btn-bonus'), null, '同じ日は2回受け取れない');

    // チーム画面：未所持は選べない・技のカスタムを保存
    await page.click('[data-go="team"]');
    await page.waitForSelector('#screen-team:not(.hidden)');
    assert.equal(await page.$$eval('.pick-card.locked', c => c.length), 2);
    assert.equal(await page.isDisabled('#btn-team-ok'), false, '初期チーム6体が選ばれている');
    const first = p.team[0];
    await page.click(`[data-edit="${first}"]`);
    await page.click('[data-slot="0"]');
    await page.click('[data-slot="5"]');
    await page.click('#btn-lo-save');
    await page.waitForSelector('#modal', { state: 'hidden' });
    p = await H.profile(page);
    assert.deepEqual(p.loadouts[first], [5, 1, 2, 3, 4, 0]);
    // 選択を外すと保存できない → 戻すと保存できる
    await page.click(`[data-pick="${first}"] .uc-name`);
    assert.equal(await page.isDisabled('#btn-team-ok'), true);
    await page.click(`[data-pick="${first}"] .uc-name`);
    await page.click('#btn-team-ok');
    await page.waitForSelector('#screen-home:not(.hidden)');

    // 再読み込みしてもプロフィールが残る（同じタブ＝同じプレイヤーで続く）
    await page.reload();
    await page.waitForSelector('#screen-home:not(.hidden)');
    p = await H.profile(page);
    assert.equal(p.stones, 350);
    assert.deepEqual(p.loadouts[first], [5, 1, 2, 3, 4, 0]);
    assert.ok(await H.noHorizontalScroll(page));
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await ctx.close();
  });
}

test('mobile: ガチャ（1回・10回・石不足）', async () => {
  const { ctx, page, errors } = await open('mobile');
  await H.startLocal(page, 'ガチャ係', { claim: false });
  await page.click('[data-go="gacha"]');
  await page.waitForSelector('#screen-gacha:not(.hidden)');
  assert.equal(await page.isDisabled('#btn-gacha-10'), true, '300石では10回は引けない');
  await page.click('#btn-gacha-1');
  await page.waitForSelector('#modal[data-kind="gacha"]:not(.hidden)');
  assert.equal(await page.$$eval('.gacha-card', c => c.length), 1);
  await page.dblclick('#modal [data-close="1"].btn', { force: true }).catch(() => {});
  let p = await H.profile(page);
  assert.equal(p.stones, 200, '連打しても1回分');
  await page.evaluate(() => { window.RikuyouApp.getProfile().stones = 900; });
  await page.click('#btn-home');
  await page.click('[data-go="gacha"]');
  assert.equal(await page.isDisabled('#btn-gacha-10'), false);
  await page.click('#btn-gacha-10');
  await page.waitForSelector('#modal[data-kind="gacha"]:not(.hidden)');
  assert.equal(await page.$$eval('.gacha-card', c => c.length), 10);
  p = await H.profile(page);
  assert.equal(p.stones, 0);
  const owned = Object.keys(p.chars).length;
  assert.ok(owned >= 6 && owned <= 8);
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const kind of ['mobile', 'desktop']) {
  test(`${kind}: 戦闘の基本（先攻後攻のサイコロ・数字→交代→技1つ・後衛は無傷・連打防止）`, async () => {
    const { ctx, page, errors, external } = await open(kind, 'fast=1&seed=' + (kind === 'mobile' ? 11 : 12));
    await H.startLocal(page, 'テスト', { claim: false });
    await page.click('[data-go="free"]');
    await H.formation(page, [0, 1, 2], 1);
    let s = await H.state(page);
    assert.ok(s.initiative, '先攻・後攻のサイコロを振った');
    assert.notEqual(s.initiative.player, s.initiative.cpu);
    assert.equal(s.firstSide, s.initiative.player > s.initiative.cpu ? 'player' : 'cpu');
    assert.ok(s.log.some(l => l.text.includes('先攻・後攻のサイコロ')));
    await H.waitMyRoll(page);

    await page.dblclick('#btn-roll');
    await H.waitMyAction(page);
    s = await H.state(page);
    const dice = s.dice;
    assert.equal(s.log.filter(l => l.kind === 'dice' && l.text.startsWith('あなたの出目')).length, 1, '連打しても1回');
    assert.equal(await page.$$eval('#move-options .mo-card', c => c.length), s.front.player.filter(i => s.teams.player[i].hp > 0).length);

    // 交代をキャンセル → 確定（HP・CDは保持、数字は変わらない）
    const out = s.front.player[0];
    const inn = s.teams.player.findIndex((u, i) => u.hp > 0 && s.front.player.indexOf(i) < 0);
    await page.click('#btn-swap');
    await page.click(`#modal .target-btn[data-target="${out}"]`);
    await page.click('#modal [data-close="1"].btn');
    assert.deepEqual((await H.state(page)).front.player, s.front.player);
    await page.waitForTimeout(TAP_GUARD);
    await page.evaluate(i => { const st = window.RikuyouApp.getState(); st.teams.player[i].hp = 41; st.teams.player[i].cd = 2; }, out);
    await page.click('#btn-swap');
    await page.click(`#modal .target-btn[data-target="${out}"]`);
    await page.click(`#modal .target-btn[data-target="${inn}"]`);
    await page.dblclick('#btn-confirm-swap', { force: true }).catch(() => {});
    await H.waitMyAction(page);
    s = await H.state(page);
    assert.ok(s.front.player.indexOf(inn) >= 0 && s.front.player.indexOf(out) < 0);
    assert.equal(s.teams.player[out].hp, 41);
    assert.equal(s.teams.player[out].cd, 2);
    assert.equal(s.dice, dice);
    assert.equal(s.log.filter(l => l.text.startsWith('味方の交代：')).length, 1, '自分の交代は1回だけ');

    // 技を1つ（確定ボタン連打でも1回）。相手の後衛は無傷
    const foeBack = s.teams.cpu.map((u, i) => (s.front.cpu.indexOf(i) < 0 ? u.hp : null));
    await page.waitForTimeout(TAP_GUARD);
    await page.click(`#move-options [data-move="${inn}"]`);
    await page.dblclick('#btn-confirm-move', { force: true }).catch(() => {});
    await page.waitForFunction(() => { const st = window.RikuyouApp.getState(); return st.turnSide === 'cpu' || st.phase !== 'action'; });
    s = await H.state(page);
    assert.equal(s.log.filter(l => l.kind === 'move' && l.text.startsWith('味方')).length, 1);
    s.teams.cpu.forEach((u, i) => { if (foeBack[i] !== null) assert.equal(u.hp, foeBack[i]); });
    assert.equal(await page.isHidden('#btn-home'), true, '戦闘中はホームボタンを出さない');
    assert.ok(await H.noHorizontalScroll(page));
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await ctx.close();
  });
}

test('mobile: ダンジョン1層を決着まで遊び、報酬・経験値・クリア記録が保存される', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=7');
  await H.startLocal(page, '探索者', { claim: false });
  const before = await H.profile(page);
  await page.click('[data-go="dungeon"]');
  assert.equal(await page.$('[data-floor="forest:1"]'), null, '2層は未解放');
  await page.click('[data-floor="forest:0"]');
  await H.formation(page, [0, 1, 2], 0);
  assert.ok(await H.autoplay(page), '決着しなかった');
  const s = await H.state(page);
  const won = s.winner === 'player';
  const p = await H.profile(page);
  const exp = won ? 60 : 18;
  const id = before.team[0];
  const gained = (p.chars[id].level - 1) * 100 + p.chars[id].exp; // Lv2までは100
  assert.equal(gained, exp, '経験値');
  assert.equal(p.stones, before.stones + (won ? 100 : 0));
  assert.equal(!!p.dungeon.cleared['forest:0'], won);
  assert.ok((await page.textContent('#modal')).includes(`経験値 +${exp}`));
  // 再戦：新しい戦闘は初期状態（前の戦闘の非同期処理が残らない）
  await page.click('#btn-retry');
  await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)');
  await page.waitForTimeout(300);
  const n = await H.state(page);
  assert.equal(n.phase, 'formation');
  assert.equal(n.round, 0);
  assert.equal(n.log.length, 0);
  n.teams.player.concat(n.teams.cpu).forEach(u => { assert.equal(u.hp, u.maxHp); assert.equal(u.cd, 0); });
  // 2回目の敵は同じ1層
  assert.deepEqual(n.teams.cpu.map(u => u.charId), ['suiju', 'gyakufu', 'kohaku', 'raimei', 'gessen', 'mukai']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('desktop: 2つのタブでプレイヤー対戦（ルーム作成→コードで参加→決着まで）', async () => {
  const ctx = await browser.newContext(H.VIEWPORTS.desktop);
  const a = await ctx.newPage(); const wa = H.watchPage(a);
  const b = await ctx.newPage(); const wb = H.watchPage(b);
  await a.goto(httpBase + '?fast=1&seed=21');
  await b.goto(httpBase + '?fast=1&seed=22');
  await H.startLocal(a, 'ホスト', { claim: false });
  await H.startLocal(b, 'ゲスト', { claim: false });
  const code = await H.createRoom(a);
  // ゲスト：待機中ルーム一覧に出ている
  await b.click('[data-go="lobby"]');
  await b.waitForSelector(`[data-room="${code}"]`);
  await H.joinRoom(b, code);
  await H.pvpFormation(a, [0, 1, 2], 0);
  await H.pvpFormation(b, [3, 4, 5], 1);
  const res = await H.playPvp(a, b);
  assert.ok(res, '対戦が決着しなかった');
  const sa = await H.state(a), sb = await H.state(b);
  assert.equal(sa.phase, 'over');
  assert.deepEqual(sa.teams, sb.teams, '両方の画面で同じ戦闘状態');
  assert.equal(sa.winner, sb.winner);
  assert.equal(await a.evaluate(() => window.RikuyouApp.me()), 'player');
  assert.equal(await b.evaluate(() => window.RikuyouApp.me()), 'cpu');
  const pa = await H.profile(a), pb = await H.profile(b);
  assert.equal(pa.pvp.wins + pa.pvp.losses, 1);
  assert.equal(pb.pvp.wins + pb.pvp.losses, 1);
  assert.equal(pa.pvp.wins, pb.pvp.losses, '一方が勝ち、もう一方が負け');
  assert.deepEqual(wa.errors, []);
  assert.deepEqual(wb.errors, []);
  await ctx.close();
});

test('mobile: 通常速度（演出あり）でも相手のターン中は操作できない', async () => {
  const { ctx, page, errors } = await open('mobile', 'seed=5');
  await H.startLocal(page, 'ゆっくり', { claim: false });
  await page.click('[data-go="free"]');
  await H.formation(page, [0, 1, 2], 0);
  await H.waitMyRoll(page, 20000);
  await page.click('#btn-roll');
  assert.equal(await page.isDisabled('#btn-roll'), true);
  await H.waitMyAction(page, 20000);
  const s = await H.state(page);
  await page.waitForTimeout(TAP_GUARD);
  await page.click(`#move-options [data-move="${s.front.player[0]}"]`);
  await page.click('#btn-confirm-move');
  await page.waitForFunction(() => window.RikuyouApp.getState().turnSide === 'cpu' || window.RikuyouApp.getState().phase !== 'action');
  if ((await H.state(page)).phase !== 'over') {
    assert.equal(await page.isDisabled('#btn-roll'), true);
    assert.equal(await page.isDisabled('#btn-swap'), true);
    assert.equal(await page.$$eval('#move-options .mo-card', c => c.length), 0);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});
