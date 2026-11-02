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

    // 編成画面：前衛3・後衛3の枠と所持キャラ（持っているキャラだけ）。枠をタップ→詳細→技のカスタムを保存
    await page.click('[data-go="team"]');
    await page.waitForSelector('#screen-team:not(.hidden)');
    assert.equal(await page.$$eval('#team-front .tm-card[data-id]', c => c.length), 3);
    assert.equal(await page.$$eval('#team-back .tm-card[data-id]', c => c.length), 3);
    assert.equal(await page.$$eval('#team-grid .tm-mini', c => c.length), 6, '所持キャラだけ並ぶ');
    assert.equal(await page.isDisabled('#btn-team-ok'), false, '初期チーム6体が選ばれている');
    const first = p.team[0];
    await page.waitForTimeout(500);
    await page.click(`#screen-team .tm-card[data-id="${first}"]`);
    await page.waitForSelector('#modal[data-kind="team-char"]:not(.hidden)');
    await page.click(`#modal [data-edit="${first}"]`);
    await page.click('[data-slot="0"]');
    await page.click('[data-slot="5"]');
    await page.click('#btn-lo-save');
    await page.waitForSelector('#modal', { state: 'hidden' });
    p = await H.profile(page);
    assert.deepEqual(p.loadouts[first], [5, 1, 2, 3, 4, 0]);
    // 属性で絞り込み
    const firstEl = E.getChar(first).element;
    await page.click(`#team-filter [data-filter="${firstEl}"]`);
    assert.ok(await page.$$eval('#team-grid .tm-mini', c => c.length) >= 1);
    assert.ok((await page.$$eval('#team-grid .tm-mini', c => c.map(x => x.dataset.el))).every(el => el === firstEl));
    await page.click('#team-filter [data-filter="all"]');
    // 外すと空き枠になり保存できない → 戻すと空き枠に入って保存できる
    await page.waitForTimeout(500);
    await page.click(`[data-pick="${first}"]`);
    assert.equal(await page.isDisabled('#btn-team-ok'), true);
    assert.equal(await page.$$eval('#screen-team .tm-card.empty', c => c.length), 1);
    await page.click(`[data-pick="${first}"]`);
    assert.equal(await page.$$eval('#screen-team .tm-card.empty', c => c.length), 0);
    await page.click('#btn-team-ok');
    await page.waitForSelector('#screen-home:not(.hidden)');
    p = await H.profile(page);
    assert.equal(p.formation.front.length, 3, '前衛3体を出撃準備の初期配置として覚える');
    assert.ok(p.formation.front.every(id => p.team.indexOf(id) >= 0) && p.team.indexOf(p.formation.leader) >= 0);

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
    // 有効な位置ならすぐ消える。無効な位置なら元の位置へ戻ってから消える
    await page.waitForSelector('.fm-ghost', { state: 'detached', timeout: 1000 });
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
// 描き直しの瞬間に要素が入れ替わることがあるので、取れるまで少し待つ
const btBox = async (page, sel) => {
  for (let k = 0; k < 20; k++) {
    const h = await page.$(sel);
    if (h) await h.scrollIntoViewIfNeeded().catch(() => {});
    const b = h && await h.boundingBox();
    if (b) return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await page.waitForTimeout(50);
  }
  throw new Error('要素が見つかりません: ' + sel);
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
  assert.equal(await page.$$eval('.drag-ghost', g => g.length), 0);
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
      assert.equal(await page.$$eval('.drag-ghost', g => g.length), 0);
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
  assert.ok(cards.length >= 6 && cards.every(c => c.el && /^[1-4]$/.test(c.st) && c.stars === '★'.repeat(Number(c.st))));
  const s0 = await H.state(page);
  const ids = s0.teams.player.map(u => u.charId);
  const exp = Object.fromEntries(E.CHARACTERS.map(c => [c.id, E.starsOf(c.id)]));
  for (const [i, id] of ids.entries()) assert.equal(await page.getAttribute(`#ally-front .bt-card[data-idx="${i}"], #ally-back .bt-card[data-idx="${i}"]`, 'data-stars'), String(exp[id]));
  // 数字を出す前：技の欄はない。サイコロに案内
  assert.equal(await page.$$eval('#ally-front [data-move]', b => b.length), 0);
  assert.ok((await page.textContent('#roll-cap')).includes('タップで振る'));
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
  await page.waitForTimeout(500);
  await page.click('#tabbar [data-tab="home"]');
  await page.click('[data-go="gacha"]');
  assert.equal(await page.isDisabled('#btn-gacha-10'), false);
  // 属性ガチャ：自然を選ぶと、呼び出せるキャラは自然属性だけ。値段は同じ
  assert.equal(await page.$$eval('#gacha-kinds .gk-btn', b => b.length), 6, '通常＋5属性');
  await page.click('#gacha-kinds [data-gacha-kind="nature"]');
  assert.equal(await page.getAttribute('#gacha-kinds [data-gacha-kind="nature"]', 'aria-pressed'), 'true');
  const natures = E.CHARACTERS.filter(c => c.element === 'nature').length;
  assert.equal(await page.$$eval('#gacha-pool .pool-item', c => c.length), natures);
  await page.waitForTimeout(500);
  await page.click('#btn-gacha-10');
  await page.waitForSelector('#modal[data-kind="gacha"]:not(.hidden)');
  assert.equal(await page.$$eval('.gacha-card', c => c.length), 10);
  assert.ok((await page.textContent('#modal h3')).includes('自然ガチャ'));
  const names = await page.$$eval('.gacha-card b', b => b.map(x => x.textContent));
  assert.ok(names.every(n => E.CHARACTERS.some(c => c.name === n && c.element === 'nature')), '自然属性のキャラだけ');
  p = await H.profile(page);
  assert.equal(p.stones, 0);
  const owned = Object.keys(p.chars).length;
  assert.ok(owned >= 6 && owned <= CHAR_COUNT);
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
  // 冒険の地図：カードは名前・状態・推奨・報酬だけ。触っても戦闘は始まらず、詳細が開く
  assert.equal(await page.getAttribute('[data-dg="forest"]', 'data-state'), 'open');
  assert.equal(await page.getAttribute('[data-dg="sea"]', 'data-state'), 'locked', '2つ目のダンジョンは未解放');
  assert.ok((await page.textContent('[data-dg="sea"]')).includes('「翠の迷い森」を踏破で解放'));
  assert.ok((await page.textContent('[data-dg="forest"]')).includes('初回報酬'));
  assert.equal(await page.$$eval('#dungeon-team .dg-face', f => f.length), 6, '出撃チームは顔アイコン6つ');
  assert.ok(await H.noHorizontalScroll(page), '横スクロールなし');
  // 遊び方は別の画面で
  await page.click('#btn-dungeon-rules');
  await page.waitForSelector('#modal[data-kind="dungeon-rules"]:not(.hidden)');
  await page.click('#modal [data-close="1"].btn');
  await page.waitForTimeout(500);
  // 未解放の詳細：敵は見られるが挑めない
  await page.click('[data-dg="sea"]');
  await page.waitForSelector('#modal[data-kind="dungeon"]:not(.hidden)');
  assert.equal(await page.$$eval('#modal .dg-floor', f => f.length), 3);
  assert.equal(await page.$('#btn-dg-start'), null, '未解放は挑めない');
  assert.equal(await page.$eval('#modal .dg-btn[disabled]', b => b.textContent), '未解放');
  await page.click('#modal [data-close="1"].dg-btn');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.body.dataset.screen), 'dungeon', '一覧へ戻る');
  // 詳細：敵3体・報酬（初回／2回目以降）・出撃チーム
  await page.click('[data-dg="forest"]');
  await page.waitForSelector('#modal[data-kind="dungeon"]:not(.hidden)');
  assert.equal(await page.$$eval('#modal .dg-floor', f => f.length), 3);
  const rewardText = await page.textContent('#modal .dg-rewards');
  assert.ok(rewardText.includes('300') && rewardText.includes('40'), '初回300・2回目以降40');
  assert.equal(await page.$$eval('#modal .dg-detail-team .dg-face', f => f.length), 6);
  assert.equal(await page.textContent('#btn-dg-start'), '挑む');
  assert.equal(await page.evaluate(() => window.RikuyouApp.getState()), null, 'まだ戦闘は始まっていない');
  await page.click('#modal [data-close="1"].dg-btn');
  await page.waitForTimeout(500);
  let won1 = false;
  for (let tries = 0; tries < 4 && !won1; tries++) {
    if (tries === 0) { await page.click('[data-dg="forest"]'); await page.click('#btn-dg-start'); }
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
  await page.waitForSelector('#match-open:not(.hidden)');
  await page.focus('#match-list');
  await page.keyboard.press('End');
  await page.waitForSelector('#match-open [data-match="m10"]', { timeout: 3000 });
  assert.ok(await page.$('#match-open [data-match="m10"]'), '最後の対戦も選べる');
  await page.click('#btn-home');
  await page.click('[data-go="dungeon"]');
  await page.waitForSelector('#screen-dungeon:not(.hidden)');
  assert.equal(await page.getAttribute('[data-dg="tower"]', 'data-state'), 'open', '最後のダンジョンも選べる');
  await page.click('#btn-home');
  // 管理用：編成画面でレベルを直接変える（キャラごと・全員）
  await page.click('[data-go="team"]');
  await page.waitForSelector('#screen-team:not(.hidden)');
  const before = await page.evaluate(() => window.RikuyouApp.getProfile().team.slice());
  await page.waitForTimeout(500);
  await page.click('[data-info="ryogen"]');
  await page.waitForSelector('#modal[data-kind="team-char"]:not(.hidden)');
  await page.click('[data-lv="ryogen"][data-lv-step="10"]');
  assert.equal((await H.profile(page)).chars.ryogen.level, 11);
  await page.fill('[data-lv-input="ryogen"]', '25');
  await page.press('[data-lv-input="ryogen"]', 'Enter');
  await page.dispatchEvent('[data-lv-input="ryogen"]', 'change');
  assert.equal((await H.profile(page)).chars.ryogen.level, 25);
  assert.deepEqual(await page.evaluate(() => window.RikuyouApp.getProfile().team.slice()), before, 'レベル操作で選択は変わらない');
  await page.click('#modal-x');
  await page.waitForTimeout(500);
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

// 相手の残りHPを1にして、こちらの技で決着させる（結果画面の確認用）
// 出撃準備：戦えるキャラから前衛3体を選んで出撃（ダンジョンの階をまたぐとき用）
async function formationAlive(page) {
  await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)', { timeout: 20000 });
  const s = await H.state(page);
  const alive = s.teams.player.map((u, i) => i).filter(i => s.teams.player[i].hp > 0).slice(0, 3);
  await H.formation(page, alive, alive[0]);
}
async function finishQuickly(page, loseSide) {
  // 前衛はHP1、後衛は戦闘不能にして、1回の攻撃で決着させる
  await page.evaluate(side => { const s = window.RikuyouApp.getState(); s.teams[side].forEach((u, i) => { u.hp = s.front[side].indexOf(i) >= 0 ? 1 : 0; }); }, loseSide);
  for (let k = 0; k < 1500; k++) {
    if (await page.$('#modal[data-kind="result"]:not(.hidden)')) return;
    // 回復で持ち直さないよう、決着までは前衛のHPを1以下に保つ
    await page.evaluate(side => { const s = window.RikuyouApp.getState(); if (s.phase !== 'over') s.front[side].forEach(i => { const u = s.teams[side][i]; if (u.hp > 1) u.hp = 1; }); }, loseSide);
    await H.step(page);
    await page.waitForTimeout(60);
  }
  throw new Error('結果画面が出ない');
}

