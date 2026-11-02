#!/usr/bin/env node
/* ダンジョンの絵づくり：設定 → 画像の生成 → 保存・軽量化 → ゲームに組み込み → スマホと PC で確認。
 *
 *   node scripts/dungeon-art.js prompts  <ダンジョンID>   画像の指示文（プロンプト）を作る（art/<ID>/prompts.md）
 *   node scripts/dungeon-art.js generate <ダンジョンID>   画像を生成して art/<ID>/raw/ に保存する（API の鍵が必要）
 *   node scripts/dungeon-art.js import   <ダンジョンID>   art/<ID>/raw/ の画像を縮小・圧縮して src/img/ に入れる
 *   node scripts/dungeon-art.js emblem   <ダンジョンID>   丸い紋章の顔の位置だけを art/<ID>/art.json から書き直す
 *   node scripts/dungeon-art.js check    <ダンジョンID>   ビルドして、スマホ・PC の画面を撮って確かめる
 *   node scripts/dungeon-art.js all      <ダンジョンID>   generate → import → check を続けて行う
 *
 * オプション：--only floor1,floor3（一部だけ） --force（既にある画像を上書き） --raw <フォルダ>（元画像の場所）
 *
 * 1 つのダンジョンに必要な画像（art/<ID>/raw/ のファイル名）：
 *   floor1（1階の雑魚）・floor2（2階の中ボス）・floor3（3階の大ボス）……1体ずつ、縦長
 *   portrait（スマホ用の縦長背景）・landscape（PC 用の横長背景）……敵のいない景色
 *   拡張子は .png / .jpg / .jpeg / .webp のどれでもよい（手で用意した絵を置いても同じように取り込める）
 * 組み込み先：
 *   敵 → src/img/chara/<敵ID>.webp、背景 → src/img/battle/<ID>-portrait.webp・<ID>-landscape.webp、
 *   ダンジョン一覧のバナー → 横長背景から切り出して src/img/dungeon/<ID>.webp、
 *   丸い紋章の顔の位置 → src/style.css の「dungeon-art: <ID>」の区切りの中（art/<ID>/art.json の emblem から）
 *
 * 画像の生成（generate）は、環境変数 GEMINI_API_KEY（Google の Gemini。既定）か OPENAI_API_KEY を使う。
 * モデルは ART_MODEL で変えられる（既定 gemini-2.5-flash-image ／ gpt-image-1）。鍵が無いときは何もしない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const D = require('../src/data.js');
const E = require('../src/engine.js');

const KEYS = ['floor1', 'floor2', 'floor3', 'portrait', 'landscape'];
const RAW_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const RANK_KEY = { '雑魚': 'floor1', '中ボス': 'floor2', '大ボス': 'floor3' };

/* ---------- 共通 ---------- */
function args() {
  const a = process.argv.slice(2);
  const opt = { cmd: a[0], id: a[1], only: null, force: false, raw: null };
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--only') opt.only = a[++i].split(',');
    else if (a[i] === '--force') opt.force = true;
    else if (a[i] === '--raw') opt.raw = path.resolve(a[++i]);
  }
  return opt;
}
function fail(msg) { console.error('✗ ' + msg); process.exit(1); }
const artDir = id => path.join(ROOT, 'art', id);
const rel = f => path.relative(ROOT, f);
function dungeon(id) {
  const d = D.DUNGEONS.find(x => x.id === id);
  if (!d) fail(`ダンジョン「${id}」が src/data.js の DUNGEONS にありません（${D.DUNGEONS.map(x => x.id).join(' / ')}）`);
  return d;
}
const enemies = d => d.floors.map((f, k) => ({ key: KEYS[k], floor: f, boss: E.getChar(f.boss) }));

