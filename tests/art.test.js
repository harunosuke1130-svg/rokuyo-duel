'use strict';
// ダンジョンの絵づくり（scripts/dungeon-art.js・scripts/art_process.py）のテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const hasPil = spawnSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }).status === 0;

test('画像の保存・軽量化：余白を切り、決まった大きさ・容量の WebP にする', { skip: !hasPil && 'python3 の Pillow がありません' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  // 元画像：白い余白付きの大きな絵（細かい模様入りで、そのままでは目安の容量を超える）
  execFileSync('python3', ['-I', '-c', `
import random
from PIL import Image, ImageOps, ImageFilter
random.seed(1)
def noisy(w, h):
    im = Image.effect_noise((w, h), 90).convert('RGB')
    im = Image.merge('RGB', [im.getchannel(0), im.rotate(90, expand=False).getchannel(0), im.getchannel(0).point(lambda v: 255 - v)])
    return im.filter(ImageFilter.GaussianBlur(1.5))   # 絵に近い、細かすぎない模様
ImageOps.expand(noisy(1024, 1536), border=80, fill=(255, 255, 255)).save(r'${dir}/enemy.png')
noisy(1024, 1536).save(r'${dir}/portrait.png')
noisy(1536, 1024).save(r'${dir}/landscape.png')
noisy(1600, 900).save(r'${dir}/wide-enemy.png')
`]);
  const jobs = [
    { kind: 'enemy', src: `${dir}/enemy.png`, out: `${dir}/e.webp` },
    { kind: 'enemy', src: `${dir}/wide-enemy.png`, out: `${dir}/w.webp` },
    { kind: 'portrait', src: `${dir}/portrait.png`, out: `${dir}/p.webp` },
    { kind: 'landscape', src: `${dir}/landscape.png`, out: `${dir}/l.webp` },
    { kind: 'banner', src: `${dir}/landscape.png`, out: `${dir}/b.webp`, focus: [0.5, 0.55] }
  ];
  fs.writeFileSync(`${dir}/jobs.json`, JSON.stringify({ jobs }));
  const out = JSON.parse(execFileSync('python3', ['-I', path.join(ROOT, 'scripts/art_process.py'), `${dir}/jobs.json`], { encoding: 'utf8' }));
  const by = Object.fromEntries(out.map(r => [path.basename(r.out), r]));
  assert.deepEqual(by['e.webp'].trimmed, [1024, 1536], '白い余白は切り落とす');
  assert.deepEqual(by['e.webp'].size, [360, 643], '敵は幅360・既存の絵と同じくらいの縦長（2:3 は左右を少し切る）');
  assert.ok(by['w.webp'].size[0] === 360 && by['w.webp'].size[1] / 360 > 1.6, '横長の敵の絵は縦長に切り抜く');
  assert.deepEqual(by['p.webp'].size, [620, 1102], 'スマホの背景は 9:16');
  assert.deepEqual(by['l.webp'].size, [1100, 619], 'PC の背景は 16:9');
  assert.deepEqual(by['b.webp'].size, [640, 320], 'バナーは 2:1');
  const limit = { 'e.webp': 80, 'w.webp': 80, 'p.webp': 200, 'l.webp': 200, 'b.webp': 60 };
  Object.keys(limit).forEach(f => {
    assert.ok(fs.statSync(`${dir}/${f}`).size <= limit[f] * 1024, `${f} は ${limit[f]}KB 以下`);
    assert.equal(fs.readFileSync(`${dir}/${f}`).slice(8, 12).toString(), 'WEBP');
    assert.ok(by[f].ok, `${f} の結果が「目安内」`);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('画像の指示文：敵は1体ずつ・ランクで迫力を変える・文字を描かない・背景は余白なし', () => {
  const id = 'forest';
  const dir = path.join(ROOT, 'art', id);
  const existed = fs.existsSync(dir);
  const tmp = existed ? null : dir;
  try {
    execFileSync('node', [path.join(ROOT, 'scripts/dungeon-art.js'), 'prompts', id], { stdio: 'ignore' });
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'prompts.json'), 'utf8'));
    assert.deepEqual(Object.keys(p), ['floor1', 'floor2', 'floor3', 'portrait', 'landscape']);
    assert.deepEqual(['floor1', 'floor2', 'floor3'].map(k => p[k].target), ['b-goblin', 'b-boar', 'b-elder']);
    ['floor1', 'floor2', 'floor3'].forEach(k => {
      assert.match(p[k].prompt, /Exactly one creature/);
      assert.match(p[k].prompt, /watercolor/);
      assert.equal(p[k].aspect, '9:16');
    });
    assert.match(p.floor1.prompt, /small lesser monster/);
    assert.match(p.floor2.prompt, /mid-tier guardian/);
    assert.match(p.floor3.prompt, /final boss/);
    Object.values(p).forEach(x => assert.match(x.prompt, /No text, no letters, no numbers/));
    assert.match(p.portrait.prompt, /No characters/); assert.match(p.portrait.prompt, /edge to edge/);
    assert.equal(p.portrait.aspect, '9:16'); assert.equal(p.landscape.aspect, '16:9');
    assert.match(p.floor1.prompt, /moss green/, '属性（自然）の色');
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('画像の生成：鍵が無いときは何もせず、置き方を案内する', () => {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; delete env.OPENAI_API_KEY;
  const r = spawnSync('node', [path.join(ROOT, 'scripts/dungeon-art.js'), 'generate', 'forest'], { env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /GEMINI_API_KEY/);
  assert.equal(fs.existsSync(path.join(ROOT, 'art/forest/raw')), false, '何も作らない');
});
