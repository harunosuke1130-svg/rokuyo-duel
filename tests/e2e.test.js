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
const E = require('../src/engine.js');
const CHAR_COUNT = E.CHARACTERS.length;

const FILE = 'file://' + path.join(__dirname, '..', 'dist', 'rikuyou-duel.html');
const TAP_GUARD = 470;
const TEST_ADMIN_CODE = 'TEST-ADMIN-1234';

let browser;
let server;
let httpBase;
test.before(async () => {
  browser = await chromium.launch();
  // 対人戦（BroadcastChannel・localStorage 共有）用の簡易サーバー
  server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/docs/firebase-config.js') {
      // 管理用コードのテスト用設定（本物の docs/firebase-config.js は使わない）
      const hash = require('crypto').createHash('sha256').update(TEST_ADMIN_CODE).digest('hex');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(`window.RIKUYOU_FIREBASE = { enabled: false, config: {}, adminEmails: [], emulator: false, localAdminCodeHash: '${hash}' };`);
      return;
    }
    const f = u.indexOf('/docs/') === 0 ? path.join(__dirname, '..', 'docs', 'index.html') : path.join(__dirname, '..', 'dist', 'rikuyou-duel.html');
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
    assert.equal(await page.$$eval('#home-team .portrait-card', c => c.length), 6, 'ホームにチーム6体の絵');
    assert.equal(await page.$$eval('#home-bonus .bonus-day.got', c => c.length), 1, '受け取った日に印');

    // 下のタブから図鑑：全キャラが並び、未所持も詳細を見られる
    await page.click('#tabbar [data-tab="zukan"]');
    await page.waitForSelector('#screen-zukan:not(.hidden)');
    assert.equal(await page.$$eval('.zukan-card', c => c.length), CHAR_COUNT);
    assert.equal(await page.$$eval('.zukan-card.missing', c => c.length), CHAR_COUNT - 6);
    await page.click('.zukan-card.missing');
    await page.waitForSelector('#modal[data-kind="zukan"]:not(.hidden)');
    assert.equal(await page.$$eval('#modal .moves li', c => c.length), 9, '技の候補9個');
    await page.click('#modal-x');
    await page.click('#tabbar [data-tab="home"]');
    await page.waitForSelector('#screen-home:not(.hidden)');

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

// 出撃準備：カードの中心座標
const cardBox = async (page, i) => {
  const b = await (await page.$(`#modal .fm-card[data-idx="${i}"]`)).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const leaderIdx = page => page.$eval('#modal .fm-card.leader', c => Number(c.dataset.idx));

test('desktop: 出撃準備（ドラッグで前後衛を交換・クリックでリーダー・ドラッグ後の誤クリック防止・戦闘に反映）', async () => {
  const { ctx, page, errors } = await open('desktop');
  await H.startLocal(page, '軍師', { claim: false });
  const team = (await H.profile(page)).team;
  await page.click('[data-go="match"]');
  await page.click('[data-match="free"]');
  await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)');
  // 初期配置：前衛3体・後衛3体・リーダー1体（チームの並び順）
  assert.deepEqual(await H.frontIdx(page), [0, 1, 2]);
  assert.equal(await page.$$eval('#modal .fm-grid[data-row="back"] .fm-card', c => c.length), 3);
  assert.equal(await page.$$eval('#modal .fm-card.leader', c => c.length), 1);
  assert.equal(await leaderIdx(page), 0);
  assert.equal(await page.isDisabled('#btn-formation-ok'), false, '最初から出撃できる');
  const s0 = await H.state(page);
  for (const i of [0, 3]) {
    const u = s0.teams.player[i];
    const t = await page.textContent(`#modal .fm-card[data-idx="${i}"]`);
    assert.ok(t.includes(`Lv${u.level}`) && t.includes(`HP ${u.maxHp}`), '実際のレベルとHPを表示');
    assert.ok(await page.$(`#modal .fm-card[data-idx="${i}"] .el-mark[data-el]`), '属性マーク');
  }

  const drag = async (from, to, check) => {
    const a = await cardBox(page, from);
    const b = typeof to === 'number' ? await cardBox(page, to) : to;
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y + 20, { steps: 3 });
    assert.ok(await page.$('.fm-ghost'), 'ドラッグ中はカードが浮く');
    assert.ok(await page.$(`#modal .fm-card.dragging[data-idx="${from}"]`));
    await page.mouse.move(b.x, b.y, { steps: 6 });
    if (check) await check();
    await page.mouse.up();
    assert.equal(await page.$('.fm-ghost'), null);
  };
  // 前衛→後衛へドラッグ：2体が入れ替わる（交換先が強調される）
  await drag(1, 4, async () => assert.ok(await page.$('#modal .fm-card.drop-target[data-idx="4"]'), '交換先を強調'));
  assert.deepEqual(await H.frontIdx(page), [0, 4, 2]);
  assert.equal(await leaderIdx(page), 0, 'ドラッグしてもリーダーは変わらない');
  // 同じ列のカードの上・カード以外で離すと元の位置
  await drag(0, 2, async () => assert.equal(await page.$('#modal .fm-card.drop-target'), null, '同じ列は交換先にならない'));
  await drag(2, { x: 30, y: 30 });
  assert.deepEqual(await H.frontIdx(page), [0, 4, 2]);
  // 後衛→前衛へドラッグし、直後のクリックではリーダーが変わらない
  await drag(5, 2);
  await page.$eval('#modal .fm-card[data-idx="5"]', c => c.click());
  assert.equal(await leaderIdx(page), 0, 'ドラッグ直後のクリックは無視');
  assert.deepEqual(await H.frontIdx(page), [0, 4, 5]);
  assert.equal(await page.$$eval('#modal .fm-card', c => new Set(c.map(x => x.dataset.idx)).size), 6, '重複・消失なし');
  // 短いクリックで後衛のキャラをリーダーに。下部の表示もすぐ変わる
  await page.waitForTimeout(450);
  await page.click('#modal .fm-card[data-idx="1"]');
  assert.equal(await leaderIdx(page), 1);
  assert.ok((await page.textContent('#modal .fm-leader')).includes(await page.$eval('#modal .fm-card[data-idx="1"] .fm-name', n => n.firstChild.textContent)), '下部のリーダー名');
  assert.ok(await page.$('#modal .fm-card[data-idx="1"] .fm-lead .crown'), '王冠とリーダー表示');
  // リーダーを前衛に入れ替えても、リーダー指定はそのキャラのまま
  await drag(1, 0);
  assert.deepEqual(await H.frontIdx(page), [1, 4, 5]);
  assert.equal(await leaderIdx(page), 1);
  // キーボード：Enter でリーダー、入れ替えモードで交換
  await page.waitForTimeout(450);
  await page.focus('#modal .fm-card[data-idx="3"]');
  await page.keyboard.press('Enter');
  assert.equal(await leaderIdx(page), 3);
  await page.focus('#btn-fm-swapmode');
  await page.keyboard.press('Enter');
  await page.focus('#modal .fm-card[data-idx="4"]');
  await page.keyboard.press('Enter');
  await page.focus('#modal .fm-card[data-idx="0"]');
  await page.keyboard.press('Enter');
  assert.deepEqual(await H.frontIdx(page), [1, 0, 5]);
  assert.equal(await leaderIdx(page), 3, '入れ替えモードではリーダーは変わらない');
  await page.focus('#btn-fm-swapmode');
  await page.keyboard.press('Enter');
  // 出撃：画面で決めた配置が戦闘に反映され、次回の初期配置として保存される
  await page.click('#btn-formation-ok');
  await page.waitForFunction(() => { const s = window.RikuyouApp.getState(); return s && s.phase !== 'formation'; });
  const s1 = await H.state(page);
  assert.deepEqual(s1.front.player, [1, 0, 5]);
  assert.equal(s1.leader.player, 3);
  const p1 = await H.profile(page);
  assert.deepEqual(p1.formation, { front: [team[1], team[0], team[5]], leader: team[3] });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: 出撃準備（タッチは長押ししてからドラッグ・すぐ動かすとスクロール扱い）', async () => {
  const { ctx, page, errors } = await open('mobile');
  await H.startLocal(page, '軍師', { claim: false });
  await page.click('[data-go="match"]');
  await page.click('[data-match="free"]');
  await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)');
  assert.ok(await H.noHorizontalScroll(page));
  assert.ok(await page.isVisible('#btn-formation-ok'), 'スマホ縦画面で出撃ボタンが見える');
  // タッチの Pointer Events を順に送る（hold ミリ秒押してから動かす）
  const touchDrag = (from, to, hold, thenClick) => page.evaluate(async ({ from, to, hold, thenClick }) => {
    const card = i => document.querySelector(`#modal .fm-card[data-idx="${i}"]`);
    const mid = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const a = mid(card(from)), b = to === null ? { x: a.x, y: a.y } : mid(card(to));
    const send = (type, p, el) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y, button: 0 }));
    send('pointerdown', a, card(from));
    await new Promise(r => setTimeout(r, hold));
    const lifted = !!document.querySelector('.fm-ghost');
    send('pointermove', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, document);
    send('pointermove', b, document);
    send('pointerup', b, document);
    if (thenClick) card(from).click();
    return lifted;
  }, { from, to, hold, thenClick });
  // すぐ動かした＝縦スクロール：入れ替えない
  assert.equal(await touchDrag(0, 3, 0), false);
  assert.deepEqual(await H.frontIdx(page), [0, 1, 2]);
  // 長押ししてから動かす：入れ替える
  assert.equal(await touchDrag(0, 3, 420), true, '長押しで持ち上がる');
  assert.deepEqual(await H.frontIdx(page), [3, 1, 2]);
  // 長押しして動かさずに離し、続けてクリックが来てもリーダーは変わらない
  assert.equal(await leaderIdx(page), 0);
  await touchDrag(1, null, 420, true);
  assert.equal(await leaderIdx(page), 0);
  assert.deepEqual(await H.frontIdx(page), [3, 1, 2]);
  // 短いタップはリーダー選択
  await page.waitForTimeout(450);
  await page.tap('#modal .fm-card[data-idx="2"]');
  assert.equal(await leaderIdx(page), 2);
  await page.click('#btn-formation-ok');
  await page.waitForFunction(() => { const s = window.RikuyouApp.getState(); return s && s.phase !== 'formation'; });
  const s = await H.state(page);
  assert.deepEqual(s.front.player, [3, 1, 2]);
  assert.equal(s.leader.player, 2);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// 戦闘画面：カードの中心
