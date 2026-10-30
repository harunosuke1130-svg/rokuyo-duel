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
    : { roll: 560, cpuThink: 750, after: 1000, replace: 900, result: 900, fxGap: 120, initiative: 1600 };
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
  // ランク（★の数）。ボスは出さない
  function starsHtml(ch) {
    const n = E.starsOf(ch.id);
    return n ? `<span class="stars" data-stars="${n}" aria-label="★${n}" title="ランク★${n}">${'★'.repeat(n)}</span>` : '';
  }
  // カードの枠：属性ごとの基本色（data-el）× ランクごとの濃さ（data-stars）。style.css の .el-frame
  function frameAttrs(ch) {
    return `data-el="${esc(ch.element)}" data-stars="${E.starsOf(ch.id) || 0}"`;
  }
  // 石のアイコン
  function gemIcon(cls) {
    return `<svg class="gem${cls ? ' ' + cls : ''}" viewBox="0 0 20 28" aria-hidden="true"><path d="M10 1l8 9-8 17-8-17z" fill="#3f6fe0"/><path d="M10 1l8 9h-8z" fill="#9cc4ff"/><path d="M10 1L2 10h8z" fill="#6c9cf5"/><path d="M2 10h8v17z" fill="#2a4fb8"/><path d="M10 10h8l-8 17z" fill="#5585ec"/><path d="M10 1l8 9-8 17-8-17z" fill="none" stroke="#dbe8ff" stroke-width=".8" stroke-linejoin="round"/></svg>`;
  }
  function elementTag(ch) {
    const el = ELEMENTS[ch.element] || { name: ch.element, color: '#888' };
    return `<span class="el-tag" style="--el:${el.color}"><span class="el-ico" data-el="${esc(ch.element)}" aria-hidden="true"></span>${esc(el.name)}</span>`;
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

  /* ---------- カードのドラッグ（Pointer Events。HTML標準のドラッグ＆ドロップは使わない） ----------
   * マウスは少し動かしたら、タッチは長押ししてから持ち上げる（長押し前に動いたらスクロールとして扱う）。
   * o: { selector, ghostClass, canStart(card) → 理由の文字列（動かせないとき）| null,
   *      canDrop(card, target) → bool, onDrop(card, target), enabled() → bool,
   *      immediate() → true のあいだはタッチも長押しなしで動かし始める, ignore: ここから押した時はドラッグしない,
   *      holdSelector / onHold(card)：長押しして動かさずに離したとき（技の表示など） }
   * 戻り値：suppressed()（ドラッグ直後のクリックを無視する）, busy(), destroy() */
  const DRAG_HOLD_MS = 320, DRAG_SLOP = 8;
  // 「視差効果を減らす」設定（演出の動きを抑える）
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function cardDrag(root, o) {
    // holdSelector：長押し（動かさずに離す）で onHold を呼ぶカード。ドラッグできないカード（敵など）も含められる
    const holdSel = o.holdSelector || o.selector;
    let drag = null, suppressUntil = 0;
    const onContext = e => { if (e.target.closest(holdSel)) e.preventDefault(); };
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('contextmenu', onContext);
    function onDown(e) {
      const c = e.target.closest(holdSel);
      if (!c || !root.contains(c) || drag || (e.pointerType === 'mouse' && e.button !== 0) || (o.enabled && !o.enabled())) return;
      if (o.ignore && e.target.closest(o.ignore)) return; // 技のボタンなどからはドラッグを始めない
      drag = { card: c, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        draggable: c.matches(o.selector), held: false, hx: 0, hy: 0, blocked: null,
        touch: e.pointerType !== 'mouse' && !(o.immediate && o.immediate()), active: false, timer: null, ghost: null, target: null, dx: 0, dy: 0 };
      drag.timer = setTimeout(onHoldTimer, DRAG_HOLD_MS);
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('touchmove', blockScroll, { passive: false });
    }
    function blockScroll(e) { if (drag && (drag.active || drag.held)) e.preventDefault(); }
    // 長押しになった：タッチでドラッグできるカードは持ち上げる。それ以外は「長押し中」の印だけ
    function onHoldTimer() {
      const d = drag;
      if (!d || d.active) return;
      d.held = true; d.hx = d.x; d.hy = d.y;
      suppressUntil = Infinity;
      d.card.classList.add('holding');
      if (d.touch && navigator.vibrate) navigator.vibrate(12);
      if (d.touch && d.draggable) {
        d.blocked = o.canStart ? o.canStart(d.card) : null;
        if (!d.blocked) begin();
      }
    }
    function begin() {
      if (!drag || drag.active) return;
      if (!drag.draggable) return;
      const reason = drag.blocked || (o.canStart ? o.canStart(drag.card) : null);
      if (reason) { end(false); suppressUntil = Date.now() + 400; toast(reason); return; }
      drag.active = true;
      suppressUntil = Infinity;
      const r = drag.card.getBoundingClientRect();
      drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
      const g = drag.card.cloneNode(true);
      g.classList.add('drag-ghost');
      g.classList.remove('holding');
      if (o.ghostClass) g.classList.add(o.ghostClass);
      g.removeAttribute('data-idx');
      g.removeAttribute('id');
      g.style.width = r.width + 'px';
      document.body.appendChild(g);
      drag.ghost = g;
      drag.card.classList.add('dragging');
      // 交換できる相手に印を付ける（離してよい場所が一目で分かるように）
      drag.cands = Array.from(root.querySelectorAll(o.selector)).filter(t => t !== drag.card && o.canDrop(drag.card, t));
      drag.cands.forEach(t => t.classList.add('drop-candidate'));
      try { drag.card.setPointerCapture(drag.id); } catch (err) { /* 取れなくても window で追う */ }
      place();
    }
    function place() {
      const d = drag;
      d.ghost.style.transform = `translate(${d.x - d.dx}px, ${d.y - d.dy}px) scale(1.06) rotate(-2deg)`;
      const el = document.elementFromPoint(d.x, d.y);
      const t = el && el.closest(o.selector);
      const ok = t && root.contains(t) && t !== d.card && o.canDrop(d.card, t) ? t : null;
      if (d.target && d.target !== ok) d.target.classList.remove('drop-target');
      if (ok) ok.classList.add('drop-target');
      d.target = ok;
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.x = e.clientX; drag.y = e.clientY;
      const far = Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > DRAG_SLOP;
      if (!drag.active) {
        if (!far) return;
        if (drag.touch && !drag.held) { end(false); return; } // 長押しの前に動いた＝スクロール
        if (!drag.draggable) { if (!drag.held) end(false); return; }
        begin();
        if (!drag) return;
      }
      e.preventDefault();
      place();
    }
    function onUp(e) { if (drag && e.pointerId === drag.id) end(true); }
    function onCancel(e) { if (drag && e.pointerId === drag.id) end(false); }
    // 交換先の上で離したときだけ onDrop。長押しして動かさずに離したら onHold。それ以外は何もしない＝元の位置のまま
    function end(drop) {
      const d = drag;
      if (!d) return;
      drag = null;
      clearTimeout(d.timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', blockScroll);
      d.card.classList.remove('holding');
      if (!d.active && !d.held) return;
      suppressUntil = Date.now() + 400;
      if (d.cands) d.cands.forEach(t => t.classList.remove('drop-candidate'));
      const dropped = drop && d.target;
      if (d.ghost) {
        // 有効な位置で離した：影は消して本物のカードが入れ替わる。無効な位置：影が元の位置へ戻る
        const g = d.ghost, home = d.card.getBoundingClientRect();
        if (dropped || reducedMotion() || !home.width) g.remove();
        else {
          g.classList.add('returning');
          g.style.transform = `translate(${home.left}px, ${home.top}px)`;
          setTimeout(() => g.remove(), 240);
        }
      }
      d.card.classList.remove('dragging');
      if (d.target) d.target.classList.remove('drop-target');
      const still = Math.hypot(d.x - (d.held ? d.hx : d.x0), d.y - (d.held ? d.hy : d.y0)) <= DRAG_SLOP * 2;
      if (drop && d.target) o.onDrop(d.card, d.target);
      else if (drop && d.held && still && o.onHold) o.onHold(d.card);
    }
    return {
      suppressed: () => Date.now() < suppressUntil,
      busy: () => !!drag,
      destroy() { end(false); root.removeEventListener('pointerdown', onDown); root.removeEventListener('contextmenu', onContext); }
    };
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(el => el.classList.toggle('hidden', el.id !== 'screen-' + name));
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
    if (ui.onScreen) ui.onScreen(name);
  }

  window.RikuyouUI = {
    E, CONFIG, FAST, DELAY, rng, $, esc, reducedMotion,
    emblem, elMark, portrait, gemIcon, starsHtml, frameAttrs, elementTag, subTags, hpBar, hpText, levelTag, moveEffText, movesList, leaderBox,
    ui, openModal, closeModal, tapGuarded, toast, bindModalBasics, showScreen, cardDrag
  };
})();
