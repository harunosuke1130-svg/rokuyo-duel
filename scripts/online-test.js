#!/usr/bin/env node
/*
 * オンライン（Firebase）機能のテストを、Firebase エミュレーター上で実行する。
 *   npm run test:online
 * 必要なもの：Java 11 以上、firebase-tools（未インストールなら npx で取得。FIREBASE_BIN で場所を指定可）
 * 本物の Firebase プロジェクトには一切接続しない（プロジェクトID demo-rikuyou はエミュレーター専用）。
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const bin = process.env.FIREBASE_BIN || 'npx --yes firebase-tools@15';
const cmd = `${bin} emulators:exec --only auth,firestore --project demo-rikuyou "node --test tests/online.test.js"`;
console.log('実行: ' + cmd);
const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
process.exit(r.status === null ? 1 : r.status);