const btBox = async (page, sel) => {
  const b = await (await page.$(sel)).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const mouseDrag = async (page, fromSel, to, check) => {
  const a = await btBox(page, fromSel);
  const b = typeof to === 'string' ? await btBox(page, to) : to;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 15, a.y - 15, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  if (check) await check();
  await page.mouse.up();
};

test('desktop: 戦闘画面（盤面の右に操作欄・ドラッグで交代・交代できない時・誤発動防止）', async () => {
  const { ctx, page, errors } = await open('desktop', 'fast=1&seed=12');
  await H.startLocal(page, '軍師', { claim: false });
  await page.click('[data-go="match"]');
  await page.click('[data-match="free"]');
  await H.formation(page, [0, 1, 2], 0);
  // PC：盤面と操作欄（出目・行動・戦闘履歴）が横に並ぶ
  const board = await (await page.$('.bt-ally')).boundingBox();
  const side = await (await page.$('.bt-side')).boundingBox();
  assert.ok(side.x >= board.x + board.width - 1, '操作欄は盤面の右');
  assert.ok(await page.isVisible('.bt-log-panel'), 'PCは戦闘履歴を常に表示');
  assert.ok(await H.noHorizontalScroll(page));
  await H.waitMyRoll(page);
  let s = await H.state(page);
  const f0 = s.front.player[0];
  const b0 = s.teams.player.findIndex((u, i) => u.hp > 0 && s.front.player.indexOf(i) < 0);
  const front = i => `#ally-front .bt-card[data-idx="${i}"]`, back = i => `#ally-back .bt-card[data-idx="${i}"]`;
  // 数字を出す前は交代できない（理由を表示・状態は変わらない）
  await mouseDrag(page, front(f0), back(b0));
  assert.ok((await page.textContent('#toast')).includes('交代できません'));
  assert.equal(await page.$('.drag-ghost'), null);
  assert.deepEqual((await H.state(page)).front.player, s.front.player);
  await page.click('#btn-roll');
  await H.waitMyAction(page);
  await page.waitForTimeout(450);
  s = await H.state(page);
  assert.equal(await page.$$eval('#ally-front .mo-btn', b => b.length), s.front.player.filter(i => s.teams.player[i].hp > 0).length, '前衛の技を同時に表示');
  // 対象外・同じ列で離す → 元のまま（交代回数も使わない）
  await mouseDrag(page, front(f0), { x: 20, y: 20 });
  await mouseDrag(page, front(f0), front(s.front.player[1]), async () => assert.equal(await page.$('.bt-card.drop-target'), null));
  s = await H.state(page);
  assert.equal(s.swapUsed, false, '対象外・同じ列では交代回数を使わない');
  // 後衛を前衛カード（技の欄の上）に重ねて離す → 交代。技は出ない（HP・CDはキャラのまま）
  await page.evaluate(i => { const st = window.RikuyouApp.getState(); st.teams.player[i].cd = 2; }, b0);
  await mouseDrag(page, back(b0), `#ally-front [data-move="${f0}"]`, async () => {
    assert.ok(await page.$('.drag-ghost'), 'カードがポインターに追従');
    assert.ok(await page.$(`${front(f0)}.drop-target`), '交換先を強調');
  });
  await page.waitForTimeout(100);
  assert.notEqual(await page.getAttribute('#modal', 'data-kind'), 'move', 'ドラッグ終了で技の確認が開かない');
  assert.equal((await H.state(page)).moveUsed, false);
  await page.$eval(`#screen-battle .bt-card[data-idx="${b0}"] .bt-art`, c => c.click());
  assert.equal(await page.isHidden('#modal'), true, 'ドラッグ直後のクリックで詳細が開かない');
  await H.waitMyAction(page);
  s = await H.state(page);
  assert.ok(s.front.player.indexOf(b0) >= 0 && s.front.player.indexOf(f0) < 0, '交代した');
  assert.equal(s.swapUsed, true);
  assert.equal(s.teams.player[b0].cd, 2);
  assert.equal(s.leader.player, 0, 'リーダーは変わらない');
  // マウスでも長押し（動かさずに離す）で技の一覧
  await page.waitForTimeout(450);
  const ec = await btBox(page, '#enemy-front .bt-card[data-idx] .bt-art');
  await page.mouse.move(ec.x, ec.y); await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up();
  await page.waitForSelector('#modal[data-kind="moves"]:not(.hidden)');
  await page.click('#modal [data-close="1"].btn');
  // 2回目は交代できない
  await page.waitForTimeout(450);
  await mouseDrag(page, front(b0), back(f0));
  assert.ok((await page.textContent('#toast')).includes('交代できません'));
  assert.deepEqual((await H.state(page)).front.player, s.front.player);
  // 技はボタン→確認で1回だけ
  await page.waitForTimeout(450);
  await page.click(`#ally-front [data-move="${b0}"]`);
  await page.waitForSelector('#btn-confirm-move');
  await page.click('#btn-confirm-move');
  await page.waitForFunction(() => { const st = window.RikuyouApp.getState(); return st.turnSide === 'cpu' || st.phase !== 'action'; });
  // 相手のターン中はドラッグしても交代できない
  if ((await H.state(page)).turnSide === 'cpu' && (await H.state(page)).phase !== 'over') {
    const sc = await H.state(page);
    const fi = sc.front.player.find(i => sc.teams.player[i].hp > 0);
    const bi = sc.teams.player.findIndex((u, i) => u.hp > 0 && sc.front.player.indexOf(i) < 0);
    if (fi !== undefined && bi >= 0) {
      await page.waitForTimeout(450);
      await mouseDrag(page, front(fi), back(bi));
      assert.equal(await page.$('.drag-ghost'), null);
    }
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: 戦闘画面（長押ししてスワイプで交代・すぐ動かすとスクロール扱い）', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=12');
  await H.startLocal(page, '軍師', { claim: false });
  await page.click('[data-go="match"]');
  await page.click('[data-match="free"]');
  await H.formation(page, [0, 1, 2], 0);
  await H.waitMyRoll(page);
  await page.click('#btn-roll');
  await H.waitMyAction(page);
  assert.ok(await H.noHorizontalScroll(page));
  assert.equal(await page.$('.bt-actions, #btn-swap, #btn-skill-menu, #btn-log'), null, '画面下の常設ボタン列はない');
  let s = await H.state(page);
  const f0 = s.front.player[0];
  const b0 = s.teams.player.findIndex((u, i) => u.hp > 0 && s.front.player.indexOf(i) < 0);
  const touch = (from, to, hold) => page.evaluate(async ({ from, to, hold }) => {
    const el = sel => document.querySelector(sel);
    const mid = e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const a = mid(el(from)), b = mid(el(to));
    const send = (type, p, t) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y }));
    send('pointerdown', a, el(from));
    await new Promise(r => setTimeout(r, hold));
    send('pointermove', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, document);
    send('pointermove', b, document);
    send('pointerup', b, document);
  }, { from, to, hold });
  await page.evaluate(() => window.scrollTo(0, 0));
  const back = `#ally-back .bt-card[data-idx="${b0}"]`, front = `#ally-front .bt-card[data-idx="${f0}"]`;
  await touch(back, front, 0);
  assert.equal((await H.state(page)).swapUsed, false, 'すぐ動かしたときは交代しない（スクロール扱い）');
  // 長押しして動かさずに離す → 技の一覧（味方・敵どちらも）。交代はしない
  const hold = sel => page.evaluate(async sel => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect(); const p = { x: r.left + r.width / 2, y: r.top + r.height / 3 };
    const send = (type, t) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: p.x, clientY: p.y }));
    send('pointerdown', el); await new Promise(r => setTimeout(r, 450)); send('pointerup', document); el.click();
  }, sel);
  await hold(front);
  await page.waitForSelector('#modal[data-kind="moves"]:not(.hidden)');
  assert.equal(await page.$$eval('#modal .moves li', l => l.length), 6, '出目1〜6の技');
  assert.ok(await page.$('#modal .moves li.hit'), '今の出目の技を強調');
  await page.click('#modal [data-close="1"].btn');
  assert.equal((await H.state(page)).swapUsed, false);
  await page.waitForTimeout(450);
  await hold('#enemy-front .bt-card[data-idx]');
  await page.waitForSelector('#modal[data-kind="moves"]:not(.hidden)');
  await page.click('#modal [data-close="1"].btn');
  await page.waitForTimeout(450);
  // 長押ししてからスワイプ → 交代（後衛→前衛）
  await touch(back, front, 420);
  await H.waitMyAction(page);
  s = await H.state(page);
  assert.ok(s.front.player.indexOf(b0) >= 0 && s.swapUsed, '長押ししてスワイプで交代');
  // 履歴は上部メニューから
  await page.waitForTimeout(450);
  await page.click('#btn-battle-menu');
  await page.click('#btn-menu-log');
  await page.waitForSelector('#modal[data-kind="log"]:not(.hidden)');
  assert.ok((await page.textContent('#modal')).includes('味方の交代'));
  await page.click('#modal [data-close="1"].btn');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: 戦闘画面（サイコロで数字・カードの絵で詳細・確認してから固有スキル・敵は確認のみ・★と属性枠）', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=12');
  await H.startLocal(page, '軍師', { claim: false });
  await page.click('[data-go="match"]');
  await page.click('[data-match="free"]');
  await H.formation(page, [0, 1, 2], 0);
  await H.waitMyRoll(page);
  // カードに★と属性枠（属性ごとの色×ランクの濃さ）
  const cards = await page.$$eval('#screen-battle .bt-card[data-idx]', cs => cs.map(c => ({ el: c.dataset.el, st: c.dataset.stars, stars: (c.querySelector('.stars') || {}).textContent || '', border: getComputedStyle(c).borderTopColor })));
  assert.ok(cards.length >= 6 && cards.every(c => c.el && /^[123]$/.test(c.st) && c.stars === '★'.repeat(Number(c.st))));
  const s0 = await H.state(page);
  const ids = s0.teams.player.map(u => u.charId);
  const exp = Object.fromEntries(E.CHARACTERS.map(c => [c.id, E.starsOf(c.id)]));
  for (const [i, id] of ids.entries()) assert.equal(await page.getAttribute(`#ally-front .bt-card[data-idx="${i}"], #ally-back .bt-card[data-idx="${i}"]`, 'data-stars'), String(exp[id]));
  // 数字を出す前：技の欄はない。サイコロに案内
  assert.equal(await page.$$eval('#ally-front [data-move]', b => b.length), 0);
  assert.ok((await page.textContent('#roll-cap')).includes('タップして数字を出す'));
  await page.click('#btn-roll');
  await H.waitMyAction(page);
  await page.waitForTimeout(470);
  let s = await H.state(page);
  // 前衛の絵を押す → 詳細（スキルの確認）。閉じても何も消費しない
  const f0 = s.front.player[0];
  await page.click(`#ally-front .bt-card[data-idx="${f0}"] .bt-art`);
  await page.waitForSelector('#modal[data-kind="detail"]:not(.hidden)');
  const t = await page.textContent('#modal');
  const ch = s.teams.player[f0];
  assert.ok(t.includes('固有スキル') && t.includes('クールダウン') && t.includes('対象') && t.includes(`${ch.hp}`), '名前・HP・スキル・対象・CD');
  assert.ok(await page.$('#modal .stars') && await page.$('#modal .el-mark'), '星と属性');
  assert.ok(await page.$('#btn-use-skill'), '使えるときは「このスキルを使う」');
  await page.click('#modal [data-close="1"].btn');
  s = await H.state(page);
  assert.equal(s.skillUsed, false, '詳細を開いて閉じても使っていない');
  // 技欄を押すと技の確認（詳細は開かない）→ キャンセル
  await page.waitForTimeout(470);
  await page.click(`#ally-front [data-move="${f0}"]`);
  await page.waitForSelector('#modal[data-kind="move"]:not(.hidden)');
  await page.click('#modal [data-close="1"].btn');
  // 後衛のキャラの固有スキルを確認してから使う
  const b0 = s.teams.player.findIndex((u, i) => u.hp > 0 && s.front.player.indexOf(i) < 0);
  await page.waitForTimeout(470);
  await page.click(`#ally-back .bt-card[data-idx="${b0}"] .bt-art`);
  await page.waitForSelector('#btn-use-skill');
  await page.click('#btn-use-skill');
  await page.waitForFunction(() => window.RikuyouApp.getState().skillUsed);
  s = await H.state(page);
  assert.ok(s.log.some(l => l.kind === 'skill' && l.text.includes(s.teams.player[b0].charId === 'gyakufu' ? '風向き' : '')), '後衛から使えた');
  // 使った後は理由と残りCDを表示
  await H.waitMyAction(page);
  await page.waitForTimeout(470);
  await page.click(`#ally-back .bt-card[data-idx="${b0}"] .bt-art`);
  await page.waitForSelector('#modal[data-kind="detail"]:not(.hidden)');
  assert.equal(await page.$('#btn-use-skill'), null);
  assert.ok((await page.textContent('#modal .reason')).includes('今は使えません'));
  await page.click('#modal [data-close="1"].btn');
  // 敵のカード：情報だけ（使うボタンも交代もない）
  await page.waitForTimeout(470);
  await page.click('#enemy-front .bt-card .bt-art');
  await page.waitForSelector('#modal[data-kind="detail"]:not(.hidden)');
  assert.equal(await page.$('#btn-use-skill'), null);
  assert.equal(await page.$('#modal [data-swap-with]'), null);
  assert.ok((await page.textContent('#modal')).includes('相手のキャラです'));
  await page.click('#modal [data-close="1"].btn');
  assert.equal((await H.state(page)).leader.player, 0, '戦闘中のタップでリーダーは変わらない');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: ログイン画面（初回はようこそ・保存済みは「○○で続ける」・ほかのプレイヤーも選べる）', async () => {
  const { ctx, page, errors } = await open('mobile');
  await page.waitForSelector('#screen-login:not(.hidden)');
  assert.equal(await page.textContent('#login-greet'), 'ようこそ');
  assert.equal(await page.$('.lg-continue'), null);
  assert.ok((await page.textContent('#login-mode')).includes('この端末に保存'));
  assert.ok(await H.noHorizontalScroll(page));
  await H.startLocal(page, 'はるの');
  const logout = async () => { await page.click('#btn-settings'); await page.click('#modal [data-go="logout"]'); await page.waitForSelector('#screen-login:not(.hidden)'); };
  await logout();
  assert.equal(await page.textContent('#login-greet'), 'おかえりなさい');
  assert.ok((await page.textContent('.lg-continue')).includes('はるの で続ける'));
  await page.fill('#in-name', 'なつ');
  await page.click('#btn-local-start');
  await page.waitForSelector('#screen-home:not(.hidden)');
  await H.closeBonus(page, false);
  await logout();
  assert.ok((await page.textContent('.lg-continue')).includes('なつ'));
  assert.ok((await page.textContent('.lg-others')).includes('はるの'));
  await page.click('.lg-chip');
  await page.waitForSelector('#screen-home:not(.hidden)');
  await H.closeBonus(page, false);
  assert.ok((await page.textContent('#home-profile')).includes('はるの'), '選んだプレイヤーで続ける');
  // 遊び方を開ける
  await logout();
  await page.click('#btn-login-help');
  await page.waitForSelector('#modal[data-kind="help"]:not(.hidden)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

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
    await page.click('[data-go="match"]');
    await page.click('[data-match="free"]');
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
    assert.equal(await page.$$eval('#ally-front [data-move]', c => c.length), s.front.player.filter(i => s.teams.player[i].hp > 0).length);

    // キャラの詳細から交代（ドラッグの代わり）：閉じるだけなら何も変わらない → 相手を選ぶと交代（HP・CDは保持、数字は変わらない）
    const out = s.front.player[0];
    const inn = s.teams.player.findIndex((u, i) => u.hp > 0 && s.front.player.indexOf(i) < 0);
    await page.waitForTimeout(TAP_GUARD);
    await page.click(`#ally-front .bt-card[data-idx="${out}"] .bt-art`);
    await page.waitForSelector('#modal[data-kind="detail"]:not(.hidden)');
    await page.click('#modal [data-close="1"].btn');
    assert.deepEqual((await H.state(page)).front.player, s.front.player);
    await page.evaluate(i => { const st = window.RikuyouApp.getState(); st.teams.player[i].hp = 41; st.teams.player[i].cd = 2; }, out);
    await page.waitForTimeout(TAP_GUARD);
    await page.click(`#ally-front .bt-card[data-idx="${out}"] .bt-art`);
    await page.click(`#modal [data-swap-with="${inn}"]`);
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
    await page.click(`#ally-front [data-move="${inn}"]`);
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

test('mobile: 対戦（ランク戦）を決着まで遊び、報酬と次の相手の解放が保存される', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=7');
  await H.startLocal(page, '挑戦者', { claim: false });
  const before = await H.profile(page);
  await page.click('[data-go="match"]');
  await page.waitForSelector('#screen-match:not(.hidden)');
  assert.equal(await page.$('[data-match="m2"]'), null, '2番目の相手は未解放');
  await page.click('[data-match="m1"]');
  await H.formation(page, [0, 1, 2], 0);
  assert.ok(await H.autoplay(page), '決着しなかった');
  const s = await H.state(page);
  const won = s.winner === 'player';
  const p = await H.profile(page);
  const exp = won ? 60 : 18;
  const id = before.team[0];
  assert.equal((p.chars[id].level - 1) * 100 + p.chars[id].exp, exp, '経験値');
  assert.equal(p.stones, before.stones + (won ? 100 : 0));
  assert.equal(!!p.matches.won.m1, won);
  assert.ok((await page.textContent('#modal')).includes(`経験値 +${exp}`));
  // もう一度：新しい戦闘は初期状態（前の戦闘の非同期処理が残らない）
  await page.click('#modal [data-act]:has-text("もう一度挑戦")');
  await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)');
  await page.waitForTimeout(300);
  const n = await H.state(page);
  assert.equal(n.phase, 'formation');
  assert.equal(n.round, 0);
  assert.equal(n.log.length, 0);
  n.teams.player.concat(n.teams.cpu).forEach(u => { assert.equal(u.hp, u.maxHp); assert.equal(u.cd, 0); });
  assert.deepEqual(n.teams.cpu.map(u => u.charId), ['suiju', 'gyakufu', 'kohaku', 'raimei', 'gessen', 'mukai']);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: ダンジョン：1階の雑魚（1体）を倒すと、HPを引き継いで2階の中ボスへ', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=3');
  await H.startLocal(page, '探索者', { claim: false });
  await page.click('[data-go="dungeon"]');
  await page.waitForSelector('#screen-dungeon:not(.hidden)');
  assert.equal(await page.$('[data-dungeon="sea"]'), null, '2つ目のダンジョンは未解放');
  assert.equal(await page.$$eval('.dungeon:first-child .boss-step', b => b.length), 3);
  let won1 = false;
  for (let tries = 0; tries < 4 && !won1; tries++) {
    if (tries === 0) await page.click('[data-dungeon="forest"]');
    else await page.click('#modal [data-act]:has-text("1階から挑み直す")');
    await H.formation(page, [0, 1, 2], 0);
    let s = await H.state(page);
    assert.equal(s.teams.cpu.length, 1, '敵は1体');
    assert.equal(s.teams.cpu[0].charId, 'b-goblin');
    assert.equal(await page.$$eval('#enemy-front .empty-slot', e => e.length), 0, 'ボス側に空き枠を出さない');
    assert.ok(await H.autoplay(page), '決着しなかった');
    s = await H.state(page);
    won1 = s.winner === 'player';
  }
  assert.ok(won1, '1階を突破できなかった');
  const s1 = await H.state(page);
  const expected = {};
  s1.teams.player.forEach(u => { expected[u.charId] = u.hp > 0 ? Math.min(u.maxHp, u.hp + Math.floor(u.maxHp * 0.2)) : 0; });
  const p1 = await H.profile(page);
  assert.ok((await page.textContent('#modal')).includes('次の階へ引き継ぐHP'));
  await page.click('#modal [data-act]:has-text("2階へ進む")');
  await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)');
  const s2 = await H.state(page);
  assert.equal(s2.teams.cpu[0].charId, 'b-boar', '2階は中ボス');
  s2.teams.player.forEach(u => assert.equal(u.hp, expected[u.charId], u.charId + 'のHPを引き継ぐ'));
  // 戦闘不能のキャラは配置で選べない
  const koIdx = s2.teams.player.findIndex(u => u.hp <= 0);
  if (koIdx >= 0) {
    assert.equal(await page.getAttribute(`#modal .fm-card[data-idx="${koIdx}"]`, 'data-pos'), 'back', '戦闘不能は後衛に置かれる');
    assert.ok((await page.getAttribute(`#modal .fm-card[data-idx="${koIdx}"]`, 'class')).includes('ko'));
  }
  assert.equal(p1.dungeon.cleared.forest, undefined, '大ボスを倒すまで踏破にならない');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: 管理用コードで入ると全キャラを所持（この端末保存モード）', async () => {
  const ctx = await browser.newContext(H.VIEWPORTS.mobile);
  const page = await ctx.newPage();
  const w = H.watchPage(page);
  await page.goto(httpBase + 'docs/?fast=1');
  await page.waitForSelector('#screen-login:not(.hidden)');
  await page.click('.admin-login summary');
  await page.fill('#in-admin-name', '管理人');
  await page.fill('#in-admin-code', 'WRONG-CODE');
  await page.click('#btn-admin-start');
  await page.waitForFunction(() => document.querySelector('#login-error').textContent.includes('管理用コードが違います'));
  await page.fill('#in-admin-code', TEST_ADMIN_CODE);
  await page.click('#btn-admin-start');
  await page.waitForSelector('#screen-home:not(.hidden)');
  await H.closeBonus(page, false);
  const p = await H.profile(page);
  assert.equal(p.isAdmin, true);
  assert.equal(Object.keys(p.chars).length, CHAR_COUNT);
  assert.ok((await page.textContent('#home-profile')).includes('管理用アカウント'));
  // 管理用：すべての対戦・ダンジョンが選べる
  await page.click('[data-go="match"]');
  assert.ok(await page.$('[data-match="m10"]'), '最後の対戦も選べる');
  await page.click('#btn-home');
  await page.click('[data-go="dungeon"]');
  assert.ok(await page.$('[data-dungeon="tower"]'), '最後のダンジョンも選べる');
  await page.click('#btn-home');
  // 管理用：編成画面でレベルを直接変える（キャラごと・全員）
  await page.click('[data-go="team"]');
  await page.waitForSelector('#screen-team:not(.hidden)');
  const before = await page.evaluate(() => window.RikuyouApp.getProfile().team.slice());
  await page.click('[data-lv="ryogen"][data-lv-step="10"]');
  assert.equal((await H.profile(page)).chars.ryogen.level, 11);
  await page.fill('[data-lv-input="ryogen"]', '25');
  await page.press('[data-lv-input="ryogen"]', 'Enter');
  await page.dispatchEvent('[data-lv-input="ryogen"]', 'change');
  assert.equal((await H.profile(page)).chars.ryogen.level, 25);
  assert.deepEqual(await page.evaluate(() => window.RikuyouApp.getProfile().team.slice()), before, 'レベル操作で選択は変わらない');
  await page.fill('#in-level-all', '30');
  await page.click('#btn-level-all');
  assert.ok(Object.values((await H.profile(page)).chars).every(c => c.level === 30));
  await page.click('#btn-team-back');
  await page.waitForSelector('#screen-home:not(.hidden)');
  // 普通に名前で入った人は管理用にならない
  await page.click('#btn-settings');
  await page.click('#modal [data-go="logout"]');
  await page.fill('#in-name', '一般');
  await page.click('#btn-local-start');
  await page.waitForSelector('#screen-home:not(.hidden)');
  await H.closeBonus(page, false);
  assert.equal((await H.profile(page)).isAdmin, false);
  assert.equal(Object.keys((await H.profile(page)).chars).length, 6);
  await page.click('[data-go="team"]');
  assert.equal(await page.$('[data-lv-box]'), null, '一般アカウントにはレベル変更がない');
  assert.equal(await page.isHidden('#admin-level-all'), true);
  assert.deepEqual(w.errors, []);
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
  await page.click('[data-go="match"]');
  await page.click('[data-match="free"]');
  await H.formation(page, [0, 1, 2], 0);
  await H.waitMyRoll(page, 20000);
  await page.click('#btn-roll');
  assert.equal(await page.isDisabled('#btn-roll'), true);
  await H.waitMyAction(page, 20000);
  const s = await H.state(page);
  await page.waitForTimeout(TAP_GUARD);
  await page.click(`#ally-front [data-move="${s.front.player[0]}"]`);
  await page.click('#btn-confirm-move');
  await page.waitForFunction(() => window.RikuyouApp.getState().turnSide === 'cpu' || window.RikuyouApp.getState().phase !== 'action');
  if ((await H.state(page)).phase !== 'over') {
    assert.equal(await page.isDisabled('#btn-roll'), true);
    assert.equal(await page.$$eval('#ally-front [data-move]', c => c.length), 0);
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});
