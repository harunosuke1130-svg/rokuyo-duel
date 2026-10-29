/*
 * 六耀の決闘 — 画面の共通部品（表示用の小さな関数・モーダル・トースト）
 * window.RikuyouUI に入れて、ui-battle.js / ui-app.js から使う。
 */
(function () {
  'use strict';

  const E = window.RikuyouEngine;
  const { CONFIG, ELEMENTS } = E;

  const params = new URLSearchParams(location.search);
  const FAST = params.has('fast');
  const DELAY = FAST
    ? { roll: 40, cpuThink: 30, after: 40, replace: 30, result: 30, fxGap: 0, initiative: 60 }
    : { roll: 650, cpuThink: 750, after: 1000, replace: 900, result: 1000, fxGap: 120, initiative: 1600 };
  const rng = E.createRng(params.get('seed'));

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 表示用の部品 ---------- */
  function emblem(ch, unit, size) {
    const el = ELEMENTS[ch.element] || { color: '#888' };
    const ko = unit && unit.hp <= 0 ? ' ko' : '';
    return `<span class="emblem${size ? ' ' + size : ''}${ko}" data-char="${esc(ch.id)}" style="--el:${el.color}" aria-hidden="true">${esc(ch.glyph)}</span>`;
  }
  // 属性マーク（画像があればビルドで src/img/element/<属性>.* が背景に入る。無ければ属性名の1文字目）
  const EL_GLYPH = { fire: '火', water: '水', nature: '森', holy: '光', dark: '闇' };
  function elMark(ch) {
    const el = ELEMENTS[ch.element] || { name: ch.element, color: '#888' };
    return `<span class="el-mark" data-el="${esc(ch.element)}" style="--el:${el.color}" title="${esc(el.name)}"><i>${esc(EL_GLYPH[ch.element] || el.name.charAt(0))}</i></span>`;
  }
  // キャラの絵（画像があればビルドで src/img/chara/<キャラID>.* が背景に入る。無ければ紋章の文字）
  function portrait(ch, opts) {
    const o = opts || {};
    const el = ELEMENTS[ch.element] || { color: '#888' };
    return `<span class="portrait${o.dim ? ' dim' : ''}${o.zoom ? ' zoom' : ''}" data-char="${esc(ch.id)}" style="--el:${el.color}" aria-hidden="true"><i>${esc(ch.glyph)}</i></span>`;
  }
  // 石のアイコン
  function gemIcon(cls) {
    return `<svg class="gem${cls ? ' ' + cls : ''}" viewBox="0 0 20 28" aria-hidden="true"><path d="M10 1l8 9-8 17-8-17z" fill="#3f6fe0"/><path d="M10 1l8 9h-8z" fill="#9cc4ff"/><path d="M10 1L2 10h8z" fill="#6c9cf5"/><path d="M2 10h8v17z" fill="#2a4fb8"/><path d="M10 10h8l-8 17z" fill="#5585ec"/><path d="M10 1l8 9-8 17-8-17z" fill="none" stroke="#dbe8ff" stroke-width=".8" stroke-linejoin="round"/></svg>`;
  }
  function elementTag(ch) {
    const el = ELEMENTS[ch.element] || { name: ch.element, color: '#888' };
    return `<span class="el-tag" style="--el:${el.color}">${esc(el.name)}</span>`;
  }
  function subTags(ch) {
    return (ch.subTypes || []).map(t => `<span class="sub-tag">${esc(t)}</span>`).join('');
  }
  function hpBar(unit) {
    const r = unit.hp / unit.maxHp;
    const cls = r <= 0.25 ? ' low' : r <= 0.5 ? ' mid' : '';
    return `<div class="hpbar${cls}"><i style="width:${Math.max(0, r * 100)}%"></i></div>`;
  }
  function hpText(unit) {
    return `<span class="hptext">HP <b>${unit.hp}</b> / ${unit.maxHp}</span>`;
  }
  const levelTag = lv => `<span class="lv-tag">Lv${lv}</span>`;
  function moveEffText(m) {
    const parts = [];
    if (m.atk > 0) parts.push('攻' + m.atk);
    if (m.heal > 0) parts.push('回' + m.heal);
    return parts.length ? parts.join('+') : '—';
  }
  // loadout の順（出目1〜6）で技を並べる
  function movesList(ch, hitDice, loadout) {
    const lo = loadout || E.defaultLoadout(ch.id);
    return `<ul class="moves${hitDice ? ' dim' : ''}">` + lo.map((k, d) => {
      const m = ch.moves[k];
      return `<li class="${hitDice === d + 1 ? 'hit' : ''}"><span class="num">${d + 1}</span><span>${esc(m.name)}</span><span class="eff">${moveEffText(m)}</span></li>`;
    }).join('') + '</ul>';
  }
  function leaderBox(ch, note) {
    const ls = ch.leaderSkill;
    return `<div class="effect-box leader-box"><b>リーダースキル「${esc(ls.name)}」</b>${note ? ` <span class="badge leader">${esc(note)}</span>` : ''}<br><span class="muted">${esc(ls.text)}</span></div>`;
  }

  /* ---------- モーダル ---------- */
  const ui = { modal: null, ignoreTapsUntil: 0, onModalClose: null };
  function openModal(html, opts) {
    opts = opts || {};
    ui.modal = { closable: opts.closable !== false, refresh: opts.refresh || null, kind: opts.kind || '', onClose: opts.onClose || null };
    $('#modal-body').innerHTML = html;
    $('#modal-x').classList.toggle('hidden', !ui.modal.closable);
    $('#modal').classList.remove('hidden');
    $('#modal').dataset.kind = ui.modal.kind;
    $('#modal .modal-box').scrollTop = 0;
    if (opts.bind) opts.bind($('#modal-body'));
  }
  function closeModal(force) {
    if (!ui.modal) { $('#modal').classList.add('hidden'); return; }
    if (!force && !ui.modal.closable) return;
    const cb = ui.modal.onClose;
    ui.modal = null;
    // 確定ボタンの連打が、閉じた後の下のボタンに当たらないようにする
    ui.ignoreTapsUntil = Date.now() + 450;
    $('#modal').classList.add('hidden');
    $('#modal').dataset.kind = '';
    $('#modal-body').innerHTML = '';
    if (cb) cb();
    if (ui.onModalClose) ui.onModalClose();
  }
  const tapGuarded = () => Date.now() < ui.ignoreTapsUntil;

  let toastTimer = null;
  function toast(msg, kind) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = kind === 'ok' ? 'ok' : '';
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2400);
  }

  function bindModalBasics() {
    $('#modal').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
    $('#modal-x').addEventListener('click', () => closeModal());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.unit-card, .pick-card')) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(el => el.classList.toggle('hidden', el.id !== 'screen-' + name));
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
    if (ui.onScreen) ui.onScreen(name);
  }

  window.RikuyouUI = {
    E, CONFIG, FAST, DELAY, rng, $, esc,
    emblem, elMark, portrait, gemIcon, elementTag, subTags, hpBar, hpText, levelTag, moveEffText, movesList, leaderBox,
    ui, openModal, closeModal, tapGuarded, toast, bindModalBasics, showScreen
  };
})();
