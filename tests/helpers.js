// ブラウザ操作テストの共通手順
'use strict';
const assert = require('node:assert/strict');

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1280, height: 860 } }
};
const TAP_GUARD = 470;

function watchPage(page) {
  const errors = [];
  const external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { if (!/^(file|data|about|blob):/.test(r.url()) && !/^http:\/\/127\.0\.0\.1/.test(r.url())) external.push(r.url()); });
  return { errors, external };
}

const state = page => page.evaluate(() => JSON.parse(JSON.stringify(window.RikuyouApp.getState())));
const profile = page => page.evaluate(() => JSON.parse(JSON.stringify(window.RikuyouApp.getProfile())));
const noHorizontalScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function closeBonus(page, claim) {
  const m = await page.waitForSelector('#modal[data-kind="bonus"]:not(.hidden)', { timeout: 15000 }).catch(() => null);
  if (!m) return;
  if (claim) await page.click('#btn-bonus-modal');
  else await page.click('#modal [data-close="1"].btn');
  await page.waitForTimeout(100);
}

// この端末保存モード：名前を入れてはじめる
async function startLocal(page, name, opts = {}) {
  await page.waitForSelector('#screen-login:not(.hidden)');
  await page.fill('#in-name', name);
  await page.click('#btn-local-start');
  await page.waitForSelector('#screen-home:not(.hidden)');
  await closeBonus(page, opts.claim);
}

// 出撃準備：「タップで入れ替え」モードで前衛を並べ、カードをタップしてリーダーを選んで出撃
const frontIdx = page => page.$$eval('#modal .fm-grid[data-row="front"] .fm-card', cs => cs.map(c => Number(c.dataset.idx)));
async function arrange(page, front, leader) {
  await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)', { timeout: 20000 });
  let cur = await frontIdx(page);
  if (front.some(i => cur.indexOf(i) < 0)) {
    await page.click('#btn-fm-swapmode');
    for (const i of front) {
      cur = await frontIdx(page);
      if (cur.indexOf(i) >= 0) continue;
      const out = cur.find(k => front.indexOf(k) < 0);
      await page.click(`#modal .fm-card[data-idx="${out}"]`);
      await page.click(`#modal .fm-card[data-idx="${i}"]`);
    }
    await page.click('#btn-fm-swapmode');
  }
  await page.click(`#modal .fm-card[data-idx="${leader}"]`);
  assert.deepEqual((await frontIdx(page)).slice().sort(), front.slice().sort());
  assert.equal(await page.getAttribute(`#modal .fm-card[data-idx="${leader}"]`, 'aria-pressed'), 'true');
  await page.click('#btn-formation-ok');
}
async function formation(page, front, leader) {
  await arrange(page, front, leader);
  await page.waitForFunction(() => { const s = window.RikuyouApp.getState(); return s && s.phase !== 'formation' && s.phase !== 'initiative'; }, null, { timeout: 15000 });
}

const waitMyRoll = (page, timeout = 15000) => page.waitForFunction(() => {
  const s = window.RikuyouApp.getState();
  return s && s.turnSide === window.RikuyouApp.me() && s.phase === 'roll' && !window.RikuyouApp.isLocked() && document.querySelector('#modal').classList.contains('hidden');
}, null, { timeout });
const waitMyAction = (page, timeout = 15000) => page.waitForFunction(() => {
  const s = window.RikuyouApp.getState();
  return s && s.turnSide === window.RikuyouApp.me() && s.phase === 'action' && !window.RikuyouApp.isLocked();
}, null, { timeout });

// 1手だけ自動で進める（自分の番なら操作する）。決着の結果画面なら 'done'
async function step(page) {
  const st = await page.evaluate(() => {
    const s = window.RikuyouApp.getState();
    const m = document.querySelector('#modal');
    const me = window.RikuyouApp.me();
    return s ? {
      phase: s.phase, side: s.turnSide, me, locked: window.RikuyouApp.isLocked(),
      modal: m.classList.contains('hidden') ? '' : m.dataset.kind,
      front: s.front[me].filter(i => s.teams[me][i].hp > 0),
      pending: s.pendingReplace && s.pendingReplace.side
    } : null;
  });
  if (!st) return 'wait';
  if (st.modal === 'result') return 'done';
  if (st.modal === 'replace') { await page.click('#modal .target-btn >> nth=0'); return 'acted'; }
  if (st.modal) return 'wait';
  if (st.locked) return 'wait';
  if (st.side === st.me && st.phase === 'roll') { await page.click('#btn-roll'); return 'acted'; }
  if (st.side === st.me && st.phase === 'action' && st.front.length) {
    await page.waitForTimeout(TAP_GUARD);
    const btn = await page.$(`#ally-front [data-move="${st.front[0]}"]`);
    if (!btn) return 'wait';
    await btn.click();
    await page.waitForSelector('#btn-confirm-move', { timeout: 5000 }).catch(() => null);
    const c = await page.$('#btn-confirm-move');
    if (c) await c.click();
    return 'acted';
  }
  return 'wait';
}

async function autoplay(page, limit = 1500) {
  for (let i = 0; i < limit; i++) {
    const r = await step(page);
    if (r === 'done') return true;
    if (r === 'wait') await page.waitForTimeout(40);
  }
  return false;
}

/* ----- 対人戦 ----- */
async function createRoom(page) {
  await page.click('[data-go="lobby"]');
  await page.waitForSelector('#btn-room-create');
  await page.click('#btn-room-create');
  await page.waitForSelector('#room-code');
  return (await page.textContent('#room-code')).trim();
}
async function joinRoom(page, code) {
  await page.waitForSelector('#in-code');
  await page.fill('#in-code', code.toLowerCase());
  await page.click('#join-form button[type="submit"]');
}
async function pvpFormation(page, front, leader) {
  await arrange(page, front, leader);
}
// 2つの画面を交互に進めて、両方に結果画面が出るまで
async function playPvp(a, b, limit = 3000) {
  let doneA = false, doneB = false;
  for (let i = 0; i < limit && !(doneA && doneB); i++) {
    const ra = doneA ? 'done' : await step(a);
    const rb = doneB ? 'done' : await step(b);
    doneA = ra === 'done'; doneB = rb === 'done';
    if (ra === 'wait' && rb === 'wait') await a.waitForTimeout(50);
  }
  return doneA && doneB;
}

module.exports = {
  VIEWPORTS, TAP_GUARD, watchPage, state, profile, noHorizontalScroll, closeBonus, startLocal,
  formation, arrange, frontIdx, waitMyRoll, waitMyAction, step, autoplay, createRoom, joinRoom, pvpFormation, playPvp
};