// 属性ごとの色と雰囲気（絵の指示に入れる）
const ELEMENT_LOOK = {
  fire: 'ember red, molten orange and charcoal black, glowing lava light, drifting sparks',
  water: 'deep teal, aquamarine and misty blue, rippling light, sea foam and mist',
  nature: 'moss green, fern green and warm sunlight, leaves, vines and wildflowers',
  holy: 'ivory, pale gold and soft white light, sacred glow, feathers and marble',
  dark: 'indigo, violet and moonlit silver, deep shadows, faint magic glow'
};
// 雑魚・中ボス・大ボスで姿と迫力を変える
const RANK_LOOK = {
  '雑魚': 'a small lesser monster, modest and slightly comical or feral, simple silhouette, the creature fills about 55-65% of the image height, calm eye-level view',
  '中ボス': 'a formidable mid-tier guardian, larger and heavily built, armored or richly adorned, powerful dynamic stance, the creature fills about 75-80% of the image height',
  '大ボス': 'an awe-inspiring final boss, towering and majestic, intricate ornate details, radiant magical aura, dramatic low-angle view, the creature fills about 90% of the image height with overwhelming presence'
};
const STYLE = 'Hand-painted watercolor fantasy illustration with delicate fine ink linework, soft layered washes, subtle paper texture, rich but harmonious colors, in the same style as the reference images.';
const NO_TEXT = 'No text, no letters, no numbers, no logo, no watermark, no UI, no buttons, no HP bar, no stars, no name plate, no card frame, no border, no vignette frame.';

