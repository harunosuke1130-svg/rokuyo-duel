// オンライン（Firebase）機能のブラウザ操作テスト — Firebase エミュレーター上で実行
// 実行：npm run test:online（scripts/online-test.js がエミュレーターを起動してこのファイルを動かす）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { chromium } = require('playwright');
const H = require('./helpers.js');
const E = require('../src/engine.js');

const DOCS = path.join(__dirname, '..', 'docs');
const ADMIN = 'admin@example.com';
let browser, server, base, siteDir;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

test.before(async () => {
  // docs/ をコピーし、設定だけエミュレーター用に差し替える（本物の docs/firebase-config.js は触らない）
  siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rikuyou-site-'));
  fs.cpSync(DOCS, siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'firebase-config.js'), `window.RIKUYOU_FIREBASE = {
    enabled: true,
    config: { apiKey: 'demo-key', authDomain: 'demo-rikuyou.firebaseapp.com', projectId: 'demo-rikuyou', appId: 'demo-app' },
    adminEmails: ['${ADMIN}'],
    emulator: true
  };`);
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(siteDir, u === '/' ? 'index.html' : u);
    if (!f.startsWith(siteDir) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); server.close(); fs.rmSync(siteDir, { recursive: true, force: true }); });

let n = 0;
const email = tag => `${tag}${Date.now()}${n++}@example.com`;

async function open(kind = 'desktop', query = 'fast=1') {
  const ctx = await browser.newContext(H.VIEWPORTS[kind]);
  const page = await ctx.newPage();
  const w = H.watchPage(page);
  await page.goto(base + '?' + query);
  await page.waitForSelector('#screen-login:not(.hidden)', { timeout: 20000 });
  return Object.assign({ ctx, page }, w);
}
async function signUp(page, mail, name, pass = 'pass1234') {
  await page.click('[data-tab="up"]');
  await page.fill('#in-name', name);
  await page.fill('#in-email', mail);
  await page.fill('#in-pass', pass);
  await page.click('#btn-auth');
  await page.waitForSelector('#screen-home:not(.hidden)', { timeout: 20000 });
}
async function signIn(page, mail, pass = 'pass1234') {
  await page.fill('#in-email', mail);
  await page.fill('#in-pass', pass);
  await page.click('#btn-auth');
}
// Firestore に書き込みが届くまで待つ
const waitSaved = page => page.waitForTimeout(800);

test('アカウント登録→ログインボーナス→ログアウト→再ログインで進行が残る（Firestore）', async () => {
  const { ctx, page, errors } = await open('mobile');
  assert.equal(await page.evaluate(() => window.RikuyouApp.backendMode()), 'firebase');
  const mail = email('user');
  await signUp(page, mail, 'オンライン太郎');
  await H.closeBonus(page, true);
  let p = await H.profile(page);
  assert.equal(p.stones, 350);
  assert.equal(Object.keys(p.chars).length, 6);
  assert.equal(p.isAdmin, false);
  await waitSaved(page);
  await page.click('#btn-settings');
  await page.click('#modal [data-go="logout"]');
  await page.waitForSelector('#screen-login:not(.hidden)');
  // パスワード違いは日本語で案内
  await signIn(page, mail, 'wrongpass');
  await page.waitForFunction(() => document.querySelector('#login-error').textContent.length > 0);
  assert.match(await page.textContent('#login-error'), /パスワード|メールアドレス/);
  await signIn(page, mail);
  await page.waitForSelector('#screen-home:not(.hidden)', { timeout: 20000 });
  p = await H.profile(page);
  assert.equal(p.stones, 350, 'アカウントに保存された石');
  assert.equal(p.login.streak, 1);
  assert.equal(await page.$('#modal[data-kind="bonus"]:not(.hidden)'), null, '受け取り済みならボーナス画面は出ない');
  assert.ok((await page.textContent('#home-profile')).includes('オンライン太郎'));
  assert.deepEqual(errors.filter(e => !/400|auth\/(invalid|wrong)/i.test(e)), []);
  await ctx.close();
});