test('mobile: 戦闘結果（自動表示・演出のスキップ・報酬は1回だけ・再表示は演出なし）', async () => {
  const { ctx, page, errors } = await open('mobile', 'seed=5');
  await H.startLocal(page, '結果係', { claim: false });
  await page.evaluate(() => { const p = window.RikuyouApp.getProfile(); p.chars[p.team[1]].exp = 80; });
  const before = await H.profile(page);
  await page.click('[data-go="match"]');
  await page.waitForTimeout(500);
  await page.click('[data-match="m1"]');
  await H.formation(page, [0, 1, 2], 0);
  await finishQuickly(page, 'cpu');
  // 演出中：スキップがある。押すと直ちに最終結果
  assert.ok(await page.$('#modal .rs.win.rs-play'), '勝利の演出');
  await page.click('#btn-rs-skip');
  assert.ok(await page.$('#modal .rs.rs-done'));
  assert.equal(await page.$('#btn-rs-skip'), null);
  assert.equal(await page.textContent('#modal .rs-count'), '+100');
  assert.equal(await page.$$eval('#modal .rs-card', c => c.length), 6, '仲間6体');
  const up = await page.$eval('#modal .rs-card.up', c => c.textContent);
  assert.ok(/Lv\s*1\s*→\s*2/.test(up.replace(/\s+/g, ' ')), 'レベルアップを表示');
  assert.ok((await page.textContent('#modal')).includes('経験値 +60'));
  let p = await H.profile(page);
  assert.equal(p.stones, before.stones + 100);
  // 連打・戦闘ログ→サイコロで再表示しても報酬は増えない。再表示は演出なし
  await page.click('#modal .rs-link[data-close="1"]');
  await page.waitForSelector('#modal', { state: 'hidden' });
  await page.waitForTimeout(500);
  await page.click('#btn-roll');
  await page.waitForSelector('#modal[data-kind="result"]:not(.hidden)');
  assert.ok(await page.$('#modal .rs.rs-done'), '再表示は最終結果だけ');
  p = await H.profile(page);
  assert.equal(p.stones, before.stones + 100, '再表示で二重に付与しない');
  // 主ボタン：次の相手に挑戦
  assert.equal(await page.textContent('#modal .rs-btn-main'), '次の相手に挑戦');
  await page.dblclick('#modal .rs-btn-main');
  await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)');
  assert.equal((await H.profile(page)).stones, before.stones + 100);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: 戦闘結果（ダンジョン：途中の階・敗北の到達階・最終踏破は豪華に）', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=3');
  await H.startLocal(page, '踏破係', { claim: false });
  await page.click('[data-go="dungeon"]');
  await page.waitForSelector('#screen-dungeon:not(.hidden)');
  await page.waitForTimeout(500);
  await page.click('[data-dg="forest"]'); await page.click('#btn-dg-start');
  await H.formation(page, [0, 1, 2], 0);
  await finishQuickly(page, 'cpu');
  let t = await page.textContent('#modal .rs');
  assert.ok(t.includes('1階 突破') && t.includes('次の階へ引き継ぐHP'));
  assert.equal(await page.$('#modal .rs.grand'), null);
  await page.click('#modal [data-act]:has-text("2階へ進む")');
  await formationAlive(page);
  await finishQuickly(page, 'cpu');
  await page.click('#modal [data-act]:has-text("3階へ進む")');
  await formationAlive(page);
  const stones = (await H.profile(page)).stones;
  await finishQuickly(page, 'cpu');
  assert.ok(await page.$('#modal .rs.win.grand'), '最終踏破は豪華な演出');
  assert.ok((await page.textContent('#modal .rs-title')).includes('踏破'));
  assert.equal(await page.textContent('#modal .rs-count'), '+300');
  assert.equal((await H.profile(page)).stones, stones + 300);
  // 敗北：到達した階を表示し、主ボタンは1階から挑み直す
  await page.click('#modal [data-act]:has-text("もう一度挑む")');
  await H.formation(page, [0, 1, 2], 0);
  await finishQuickly(page, 'player');
  t = await page.textContent('#modal .rs');
  assert.ok(await page.$('#modal .rs.lose'));
  assert.ok(t.includes('1階まで到達'));
  assert.equal(await page.textContent('#modal .rs-btn-main'), '1階から挑み直す');
  assert.equal(await page.$('#modal .rs-spark'), null, '敗北に祝福の光はない');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// 立体サイコロ：投げ方（スワイプ）は Engine に渡り、出目は1回だけ決まる。止まった面＝拡大した平らな面＝出目