/* ---------- art.json（ダンジョンごとの絵の設定） ---------- */
// describe（敵の見た目・英語）と world（場所の景色・英語）は、ダンジョンを作るときに書く。
// emblem は丸い紋章で顔が見える位置（--ex/--ey/--es）、focus は切り抜きの中心（0〜1）。
function loadArt(id, create) {
  const f = path.join(artDir(id), 'art.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!create) return null;
  const d = dungeon(id);
  const art = {
    dungeon: id,
    world: `${d.name} — ${d.text}`,
    enemies: Object.fromEntries(enemies(d).map(e => [e.boss.id, {
      describe: `${e.boss.name} (${e.boss.subTypes.join(', ')})`,
      emblem: { ex: 50, ey: 25, es: e.boss.rank === '大ボス' ? 220 : 200 },
      focus: [0.5, 0.5]
    }])),
    backgrounds: { portraitFocus: [0.5, 0.5], landscapeFocus: [0.5, 0.5], bannerFocus: [0.5, 0.55] }
  };
  fs.mkdirSync(artDir(id), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(art, null, 2) + '\n');
  console.log(`・${rel(f)} を作りました（describe と world を英語で具体的に書くと、絵が設定に近づきます）`);
  return art;
}

/* ---------- prompts：画像の指示文 ---------- */
function buildPrompts(id) {
  const d = dungeon(id);
  const art = loadArt(id, true);
  const last = d.floors[d.floors.length - 1];
  const el = E.getChar(last.boss).element;
  const out = {};
  enemies(d).forEach(e => {
    const b = e.boss, a = art.enemies[b.id] || {};
    out[e.key] = {
      target: b.id, kind: 'enemy', aspect: '9:16',
      prompt: [
        `${STYLE}`,
        `A single fantasy monster for a dice battle game: ${a.describe || b.name}.`,
        `It is the ${b.rank === '雑魚' ? 'first-floor minion' : b.rank === '中ボス' ? 'second-floor mid-boss' : 'third-floor final boss'} of the dungeon "${d.name}" (${art.world}).`,
        `Element: ${D.ELEMENTS[b.element].name} — colors and mood: ${ELEMENT_LOOK[b.element]}.`,
        `Signature skill: "${b.skill.name}" — ${b.skill.text}`,
        `${RANK_LOOK[b.rank]}.`,
        'Exactly one creature, no other characters, not a group shot. Full body visible from head to feet, centered, facing the viewer at a slight angle, face clearly visible in the upper part of the image.',
        `The dungeon environment is softly painted behind it and fills the whole canvas edge to edge. Vertical portrait composition (9:16).`,
        NO_TEXT
      ].join(' ')
    };
  });
  const bg = orient => [
    STYLE,
    `An empty background scene of the dungeon "${d.name}": ${art.world}.`,
    `Colors and mood: ${ELEMENT_LOOK[el]}.`,
    'No characters, no creatures, no people — scenery only.',
    'Open ground in the lower third where battle characters can stand; the center is not too busy so game cards stay readable over it.',
    orient === 'portrait'
      ? 'Vertical composition (9:16) for smartphones; important landmarks within the central 80% of the width.'
      : 'Wide horizontal composition (16:9) for PC; the main landmark sits in the middle horizontal band so it can be cropped into a 2:1 banner.',
    'Fills the whole canvas edge to edge with no empty margins.',
    NO_TEXT
  ].join(' ');
  out.portrait = { target: `${id}-portrait`, kind: 'portrait', aspect: '9:16', prompt: bg('portrait') };
  out.landscape = { target: `${id}-landscape`, kind: 'landscape', aspect: '16:9', prompt: bg('landscape') };

  // 読みやすい説明（日本語）＋実際に使う指示文（英語）
  const md = [`# ${d.name}（${id}）の絵の指示`, '', `${d.text}　推奨 ${d.recommend}`, '',
    '共通：繊細な線と手描きの水彩風ファンタジー（既存の採用済みの絵を参考画像として渡す）。名前・HP・星・ボタンなどの文字は描かない。余白なしで画面全体を覆う。', ''];
  KEYS.forEach(k => {
    const p = out[k];
    const label = { floor1: '1階の雑魚', floor2: '2階の中ボス', floor3: '3階の大ボス', portrait: 'スマホ用の縦長背景', landscape: 'PC 用の横長背景' }[k];
    const who = p.kind === 'enemy' ? E.getChar(p.target) : null;
    md.push(`## ${label}（${k}・${p.aspect}）`, who ? `${who.name}／${D.ELEMENTS[who.element].name}／${who.rank}　→ \`src/img/chara/${who.id}.webp\`` : `→ \`src/img/battle/${p.target}.webp\``, '', '```', p.prompt, '```', '');
  });
  fs.writeFileSync(path.join(artDir(id), 'prompts.md'), md.join('\n'));
  fs.writeFileSync(path.join(artDir(id), 'prompts.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`・${rel(path.join(artDir(id), 'prompts.md'))} に指示文を書きました`);
  return out;
}

/* ---------- generate：画像の生成 ---------- */
// 参考画像：採用済みの絵（同じランクの敵・既存の背景）を渡して、線と塗りをそろえる
function references(kind, rank, id) {
  const pick = [];
  const chara = f => path.join(ROOT, 'src/img/chara', f + '.webp');
  const others = D.DUNGEONS.filter(d => d.id !== id);
  if (kind === 'enemy') {
    others.forEach(d => d.floors.forEach(f => { const b = E.getChar(f.boss); if (b.rank === rank && fs.existsSync(chara(b.id))) pick.push(chara(b.id)); }));
  } else {
    others.forEach(d => { const f = path.join(ROOT, 'src/img/battle', `${d.id}-${kind}.webp`); if (fs.existsSync(f)) pick.push(f); });
  }
  return pick.slice(-2);
}
async function genGemini(p, refs) {
  const model = process.env.ART_MODEL || 'gemini-2.5-flash-image';
  const parts = [{ text: p.prompt + (refs.length ? ' Match the line work and watercolor painting style of the attached reference images, but do not copy their subjects.' : '') }]
    .concat(refs.map(f => ({ inline_data: { mime_type: 'image/webp', data: fs.readFileSync(f).toString('base64') } })));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: p.aspect } } })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(j.error && j.error.message) || ''}`);
  const img = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.find(x => x.inlineData || x.inline_data);
  if (!img) throw new Error('Gemini が画像を返しませんでした（指示文を確かめてください）');
  const data = img.inlineData || img.inline_data;
  return { buf: Buffer.from(data.data, 'base64'), ext: (data.mimeType || data.mime_type || 'image/png').includes('jpeg') ? '.jpg' : '.png' };
}
async function genOpenAI(p, refs) {
  const model = process.env.ART_MODEL || 'gpt-image-1';
  const size = p.aspect === '16:9' ? '1536x1024' : '1024x1536';
  const auth = { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY };
  let res;
  if (refs.length) {   // 参考画像つき（images/edits）
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', p.prompt + ' Match the line work and watercolor painting style of the reference images, but do not copy their subjects.');
    fd.append('size', size); fd.append('quality', 'high');
    refs.forEach(f => fd.append('image[]', new Blob([fs.readFileSync(f)], { type: 'image/webp' }), path.basename(f)));
    res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: auth, body: fd });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt: p.prompt, size, quality: 'high' }) });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(j.error && j.error.message) || ''}`);
  return { buf: Buffer.from(j.data[0].b64_json, 'base64'), ext: '.png' };
}
async function generate(opt) {
  const provider = process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : null;
  if (!provider) fail('画像を生成する鍵がありません。環境変数 GEMINI_API_KEY（または OPENAI_API_KEY）を設定してください。\n  鍵が無くても、art/' + opt.id + '/raw/ に floor1〜3・portrait・landscape の画像を置けば import で取り込めます。');
  const prompts = buildPrompts(opt.id);
  const raw = opt.raw || path.join(artDir(opt.id), 'raw');
  fs.mkdirSync(raw, { recursive: true });
  for (const k of KEYS) {
    if (opt.only && opt.only.indexOf(k) < 0) continue;
    if (!opt.force && findRaw(raw, k)) { console.log(`・${k}：もうあるので飛ばします（作り直すときは --force）`); continue; }
    const p = prompts[k];
    const refs = references(p.kind === 'enemy' ? 'enemy' : p.kind, p.kind === 'enemy' ? E.getChar(p.target).rank : null, opt.id);
    process.stdout.write(`・${k} を生成中（${provider}・参考画像 ${refs.length} 枚）… `);
    const r = await (provider === 'gemini' ? genGemini : genOpenAI)(p, refs);
    RAW_EXT.forEach(x => { const old = path.join(raw, k + x); if (fs.existsSync(old)) fs.unlinkSync(old); });
    fs.writeFileSync(path.join(raw, k + r.ext), r.buf);
    console.log(`保存しました（${rel(path.join(raw, k + r.ext))}・${Math.round(r.buf.length / 1024)}KB）`);
  }
}