test('管理用アカウント（設定のメールアドレス）は全キャラを所持', async () => {
  const { ctx, page, errors } = await open('desktop');
  await signUp(page, ADMIN, '管理人');
  await H.closeBonus(page, false);
  const p = await H.profile(page);
  assert.equal(p.isAdmin, true);
  assert.equal(Object.keys(p.chars).length, E.CHARACTERS.length);
  assert.ok((await page.textContent('#home-profile')).includes('管理用アカウント'));
  await page.click('[data-go="team"]');
  assert.equal(await page.$$eval('.pick-card.locked', c => c.length), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('離れた2人のプレイヤー対戦（ルーム作成→コードで参加→決着・報酬が各アカウントに保存）', async () => {
  const A = await open('desktop', 'fast=1&seed=31');
  const Bp = await open('mobile', 'fast=1&seed=32');
  await signUp(A.page, email('host'), 'ホスト');
  await H.closeBonus(A.page, false);
  await signUp(Bp.page, email('guest'), 'ゲスト');
  await H.closeBonus(Bp.page, false);
  const code = await H.createRoom(A.page);
  assert.match(code, /^[A-Z2-9]{6}$/);
  await Bp.page.click('[data-go="lobby"]');
  await Bp.page.waitForSelector(`[data-room="${code}"]`, { timeout: 10000 });
  await H.joinRoom(Bp.page, code);
  await H.pvpFormation(A.page, [0, 1, 2], 0);
  await H.pvpFormation(Bp.page, [3, 4, 5], 2);
  const ok = await H.playPvp(A.page, Bp.page);
  assert.ok(ok, '対戦が決着しなかった');
  const sa = await H.state(A.page), sb = await H.state(Bp.page);
  assert.deepEqual(sa.teams, sb.teams, '両方の画面で同じ戦闘状態');
  assert.equal(sa.winner, sb.winner);
  assert.ok(sa.log.some(l => l.text.includes('先攻・後攻のサイコロ')));
  await waitSaved(A.page);
  // 再読み込みしても対戦成績が残る
  await A.page.reload();
  await A.page.waitForSelector('#screen-home:not(.hidden)', { timeout: 20000 });
  await H.closeBonus(A.page, false);
  const pa = await H.profile(A.page);
  const pb = await H.profile(Bp.page);
  assert.equal(pa.pvp.wins + pa.pvp.losses, 1);
  assert.equal(pa.pvp.wins, pb.pvp.losses);
  assert.deepEqual(A.errors, []);
  assert.deepEqual(Bp.errors, []);
  await A.ctx.close(); await Bp.ctx.close();
});

test('セキュリティルール：他人のプロフィール・ホストの戦闘状態は書き換えられない', async () => {
  const A = await open('desktop');
  const Bp = await open('desktop');
  await signUp(A.page, email('ra'), 'ルールA');
  await H.closeBonus(A.page, false);
  await signUp(Bp.page, email('rb'), 'ルールB');
  await H.closeBonus(Bp.page, false);
  const aUid = (await H.profile(A.page)).uid;
  const code = await H.createRoom(A.page);
  const tryOp = (page, fn, args) => page.evaluate(async ([src, a]) => {
    const db = window.firebase.firestore();
    const f = new Function('db', 'a', 'return (async () => {' + src + '})()');
    try { await f(db, a); return 'ok'; } catch (e) { return e.code || e.message; }
  }, [fn, args]);
  // 他人のプロフィール
  assert.equal(await tryOp(Bp.page, "await db.collection('profiles').doc(a).get();", aUid), 'permission-denied');
  assert.equal(await tryOp(Bp.page, "await db.collection('profiles').doc(a).set({ uid: a, stones: 99999 });", aUid), 'permission-denied');
  // 自分のプロフィールで石をマイナスにはできない
  const bUid = (await H.profile(Bp.page)).uid;
  assert.equal(await tryOp(Bp.page, "await db.collection('profiles').doc(a).update({ stones: -1 });", bUid), 'permission-denied');
  // 参加していないルームの戦闘状態は書けない
  assert.equal(await tryOp(Bp.page, "await db.collection('rooms').doc(a).update({ stateJson: '{}' });", code), 'permission-denied');
  // 参加後も、ゲストは intent 以外を書けない
  await Bp.page.click('[data-go="lobby"]');
  await H.joinRoom(Bp.page, code);
  await Bp.page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)', { timeout: 20000 });
  assert.equal(await tryOp(Bp.page, "await db.collection('rooms').doc(a).update({ stateJson: '{}' });", code), 'permission-denied');
  assert.equal(await tryOp(Bp.page, "await db.collection('rooms').doc(a).update({ status: 'over' });", code), 'permission-denied');
  assert.equal(await tryOp(Bp.page, "await db.collection('rooms').doc(a).update({ intent: { seq: 999, type: 'roll', args: '{}' } });", code), 'ok', '行動の依頼は書ける');
  // ルームを他人の名義で作れない
  assert.equal(await tryOp(Bp.page, "await db.collection('rooms').doc('ZZZZZZ').set({ code: 'ZZZZZZ', hostUid: a, status: 'waiting', guestUid: null });", aUid), 'permission-denied');
  await A.ctx.close(); await Bp.ctx.close();
});