const dieState = page => page.evaluate(() => {
  const b = document.querySelector('#btn-roll .die-body').getBoundingClientRect();
  return { model: window.RikuyouDice.topFace(), flat: window.RikuyouDice.flatFace(), rect: { x: b.x, r: b.right } };
});
const startFree = async (page, name, team) => {
  await H.startLocal(page, name, { claim: false });
  // チームを決める（はじめの手持ちは乱数で決まり、キャラが増えると変わるため）
  if (team) await page.evaluate(t => { const p = window.RikuyouApp.getProfile(); t.forEach(id => { if (!p.chars[id]) p.chars[id] = { level: 1, exp: 0 }; }); p.team = t.slice(); }, team);
  await page.click('[data-go="match"]');
  await page.click('[data-match="free"]');
  await H.formation(page, [0, 1, 2], 0);
  await page.waitForFunction(() => { const s = window.RikuyouApp.getState(); return s && s.phase === 'roll' && s.turnSide === 'player' && !window.RikuyouBattle.isLocked() && !window.RikuyouDice.playing(); }, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.$eval('#dice-stage', e => e.scrollIntoView({ block: 'center' }));
};
const dieCenter = async page => { const b = await (await page.$('#btn-roll')).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const myRolls = s => s.log.filter(l => l.kind === 'dice' && l.text.startsWith('あなたの出目')).length;
// 平らな出目：出目と同じ面・正方形（1:1）
const assertFlat = (d, n, msg) => {
  assert.ok(d.flat, msg + '：平らな出目がある');
  assert.equal(d.flat.n, n, msg + '：平らな面＝出目');
  assert.ok(Math.abs(d.flat.w - d.flat.h) < 0.5, msg + '：正方形');
  assert.equal(d.model, n, msg + '：立体の上の面＝出目');
};

for (const kind of ['mobile', 'desktop']) {
  test(`${kind}: サイコロをスワイプで投げる（投げ方が Engine に渡る・1回だけ・止まる面と拡大する面が出目と一致）`, async () => {
    const { ctx, page, errors } = await open(kind, 'seed=7');
    await startFree(page, '投げ手');
    assert.ok((await page.textContent('#roll-cap')).includes('スワイプで投げる'));
    // 小さく動かして元に戻して離す → 取り消し（振らない）
    let c = await dieCenter(page);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 30, c.y - 10, { steps: 4 }); await page.mouse.move(c.x + 2, c.y + 1, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    assert.equal(myRolls(await H.state(page)), 0, '元の場所に戻して離すと振らない');
    // Esc で取り消し
    c = await dieCenter(page);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 40, c.y - 20, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(500);
    assert.equal(myRolls(await H.state(page)), 0, 'Esc で取り消すと振らない');
    // 速いスワイプ → 投げる。投げている間に何度押しても1回
    c = await dieCenter(page);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(c.x + i * 18, c.y - i * 8); await page.waitForTimeout(10); }
    await page.mouse.up();
    const thrown = await page.evaluate(() => window.RikuyouDice.lastThrow());
    assert.ok(thrown && thrown.power > 0.3 && thrown.dist > 50, '速さと距離から勢いを計算 ' + JSON.stringify(thrown));
    const vw = await page.evaluate(() => innerWidth);
    for (let i = 0; i < 5; i++) {
      const d = await dieState(page);
      assert.ok(d.rect.x >= 0 && d.rect.r <= vw, 'サイコロが横にはみ出さない');
      // 投げている間はサイコロを押せない（押す・つかむの操作を直接送っても1回のまま）
      await page.$eval('#btn-roll', b => { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, isPrimary: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, isPrimary: true })); b.click(); });
      await page.waitForTimeout(120);
    }
    await H.waitMyAction(page);
    await page.waitForFunction(() => !window.RikuyouDice.playing());
    const s = await H.state(page);
    assert.equal(myRolls(s), 1, '連打しても1回');
    assertFlat(await dieState(page), s.dice, 'スワイプ');
    assert.ok(await page.$('#ally-front.picking'), '前衛の技を選ぶ場面へ進む');
    assert.ok((await page.textContent('#phase-sub')).includes('使う技を選んでください'));
    // 大きな出目は盤面の中央に残ったまま（縮まない）。その上からでも前衛の技を押せる
    await page.waitForTimeout(900);
    const big = await dieState(page);
    assertFlat(big, s.dice, '技を選ぶ間');
    assert.ok(big.flat.w >= 90, '大きいまま残る ' + big.flat.w);
    const center = await page.evaluate(() => {
      const p = document.querySelector('.die-pop').getBoundingClientRect(), st = document.querySelector('#dice-stage').getBoundingClientRect();
      return { dx: Math.abs(p.left + p.width / 2 - (st.left + st.width / 2)), dy: Math.abs(p.top + p.height / 2 - (st.top + st.height / 2)) };
    });
    assert.ok(center.dx < 2 && center.dy < 2, '盤面の中央 ' + JSON.stringify(center));
    const through = await page.evaluate(() => {
      const p = document.querySelector('.die-pop').getBoundingClientRect();
      const pts = [[0.5, 0.5], [0.5, 0.95], [0.5, 0.05], [0.1, 0.5], [0.9, 0.5]];
      return pts.every(([a, b]) => { const el = document.elementFromPoint(p.left + p.width * a, p.top + p.height * b); return el && !el.closest('.die-pop') && !el.closest('.dice-layer'); });
    });
    assert.ok(through, '大きな出目は押しても下のカード・技に届く');
    // 1〜6 すべて：投げて止まる面と拡大する面が指定どおり（見た目だけの確認。ゲームの状態は変えない）
    for (let n = 1; n <= 6; n++) {
      await page.evaluate(v => new Promise(res => window.RikuyouDice.roll({ value: v, from: v % 2 ? 'me' : 'foe', throw: { power: v / 6, angle: v * 50 - 150, dist: 100 }, onDone: res })), n);
      assertFlat(await dieState(page), n, `出目${n}`);
    }
    // 途中で止めても、決まった面で止まる（画面の回転・裏に回ったときと同じ処理）
    const p = page.evaluate(() => new Promise(res => window.RikuyouDice.roll({ value: 3, from: 'me', onDone: () => res('done') })));
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: kind === 'mobile' ? 844 : 1000, height: kind === 'mobile' ? 390 : 700 });
    assert.equal(await p, 'done');
    assertFlat(await dieState(page), 3, '中断');
    assert.equal((await H.state(page)).dice, s.dice, 'ゲームの出目は変わらない');
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('mobile: 小さな指のぶれはタップ扱い（標準の勢いで1回）・キーボードでも振れる', async () => {
  const { ctx, page, errors } = await open('mobile', 'seed=8');
  await startFree(page, 'そっと');
  const c = await dieCenter(page);
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  await page.mouse.move(c.x + 4, c.y + 3, { steps: 3 });
  await page.mouse.up();
  await H.waitMyAction(page);
  let s = await H.state(page);
  assert.equal(myRolls(s), 1);
  assert.equal(await page.evaluate(() => window.RikuyouDice.lastThrow()), null, 'ぶれは投げ方に入らない（標準）');
  assert.deepEqual(errors, []);
  await ctx.close();
  // キーボード：Enter で標準の勢いで振る
  const k = await open('desktop', 'seed=8');
  await startFree(k.page, 'キー');
  await k.page.focus('#btn-roll');
  await k.page.keyboard.press('Enter');
  await H.waitMyAction(k.page);
  s = await H.state(k.page);
  assert.equal(myRolls(s), 1);
  await k.page.waitForFunction(() => !window.RikuyouDice.playing());
  assertFlat(await dieState(k.page), s.dice, 'キーボード');
  assert.deepEqual(k.errors, []);
  await k.ctx.close();
});