/* ---------- import：保存・軽量化・組み込み ---------- */
function findRaw(dir, key) {
  for (const x of RAW_EXT) { const f = path.join(dir, key + x); if (fs.existsSync(f)) return f; }
  return null;
}
function emblemCss(id, art) {
  const css = path.join(ROOT, 'src/style.css');
  let s = fs.readFileSync(css, 'utf8');
  const start = `/* ---- dungeon-art: ${id}（scripts/dungeon-art.js が書く。顔の位置は art/${id}/art.json の emblem で直す） ---- */`;
  const end = `/* ---- dungeon-art: ${id} ここまで ---- */`;
  const body = Object.keys(art.enemies).map(bid => {
    const e = art.enemies[bid].emblem || {};
    return `[data-char="${bid}"] { --cx: ${e.ex ?? 50}%; --cy: ${e.ey ?? 25}%; --ex: ${e.ex ?? 50}%; --ey: ${e.ey ?? 25}%; --es: ${e.es ?? 200}%; }`;
  }).join('\n');
  const block = `${start}\n${body}\n${end}`;
  const i = s.indexOf(start), j = s.indexOf(end);
  s = i >= 0 && j > i ? s.slice(0, i) + block + s.slice(j + end.length) : s.replace(/\s*$/, '\n\n' + block + '\n');
  fs.writeFileSync(css, s);
}
function importArt(opt) {
  const d = dungeon(opt.id);
  const art = loadArt(opt.id, true);
  const raw = opt.raw || path.join(artDir(opt.id), 'raw');
  const jobs = [];
  const add = (kind, key, out, focus) => {
    if (opt.only && opt.only.indexOf(key) < 0 && !(kind === 'banner' && opt.only.indexOf('landscape') >= 0)) return;
    const src = findRaw(raw, key);
    if (!src) { console.log(`・${key}：元の画像がありません（${rel(raw)}/${key}.png など）`); return; }
    if (fs.existsSync(out) && !opt.force) { console.log(`・${rel(out)} はもうあるので上書きしません（上書きは --force）`); return; }
    jobs.push({ kind, src, out, focus });
  };
  enemies(d).forEach(e => add('enemy', e.key, path.join(ROOT, 'src/img/chara', e.boss.id + '.webp'), (art.enemies[e.boss.id] || {}).focus));
  const bg = art.backgrounds || {};
  add('portrait', 'portrait', path.join(ROOT, 'src/img/battle', `${opt.id}-portrait.webp`), bg.portraitFocus);
  add('landscape', 'landscape', path.join(ROOT, 'src/img/battle', `${opt.id}-landscape.webp`), bg.landscapeFocus);
  add('banner', 'landscape', path.join(ROOT, 'src/img/dungeon', `${opt.id}.webp`), bg.bannerFocus);
  if (!jobs.length) { console.log('取り込む画像がありませんでした'); return []; }
  [...new Set(jobs.map(j => path.dirname(j.out)))].forEach(x => fs.mkdirSync(x, { recursive: true }));
  const cfg = path.join(artDir(opt.id), '.jobs.json');
  fs.writeFileSync(cfg, JSON.stringify({ jobs }));
  let out;
  try { out = JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'art_process.py'), cfg], { encoding: 'utf8' })); }
  finally { fs.unlinkSync(cfg); }
  out.forEach(r => console.log(`${r.ok ? '・' : '✗ '}${rel(r.out)}：${r.size.join('×')}・${r.kb}KB（画質${r.quality}）${r.ok ? '' : ' 容量の目安を超えています'}`));
  if (jobs.some(j => j.kind === 'enemy')) { emblemCss(opt.id, art); console.log('・src/style.css に丸い紋章の顔の位置を書きました'); }
  return out;
}

