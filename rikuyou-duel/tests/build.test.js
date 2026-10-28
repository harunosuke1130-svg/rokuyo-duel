// 配布用ファイルとソースの一致・外部依存のテスト
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { buildHtml, expected, SINGLE, DOCS, ARTIFACT_OUTPUT, CONFIG_DST } = require('../scripts/build.js');

test('生成物（単一HTML・docs・claude.ai 用・Firebase SDK）が src/ と一致する', () => {
  const files = expected();
  for (const f of Object.keys(files)) {
    assert.ok(fs.existsSync(f), f + ' がありません（npm run build を実行）');
    assert.equal(fs.readFileSync(f, 'utf8'), files[f], f + ' が古い（npm run build を実行）');
  }
  assert.ok(fs.existsSync(CONFIG_DST), 'docs/firebase-config.js がありません');
});

test('単一HTMLは外部ファイル・通信に依存しない（オンライン機能はこの端末保存モードで動く）', () => {
  const html = buildHtml();
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(!/<link[^>]+href=/i.test(html));
  // 'http://' + host はエミュレーター接続用の組み立て（Firebase モード専用）なので、実際のホスト名だけを探す
  assert.ok(!/https?:\/\/[a-z0-9]/i.test(html), 'http(s) の URL が含まれている');
  assert.ok(!/@import|url\(/i.test(html), 'CSS の外部参照がある');
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(html), '通信処理がある');
});

test('docs は同じサイト内の設定ファイルと SDK だけを読み込む（CDN なし）', () => {
  const docs = fs.readFileSync(DOCS, 'utf8');
  const srcs = [...docs.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(srcs, ['firebase-config.js']);
  assert.ok(!/(gstatic|googleapis|cdn\.)/.test(docs));
  const art = fs.readFileSync(ARTIFACT_OUTPUT, 'utf8');
  assert.ok(!/<html|<body|<!DOCTYPE/i.test(art));
  assert.ok(art.indexOf('<title>六耀の決闘</title>') < 8000);
  assert.ok(fs.readFileSync(SINGLE, 'utf8').length > 10000);
});