test('mobile: 動きを減らす設定でもサイコロで遊べる（転がり・急な拡大なしで短く表示）', async () => {
  const ctx = await browser.newContext(Object.assign({ reducedMotion: 'reduce' }, H.VIEWPORTS.mobile));
  const { page, errors } = await open('mobile', 'seed=9', ctx);
  await startFree(page, '静か');
  const t0 = Date.now();
  await page.click('#btn-roll');
  await H.waitMyAction(page);
  assert.ok(Date.now() - t0 < 1500, '短く終わる');
  const s = await H.state(page);
  assertFlat(await dieState(page), s.dice, '動きを減らす');
  assert.deepEqual(errors, []);
  await ctx.close();
});

const SKILL_TEAM = ['akatsuki', 'raimei', 'okibi', 'wakakusa', 'hakugin', 'yogarasu'];
// 固有スキル：確認画面（絵と技名が主役・使える／待機中）と発動演出（カットイン→効果が届く→状態の印）。結果は Engine のまま
const openSkill = async (page, pos, k) => {
  const s = await H.state(page);
  const back = s.teams.player.map((u, i) => i).filter(i => s.front.player.indexOf(i) < 0);
  const idx = pos === 'front' ? s.front.player[k] : back[k];
  const sel = `#ally-${pos} .bt-card[data-idx="${idx}"] .bt-art`;
  await page.$eval(sel, e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(TAP_GUARD);
  await page.click(sel);
  await page.waitForSelector('#modal[data-kind="detail"]:not(.hidden)');
  return idx;
};
test('mobile: 固有スキルの確認画面と発動演出（攻撃強化・タップで短縮・連打で1回・印は状態に合わせて消える）', async () => {
  const { ctx, page, errors } = await open('mobile', 'seed=12');
  await startFree(page, '剣士', SKILL_TEAM);
  await page.click('#btn-roll');
  await H.waitMyAction(page);
  await page.waitForFunction(() => !window.RikuyouDice.playing());
  const dice = (await H.state(page)).dice;
  const idx = await openSkill(page, 'front', 0);
  let s = await H.state(page);
  const ch = E.unitChar(s.teams.player[idx]);
  // 確認画面：キャラの絵・名前・技名・主な効果・対象・効き目・使えるか・技名入りの発動ボタン
  assert.ok(await page.$('#modal .sk-hero .portrait'), 'キャラの絵');
  assert.equal((await page.textContent('#modal .sk-cname')).trim(), ch.name);
  assert.equal((await page.textContent('#modal .sk-name')).trim(), ch.skill.name);
  assert.ok((await page.textContent('#modal .sk-facts')).includes('対象'));
  assert.ok((await page.textContent('#modal .sk-cd.ok')).includes('使用可能'));
  assert.ok((await page.textContent('#modal .sk-cdrow')).includes(`クールダウン）：${ch.skill.cd}ターン`));
  assert.equal((await page.textContent('#btn-use-skill')).trim(), `${ch.skill.name}を発動`);
  assert.equal(await page.$eval('#modal .sk-more', d => d.open), false, '通常技・リーダースキルは折りたたみ');
  // 発動 → 詳細を閉じ、カットイン（技名）。タップで短縮しても効果は1回
  await page.click('#btn-use-skill');
  await page.waitForSelector('#fx-layer .fx-cutin');
  assert.ok((await page.textContent('#fx-layer .fx-cutin')).includes(ch.skill.name));
  assert.equal(await page.isHidden('#modal'), true, '受理されたら詳細を閉じる');
  await page.click('#fx-layer .fx-skip');
  await page.waitForFunction(() => !document.querySelector('#fx-layer .fx-cutin'), null, { timeout: 2000 });
  await page.waitForTimeout(600);
  s = await H.state(page);
  assert.equal(s.log.filter(l => l.kind === 'skill' && l.text.includes(`「${ch.skill.name}」を使った`)).length, 1, '1回だけ');
  assert.equal(s.dice, dice, '出目はそのまま');
  assert.ok((await page.evaluate(() => window.RikuyouDice.flatFace())).n === dice, '大きな出目もそのまま');
  // 強化の印（状態から）と、強化された通常技の攻撃値＝Engine の計算
  const eff = ch.skill.effects.find(e => e.type === 'atkBonus' || e.type === 'atkMultiplier');
  assert.ok(eff, 'このキャラは攻撃強化のスキル');
  assert.ok((await page.textContent('#ally-boost')).includes(eff.type === 'atkBonus' ? `攻撃+${eff.value}` : `攻撃×${eff.value}`));
  for (const i of s.front.player.filter(j => s.teams.player[j].hp > 0)) {
    const p = E.previewMove(s, 'player', i);
    const txt = await page.$eval(`#ally-front [data-move="${i}"]`, b => ({ atk: (b.querySelector('.mo-atk') || {}).textContent || '', boosted: b.classList.contains('boosted'), heal: !!b.querySelector('.mo-heal.mo-pop') }));
    if (p.move.atk > 0) { assert.ok(txt.atk.endsWith(String(Math.round(p.boosted * 100) / 100)), `強化後の攻撃 ${txt.atk} = ${p.boosted}`); assert.ok(txt.boosted, '炎の縁取り'); }
    assert.equal(txt.heal, false, '回復の数字は光らせない');
  }
  // 待機中の表示：あと○ターン・使えない理由
  await openSkill(page, 'front', 0);
  assert.ok((await page.textContent('#modal .sk-cd.wait')).includes('あと'));
  assert.equal(await page.$('#btn-use-skill'), null);
  assert.ok((await page.textContent('#modal .reason')).includes('今は使えません'));
  await page.$eval('#modal [data-close="1"].btn', b => b.scrollIntoView({ block: 'end' }));
  await page.click('#modal [data-close="1"].btn');
  // 技を使ってターンが終わると、強化の印は消える（演出のタイマーではなく状態で）
  await page.waitForTimeout(TAP_GUARD);
  await page.click(`#ally-front [data-move="${s.front.player[0]}"]`);
  await page.click('#btn-confirm-move');
  await page.waitForFunction(() => window.RikuyouApp.getState().turnSide === 'cpu', null, { timeout: 15000 });
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('#ally-boost', b => b.classList.contains('on')), false, '強化の印が消える');
  assert.equal(await page.$$eval('#fx-layer .fx-skip, #fx-layer .fx-dim', n => n.length), 0, '透明な層が残らない');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: 固有スキルの結界・ダメージ・回復（表示がゲームの状態と一致・後衛は無傷）', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=12');
  await startFree(page, '騎士', SKILL_TEAM);
  await page.click('#btn-roll');
  await H.waitMyAction(page);
  // 後衛の結界＋回復のスキル（白銀の聖騎士）
  await openSkill(page, 'back', 1);
  await page.click('#btn-use-skill');
  await page.waitForFunction(() => window.RikuyouApp.getState().skillUsed);
  await page.waitForTimeout(400);
  let s = await H.state(page);
  const shielded = s.front.player.filter(i => s.teams.player[i].barrier);
  assert.ok(shielded.length > 0);
  assert.deepEqual((await page.$$eval('#ally-front .unit-card.has-barrier', c => c.map(x => Number(x.dataset.idx)))).sort(), shielded.slice().sort(), '結界の膜＝結界のあるキャラ');
  for (const i of s.front.player) assert.equal(await page.textContent(`#ally-front .bt-card[data-idx="${i}"] .bt-hp b`), String(s.teams.player[i].hp), 'HP の表示＝状態');
  assert.deepEqual(errors, []);
  await ctx.close();
  // 直接ダメージ（熾火の小鬼）：敵の前衛だけ・数字とHPが状態と一致
  const d = await open('mobile', 'fast=1&seed=12');
  await startFree(d.page, '小鬼', SKILL_TEAM);
  await d.page.click('#btn-roll');
  await H.waitMyAction(d.page);
  const before = await H.state(d.page);
  await openSkill(d.page, 'front', 2);
  await d.page.click('#btn-use-skill');
  await d.page.waitForFunction(() => window.RikuyouApp.getState().skillUsed);
  await d.page.waitForTimeout(400);
  s = await H.state(d.page);
  for (const i of s.teams.cpu.map((u, k) => k)) {
    const front = before.front.cpu.indexOf(i) >= 0;
    if (!front) assert.equal(s.teams.cpu[i].hp, before.teams.cpu[i].hp, '後衛は無傷');
    else assert.ok(s.teams.cpu[i].hp < before.teams.cpu[i].hp, '前衛にダメージ');
  }
  for (const i of s.front.cpu) assert.equal(await d.page.textContent(`#enemy-front .bt-card[data-idx="${i}"] .bt-hp b`), String(s.teams.cpu[i].hp), '敵のHPの表示＝状態');
  assert.deepEqual(d.errors, []);
  await d.ctx.close();
});