/* ---------- check：スマホと PC で表示を確かめる ---------- */
async function check(opt) {
  const d = dungeon(opt.id);
  execFileSync('node', [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
  const { chromium } = require('playwright');
  const outDir = path.join(artDir(opt.id), 'check');
  fs.mkdirSync(outDir, { recursive: true });
  const FILE = 'file://' + path.join(ROOT, 'docs/index.html') + '?fast=1&seed=7';
  const VIEWS = { mobile: { width: 390, height: 844 }, pc: { width: 1280, height: 800 } };
  const problems = [], shots = [];
  const browser = await chromium.launch();
  const login = async page => {
    await page.goto(FILE);
    await page.waitForSelector('#screen-login:not(.hidden)');
    await page.fill('#in-name', '絵の確認');
    await page.click('#btn-local-start');
    await page.waitForSelector('#screen-home:not(.hidden)');
    await page.evaluate(id => {   // 確かめるダンジョンを解放（前のダンジョンを踏破済みに）
      const p = window.RikuyouApp.getProfile();
      window.RikuyouData.DUNGEONS.forEach(x => { if (x.id !== id) p.dungeon.cleared[x.id] = true; });
      const m = document.querySelector('#modal'); if (m) m.classList.add('hidden');
    }, opt.id);
  };
  const isImg = v => /url\("?data:image/.test(v || '');
  try {
    for (const [view, vp] of Object.entries(VIEWS)) {
      // ダンジョン一覧のバナーと詳細
      let ctx = await browser.newContext({ viewport: vp });
      let page = await ctx.newPage();
      await login(page);
      await page.click('[data-go="dungeon"]');
      await page.waitForSelector('#screen-dungeon:not(.hidden)');
      const card = `[data-dg="${opt.id}"]`;
      await page.$eval(card, c => c.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      if (!isImg(await page.$eval(`${card} .dg-art`, e => getComputedStyle(e).backgroundImage))) problems.push(`${view}：ダンジョン一覧のバナーに絵が出ていません`);
      await page.screenshot({ path: path.join(outDir, `${view}-1-list.png`) }); shots.push(`${view}-1-list.png`);
      await page.click(card);
      await page.waitForSelector('#modal[data-kind="dungeon"]:not(.hidden)');
      await page.waitForTimeout(400);
      const emblems = await page.$$eval('#modal .dg-floor .emblem', es => es.map(e => getComputedStyle(e).backgroundImage));
      if (emblems.length !== 3 || !emblems.every(isImg)) problems.push(`${view}：詳細の敵 3 体の紋章に絵が出ていません`);
      await page.screenshot({ path: path.join(outDir, `${view}-2-detail.png`) }); shots.push(`${view}-2-detail.png`);
      await ctx.close();
      // 各階の戦闘（その階の敵を1階に並べ替えて開く。表示を見るだけ）
      for (let k = 0; k < d.floors.length; k++) {
        ctx = await browser.newContext({ viewport: vp });
        page = await ctx.newPage();
        await login(page);
        await page.evaluate(([id, k]) => { const x = window.RikuyouData.DUNGEONS.find(y => y.id === id); const f = x.floors; [f[0], f[k]] = [f[k], f[0]]; }, [opt.id, k]);
        await page.click('[data-go="dungeon"]');
        await page.click(`[data-dg="${opt.id}"]`);
        await page.click('#btn-dg-start');
        await page.waitForSelector('#modal[data-kind="formation"]:not(.hidden)', { timeout: 20000 });
        await page.waitForTimeout(600);
        await page.click('#btn-formation-ok');
        await page.waitForFunction(() => { const s = window.RikuyouApp.getState(); return s && s.phase !== 'formation' && s.phase !== 'initiative' && document.querySelector('#modal').classList.contains('hidden'); }, null, { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(500);
        const bid = d.floors[k].boss;
        const orient = vp.width > vp.height ? 'landscape' : 'portrait';
        const info = await page.evaluate(([bid, id, orient]) => {
          const sc = document.querySelector('#screen-battle');
          const bg = getComputedStyle(sc, '::before').backgroundImage;   // 背景は ::before に描いている
          const want = getComputedStyle(document.documentElement).getPropertyValue(`--bt-${id}-${orient}`).trim();
          const art = document.querySelector(`#screen-battle .portrait[data-char="${bid}"]`);
          const key = want.slice(0, 400).replace(/^url\("?/, '');
          const img = v => /url\("?data:image\//.test(v || '');
          return { bg: img(bg), art: art ? img(getComputedStyle(art).backgroundImage) : false, dataBg: sc.dataset.bg, match: !!want && bg.indexOf(key.slice(40, 400)) >= 0 };
        }, [bid, opt.id, orient]);
        if (info.dataBg !== opt.id || !info.bg) problems.push(`${view}：${k + 1}階の戦闘の背景に絵が出ていません`);
        else if (!info.match) problems.push(`${view}：${k + 1}階の戦闘の背景が${orient === 'portrait' ? 'スマホ用（縦長）' : 'PC 用（横長）'}になっていません`);
        if (!info.art) problems.push(`${view}：${k + 1}階の敵（${bid}）の絵が出ていません`);
        const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        if (over) problems.push(`${view}：${k + 1}階の戦闘で横にはみ出しています`);
        await page.screenshot({ path: path.join(outDir, `${view}-${k + 3}-floor${k + 1}.png`) }); shots.push(`${view}-${k + 3}-floor${k + 1}.png`);
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  // 画像の大きさと容量
  const files = [...d.floors.map(f => `src/img/chara/${f.boss}.webp`), `src/img/battle/${opt.id}-portrait.webp`, `src/img/battle/${opt.id}-landscape.webp`, `src/img/dungeon/${opt.id}.webp`];
  const limits = { chara: 80, battle: 200, dungeon: 60 };
  files.forEach(f => {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) { problems.push(`${f} がありません`); return; }
    const kb = fs.statSync(full).size / 1024, lim = limits[f.split('/')[2]];
    if (kb > lim) problems.push(`${f} が ${Math.round(kb)}KB（目安 ${lim}KB 以下）`);
  });
  console.log(`・スクリーンショット：${rel(outDir)}/（${shots.length} 枚）`);
  if (problems.length) { problems.forEach(p => console.log('✗ ' + p)); process.exitCode = 1; }
  else console.log('✓ スマホ・PC とも、バナー・敵 3 体・背景が表示されました');
  return problems;
}

/* ---------- 入口 ---------- */
async function main() {
  const opt = args();
  if (!opt.cmd || !opt.id) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 26).join('\n')); process.exit(1); }
  dungeon(opt.id);
  if (opt.cmd === 'prompts') buildPrompts(opt.id);
  else if (opt.cmd === 'generate') await generate(opt);
  else if (opt.cmd === 'import') importArt(opt);
  else if (opt.cmd === 'emblem') { emblemCss(opt.id, loadArt(opt.id, true)); console.log('・src/style.css の丸い紋章の顔の位置を書き直しました（check で確かめてください）'); }
  else if (opt.cmd === 'check') await check(opt);
  else if (opt.cmd === 'all') { await generate(opt); importArt(opt); await check(opt); }
  else fail('コマンドは prompts / generate / import / emblem / check / all のどれかです');
}

// 画像の生成はプロキシ経由（この環境）でも届くよう、Node の fetch にプロキシの設定を使わせる
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY && ['generate', 'all'].includes(process.argv[2])) {
  const r = spawnSync(process.execPath, ['--no-warnings', __filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status === null ? 1 : r.status);
} else {
  main().catch(e => fail(e.message));
}
