#!/usr/bin/env node
/*
 * 開発用ソース（src/）から配布用ファイルを作る。
 *   node scripts/build.js          → 生成
 *   node scripts/build.js --check  → 生成物がソースと一致しているか確認（不一致なら終了コード1）
 *
 * 生成物：
 *   dist/rikuyou-duel.html          ファイルを開くだけで遊べる単一HTML（この端末に保存・オフライン）
 *   docs/index.html                 GitHub Pages 用。docs/firebase-config.js があればオンライン（Firebase）で動く
 *   docs/vendor/firebase/*          Firebase SDK（同じサイトから読み込む。CDN は使わない）
 *   docs/firebase-config.js         初回だけ雛形をコピー（以後は上書きしない＝設定を消さない）
 *   dist/artifact/rikuyou-duel.html claude.ai 公開用（本文のみ・この端末に保存）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SINGLE = path.join(ROOT, 'dist', 'rikuyou-duel.html');
const DOCS = path.join(ROOT, 'docs', 'index.html');
const ARTIFACT_OUTPUT = path.join(ROOT, 'dist', 'artifact', 'rikuyou-duel.html');
const VENDOR_SRC = path.join(ROOT, 'vendor', 'firebase');
const VENDOR_DST = path.join(ROOT, 'docs', 'vendor', 'firebase');
const CONFIG_EXAMPLE = path.join(ROOT, 'config', 'firebase-config.example.js');
const CONFIG_DST = path.join(ROOT, 'docs', 'firebase-config.js');
const OUTPUTS = [SINGLE]; // 単一HTML（ソースと完全一致を確認する対象）

function read(name) {
  return fs.readFileSync(path.join(SRC, name), 'utf8');
}

function buildHtml() {
  let html = read('index.html');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, file) => {
    const css = read(file);
    if (/<\/style/i.test(css)) throw new Error(file + ' に </style が含まれています');
    return '<style>\n' + css + '</style>';
  });
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, file) => {
    const js = read(file);
    if (/<\/script/i.test(js)) throw new Error(file + ' に </script が含まれています');
    return '<script>\n/* ---- ' + file + ' ---- */\n' + js + '</script>';
  });
  if (/<(link|script)[^>]+(href|src)=/i.test(html)) throw new Error('外部ファイルへの参照が残っています');
  return html;
}

// GitHub Pages 用：設定ファイルを最初に読み込む（無ければこの端末保存モード）
function buildDocsHtml(html) {
  const tag = '<script src="firebase-config.js"></script>\n';
  const i = html.indexOf('<script>');
  return html.slice(0, i) + tag + html.slice(i);
}

function buildArtifactHtml(html) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset="UTF-8">\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  return head.trim() + '\n' + body.trim() + '\n';
}

function expected() {
  const html = buildHtml();
  const files = {};
  files[SINGLE] = html;
  files[DOCS] = buildDocsHtml(html);
  files[ARTIFACT_OUTPUT] = buildArtifactHtml(html);
  fs.readdirSync(VENDOR_SRC).forEach(f => { files[path.join(VENDOR_DST, f)] = fs.readFileSync(path.join(VENDOR_SRC, f), 'utf8'); });
  return files;
}

if (require.main === module) {
  const files = expected();
  if (process.argv.includes('--check')) {
    const stale = Object.keys(files).filter(f => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== files[f]);
    if (!fs.existsSync(CONFIG_DST)) stale.push(CONFIG_DST + '（設定の雛形がありません）');
    if (stale.length) {
      console.error('生成物がソースと一致しません。npm run build を実行してください:\n  ' + stale.map(f => path.relative(ROOT, f)).join('\n  '));
      process.exit(1);
    }
    console.log('生成物はソースと一致しています');
  } else {
    for (const f of Object.keys(files)) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, files[f]);
    }
    console.log('生成: ' + path.relative(ROOT, SINGLE) + ' / ' + path.relative(ROOT, DOCS) + ' / ' + path.relative(ROOT, ARTIFACT_OUTPUT) + ' / docs/vendor/firebase');
    if (!fs.existsSync(CONFIG_DST)) {
      fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_DST);
      console.log('作成: docs/firebase-config.js（雛形。Firebase の値を入れるとオンラインで動きます）');
    } else console.log('docs/firebase-config.js は既存のため変更していません');
  }
}

module.exports = { buildHtml, buildDocsHtml, buildArtifactHtml, expected, OUTPUTS, SINGLE, DOCS, ARTIFACT_OUTPUT, CONFIG_DST };