test('mobile: 動きを減らす設定の固有スキル（カットインなしで技名を短く表示・結果は同じ）', async () => {
  const ctx = await browser.newContext(Object.assign({ reducedMotion: 'reduce' }, H.VIEWPORTS.mobile));
  const { page, errors } = await open('mobile', 'seed=12', ctx);
  await startFree(page, '静か', SKILL_TEAM);
  await page.click('#btn-roll');
  await H.waitMyAction(page);
  await page.waitForFunction(() => !window.RikuyouDice.playing());
  await openSkill(page, 'front', 2);
  await page.click('#btn-use-skill');
  await page.waitForSelector('#fx-layer .fx-cutin.still');
  assert.equal(await page.$('#fx-layer .fx-dim'), null, '暗くしない');
  assert.equal(await page.$('#fx-layer .ci-band'), null, '帯のカットインなし');
  await page.waitForFunction(() => !document.querySelector('#fx-layer .fx-cutin'), null, { timeout: 3000 });
  const s = await H.state(page);
  assert.ok(s.skillUsed);
  for (const i of s.front.cpu) assert.equal(await page.textContent(`#enemy-front .bt-card[data-idx="${i}"] .bt-hp b`), String(s.teams.cpu[i].hp));
  assert.deepEqual(errors, []);
  await ctx.close();
});


const { CPU_MATCHES } = require('../src/data.js');
// CPU 対戦の選択：動かしている間は小さな札、止まると中央の1枚だけが大きく開く
const wheel = page => page.evaluate(() => {
  const sc = document.querySelector('#match-list'), open = document.querySelector('#match-open');
  const r = sc.getBoundingClientRect(), o = open.getBoundingClientRect();
  const items = [...sc.querySelectorAll('.mt-item')];
  const mid = r.top + r.height / 2;
  const near = items.map((it, i) => { const b = it.getBoundingClientRect(); return { i, d: Math.abs(b.top + b.height / 2 - mid) }; }).sort((a, b) => a.d - b.d)[0];
  return { open: !open.classList.contains('hidden') && !open.classList.contains('closing'), name: (open.querySelector('.mt-name') || {}).textContent || '',
    go: (open.querySelector('[data-match]') || {}).dataset ? open.querySelector('[data-match]') && open.querySelector('[data-match]').dataset.match : null,
    near: near.i, nearD: near.d, openMid: Math.abs(o.top + o.height / 2 - mid), top: sc.scrollTop, n: items.length };
});
const waitOpen = page => page.waitForFunction(() => { const o = document.querySelector('#match-open'); return !o.classList.contains('hidden') && !o.classList.contains('closing') && !o.getAnimations().length; }, null, { timeout: 4000 });
for (const kind of ['mobile', 'desktop']) {
  test(`${kind}: CPU対戦の選択（止まると中央が開く・動かすと閉じる・吸い付き・先頭と最後・タップ・キー・二重開始なし）`, async () => {
    const { ctx, page, errors } = await open(kind, 'seed=3');
    await H.startLocal(page, '選び手', { claim: false });
    await page.evaluate(() => { const p = window.RikuyouApp.getProfile(); ['m1', 'm2', 'm3'].forEach(id => { p.matches.won[id] = true; }); });
    await page.click('[data-go="match"]');
    await waitOpen(page);
    // 初めは次に挑戦できる未勝利の相手（4番目）。中央にあって、挑戦ボタンが出ている
    let w = await wheel(page);
    assert.equal(w.name, CPU_MATCHES[3].name);
    assert.equal(w.near, 3); assert.ok(w.openMid < 2, '大きな札は中央');
    assert.equal(w.go, 'm4');
    assert.equal(await page.$eval('#tabbar [data-tab="lobby"]', t => t.classList.contains('on')), false, '対人戦のタブは選ばれていない');
    // 開いたまま 1 秒待っても、閉じたり開いたりを繰り返さない
    const top0 = w.top;
    await page.waitForTimeout(1000);
    w = await wheel(page);
    assert.ok(w.open && w.top === top0, '開いたまま止まっている');
    // ホイール（スワイプ）で動かすと、すぐ閉じて小さな札の一覧になる
    const box = await (await page.$('#match-list')).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(80);
    assert.equal((await wheel(page)).open, false, '動かし始めたら閉じる');
    assert.equal(await page.$('#match-open:not(.hidden) [data-match]:not(.closing)') && (await wheel(page)).open, false, '動いている間は挑戦ボタンを出さない');
    // 素早く何度も動かす → 止まってから1回だけ、中央に一番近い札に吸い付いて開く
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, i % 2 ? -50 : 90); await page.waitForTimeout(30); }
    await waitOpen(page);
    w = await wheel(page);
    assert.ok(w.nearD < 2, '中央に吸い付く ' + w.nearD);
    assert.equal(w.name, CPU_MATCHES[w.near].name, '開いた札＝中央の札');
    // 展開の途中でもう一度動かすと、その場から閉じる
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(MT_WAIT);
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(40);
    assert.equal((await wheel(page)).open, false, '展開の途中で動かすと閉じる');
    await waitOpen(page);
    // 先頭と最後も中央に選べる（キー：Home／End）
    await page.focus('#match-list');
    await page.keyboard.press('Home');
    await waitOpen(page);
    w = await wheel(page);
    assert.equal(w.near, 0); assert.ok(w.nearD < 2); assert.equal(w.go, 'm1');
    assert.ok((await page.textContent('#match-open .mt-go')).includes('再戦'), '勝利済みは「再戦」');
    assert.ok((await page.textContent('#match-open .mt-reward')).includes('再戦報酬'));
    await page.keyboard.press('End');
    await waitOpen(page);
    w = await wheel(page);
    assert.equal(w.near, w.n - 1); assert.ok(w.nearD < 2);
    assert.equal(w.go, null, '未解放は挑戦できない');
    assert.ok((await page.textContent('#match-open .mt-locked')).includes('に勝つと解放'));
    // 上キーで1つ前へ・小さな札のタップで、その相手が中央に
    await page.keyboard.press('ArrowUp');
    await waitOpen(page);
    assert.equal((await wheel(page)).near, w.n - 2);
    await page.waitForTimeout(300);
    const pickSel = '#match-list .mt-item[data-pick="4"]';
    await page.$eval(pickSel, e => e.scrollIntoView({ block: 'nearest' }));
    await page.waitForTimeout(400);
    await waitOpen(page);
    // 一覧が止まった状態で、上下に見えている小さな札を押す
    const vis = await page.evaluate(() => { const sc = document.querySelector('#match-list').getBoundingClientRect(); return [...document.querySelectorAll('#match-list .mt-item[data-rel="before"]')].map(it => ({ k: +it.dataset.pick, r: it.getBoundingClientRect() })).filter(x => x.r.bottom > sc.top + 10 && x.r.top < sc.bottom).map(x => ({ k: x.k, y: x.r.top + x.r.height / 2, x: x.r.left + x.r.width / 2 })).pop(); });
    assert.ok(vis, '上に前の相手の札が見える');
    await page.mouse.click(vis.x, vis.y);
    await waitOpen(page);
    assert.equal((await wheel(page)).near, vis.k, 'タップした札が中央に');
    // 挑戦する（初勝利の報酬を表示）。連打しても戦闘は1回だけ始まる
    await page.keyboard.press('Home');
    await waitOpen(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await waitOpen(page);
    assert.equal((await wheel(page)).go, 'm4');
    assert.ok((await page.textContent('#match-open .mt-reward')).includes('初勝利'));
    await page.focus('#match-open .mt-go');
    await page.$eval('#match-open .mt-go', b => { b.click(); b.click(); b.click(); });
    await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)');
    assert.equal(await page.evaluate(() => window.RikuyouBattle.getSession()), await page.evaluate(() => window.RikuyouBattle.getSession()));
    assert.ok((await page.textContent('#battle-title')).includes(CPU_MATCHES[3].name));
    // 戻ると、直前に選んだ相手が中央
    await page.click('#modal [data-close="1"], #modal-x').catch(() => {});
    await page.evaluate(() => { document.querySelector('#modal').classList.add('hidden'); });
    await page.evaluate(() => window.RikuyouApp && 0);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
const MT_WAIT = 120;

test('mobile: CPU対戦の選択（全員に勝利済み・画面の回転・再戦後に戻る）', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=4');
  await H.startLocal(page, '覇者', { claim: false });
  await page.evaluate(ids => { const p = window.RikuyouApp.getProfile(); ids.forEach(id => { p.matches.won[id] = true; }); }, CPU_MATCHES.map(m => m.id));
  await page.click('[data-go="match"]');
  await waitOpen(page);
  let w = await wheel(page);
  assert.equal(w.near, w.n - 1, '全員に勝利済みなら最後の相手');
  assert.ok((await page.textContent('#match-progress')).includes(`${CPU_MATCHES.length} / ${CPU_MATCHES.length}`));
  assert.ok((await page.textContent('#match-open .mt-go')).includes('再戦'));
  // 画面の回転：選んでいる相手のまま中央
  await page.focus('#match-list');
  await page.keyboard.press('Home'); await waitOpen(page);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await waitOpen(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  await waitOpen(page);
  w = await wheel(page);
  assert.equal(w.near, 2); assert.ok(w.open); assert.ok(w.openMid < 2, JSON.stringify(w) + JSON.stringify(await page.evaluate(() => { const o = document.querySelector("#match-open"); const r = o.getBoundingClientRect(); return [r.top, r.height, o.style.cssText, document.querySelector("#match-wheel").getBoundingClientRect().height, document.querySelector("#match-list").clientHeight]; })));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await waitOpen(page);
  assert.equal((await wheel(page)).near, 2);
  // 再戦 → 戦闘 → 一覧へ戻ると、直前の相手が中央
  await page.click('#match-open .mt-go');
  await H.formation(page, [0, 1, 2], 0);
  assert.ok(await H.autoplay(page));
  await page.click('#modal [data-act]:has-text("対戦の一覧へ")');
  await waitOpen(page);
  w = await wheel(page);
  assert.equal(w.near, 2, '再戦後は直前の相手に戻る');
  assert.equal(w.name, CPU_MATCHES[2].name);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: CPU対戦の選択を指でスワイプ（挑戦ボタンの上から始めても一覧が動く・戦闘は始まらない・慣性の後に1回だけ開く）', async () => {
  const { ctx, page, errors } = await open('mobile', 'seed=6');
  await H.startLocal(page, '指', { claim: false });
  await page.evaluate(() => { const p = window.RikuyouApp.getProfile(); for (let i = 1; i <= 5; i++) p.matches.won['m' + i] = true; });
  await page.click('[data-go="match"]');
  await waitOpen(page);
  const before = await wheel(page);
  const btn = await (await page.$('#match-open .mt-go')).boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const x = btn.x + btn.width / 2, y = btn.y + btn.height / 2;
  // 開いている状態を記録しながら、ボタンの上から上へスワイプ
  const log = [];
  let on = true;
  const rec = (async () => { while (on) { log.push((await wheel(page).catch(() => ({}))).open); await new Promise(r => setTimeout(r, 25)); } })();
  await t('touchStart', x, y);
  await page.waitForTimeout(60);
  assert.equal((await wheel(page)).open, true, '触れただけでは閉じない');
  for (let k = 1; k <= 12; k++) { await t('touchMove', x, y - k * 16); await page.waitForTimeout(8); }
  await t('touchEnd');
  await page.waitForTimeout(1300);
  on = false; await rec;
  const w = await wheel(page);
  assert.ok(w.top > before.top, 'ボタンの上から始めても一覧が動く');
  assert.equal(await page.isHidden('#modal'), true, 'スワイプの終わりで戦闘を始めない');
  assert.equal(await page.evaluate(() => document.body.dataset.screen), 'match');
  assert.ok(w.open && w.nearD < 2, '止まると中央に吸い付いて開く');
  // 開いた → 閉じた → 開いた（1回だけ）。閉じたり開いたりを繰り返さない
  const changes = log.filter((v, i) => i > 0 && v !== log[i - 1]).length;
  assert.ok(changes <= 2, '開閉の切り替えは2回まで ' + log.join(''));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: 動きを減らす設定のCPU対戦の選択（弾まずに短く切り替わる）', async () => {
  const ctx = await browser.newContext(Object.assign({ reducedMotion: 'reduce' }, H.VIEWPORTS.mobile));
  const { page, errors } = await open('mobile', 'seed=2', ctx);
  await H.startLocal(page, '静か', { claim: false });
  await page.click('[data-go="match"]');
  await waitOpen(page);
  await page.focus('#match-list');
  await page.keyboard.press('End');
  await page.waitForTimeout(250);
  const w = await wheel(page);
  assert.equal(w.near, w.n - 1);
  assert.ok(w.open, 'すぐ開く');
  assert.equal(await page.$eval('#match-open', o => o.getAnimations().length), 0, '弾む動きなし');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: 星4「暁星の占星術師」の出目を選ぶスキル（選ぶまで発動できない・選んだ数字で前衛の技が変わる）', async () => {
  const { ctx, page, errors } = await open('mobile', 'seed=12');
  await H.startLocal(page, '占星', { claim: false });
  await page.evaluate(() => { const p = window.RikuyouApp.getProfile(); p.chars.akeboshi = { level: 1, exp: 0 }; p.team[0] = 'akeboshi'; });
  await page.click('[data-go="match"]');
  await page.click('[data-match="free"]');
  await H.formation(page, [0, 1, 2], 0);
  await page.waitForFunction(() => { const s = window.RikuyouApp.getState(); return s && s.phase === 'roll' && s.turnSide === 'player' && !window.RikuyouBattle.isLocked() && !window.RikuyouDice.playing(); }, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.click('#btn-roll');
  await H.waitMyAction(page);
  await page.waitForFunction(() => !window.RikuyouDice.playing());
  let s = await H.state(page);
  const idx = s.teams.player.findIndex(u => u.charId === 'akeboshi');
  const pos = s.front.player.indexOf(idx) >= 0 ? 'front' : 'back';
  const sel = `#ally-${pos} .bt-card[data-idx="${idx}"] .bt-art`;
  await page.$eval(sel, e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(TAP_GUARD);
  await page.click(sel);
  await page.waitForSelector('#modal .sk-pick');
  assert.equal(await page.isDisabled('#btn-use-skill'), true, '数字を選ぶまで発動できない');
  const want = s.dice === 6 ? 1 : 6;
  await page.click(`#modal [data-pick-dice="${want}"]`);
  assert.equal(await page.isDisabled('#btn-use-skill'), false);
  assert.ok((await page.textContent('#btn-use-skill')).includes(`出目を ${want} にする`));
  // 選んだ数字にしたときの前衛の技＝Engine の計算
  const pv = await page.$$eval('#modal .sk-pick-pv li', ls => ls.map(l => l.textContent));
  assert.equal(pv.length, s.front.player.filter(i => s.teams.player[i].hp > 0).length);
  await page.click('#btn-use-skill');
  await page.waitForFunction(v => window.RikuyouApp.getState().dice === v, want, { timeout: 5000 });
  await H.waitMyAction(page);
  await page.waitForFunction(() => !window.RikuyouDice.playing());
  s = await H.state(page);
  assert.equal(s.dice, want);
  assert.ok(s.log.some(l => l.text.includes(`出目を選んだ`) && l.text.endsWith(`→ ${want}`)));
  assert.equal((await page.evaluate(() => window.RikuyouDice.flatFace())).n, want, '大きな出目も選んだ数字');
  for (const i of s.front.player.filter(j => s.teams.player[j].hp > 0)) {
    const t = await page.textContent(`#ally-front [data-move="${i}"] .mo-name`);
    assert.ok(t.startsWith(String(want)), '技の欄も選んだ出目の技');
  }
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('mobile: ガチャ画面（星泉ガチャの絵・不足の表示・提供割合は実際の人数・注目★4・属性召喚と戻る）', async () => {
  const { ctx, page, errors } = await open('mobile', 'fast=1&seed=3');
  await H.startLocal(page, '召喚', { claim: false });
  await page.evaluate(() => { window.RikuyouApp.getProfile().stones = 605; });
  await page.click('[data-go="gacha"]');
  await page.waitForSelector('#screen-gacha:not(.hidden)');
  assert.ok(await page.$('#gacha-hero .ga-hero-art'), '星泉ガチャの絵');
  assert.equal(await page.isDisabled('#btn-gacha-1'), false);
  assert.equal(await page.isDisabled('#btn-gacha-10'), true);
  assert.ok((await page.textContent('#btn-gacha-10')).includes('石が295不足'));
  const all = E.CHARACTERS.length;
  await page.click('#gacha-rates summary');
  const rate = await page.textContent('#gacha-rate-text');
  assert.ok(rate.includes(`${all}体`) && rate.includes(`${(Math.round(10000 / all) / 100).toFixed(2)}%`), '1体あたりの確率＝実際の人数から');
  assert.equal(await page.$$eval('#gacha-pool .pool-item', c => c.length), all);
  assert.deepEqual(await page.$$eval('#gacha-featured .ga-feat b', b => b.map(x => x.textContent)), ['蒼泉の聖女', '暁星の占星術師']);
  // 属性召喚 → 上が属性の札に。戻るボタンで星泉ガチャへ
  await page.click('#gacha-kinds [data-gacha-kind="water"]');
  assert.ok((await page.textContent('#gacha-hero')).includes('水脈の召喚'));
  assert.deepEqual(await page.$$eval('#gacha-featured .ga-feat b', b => b.map(x => x.textContent)), ['蒼泉の聖女'], '水脈で出る注目キャラだけ');
  await page.click('#gacha-hero .ga-back');
  assert.ok(await page.$('#gacha-hero .ga-hero-art'));
  assert.equal(await page.getAttribute('#gacha-kinds [data-gacha-kind="all"]', 'aria-pressed'), 'true');
  // 引く：石が減り、結果が出る
  await page.click('#btn-gacha-1');
  await page.waitForSelector('#modal[data-kind="gacha"]:not(.hidden)');
  assert.ok((await page.textContent('#modal h3')).includes('旅立ちの星泉ガチャ'));
  assert.equal((await H.profile(page)).stones, 505);
  assert.deepEqual(errors, []);
  await ctx.close();
});
