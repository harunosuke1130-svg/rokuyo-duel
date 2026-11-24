/*
 * 六耀の決闘 — 戦闘画面のスロット（リールと STOP ボタン・2026-11-24〜）
 * 自分の番は、1〜6 が縦に流れるリールを STOP で止める（目押し）。押した瞬間に光っていた目を aim として ui-battle → Engine（E.roll）へ渡す。
 *   出目は Engine が1回だけ決める（当たりは CONFIG.DICE_AIM.chance。ここでは抽選しない）。押したら結果が来るまでリールは押した位置で止まる。
 * 結果が来たら：リールが確定した数字へ短く送られて中央に揃い（外れでも同じ向きに数コマだけ）、その数字の面が中央に「バン」と
 *   少し大きく行き過ぎてから大きな確定表示に落ち着く。面はそのターンの間ずっと残る（押しても下には何もない帯の上）。
 * 相手・振り直しは、リールが速く回ってから確定した数字で止まる。動きを減らす設定では、移動・拡大をせずに数字をすぐ出す。
 * 部品の絵（src/img/slot/）：数字の面 n1〜n6・リールの枠 reel・判定の印 marker・STOP（通常 stop／押下 stop-press／無効 stop-off）。
 *   利用者の素材シートから切り出したもの。枠は縦横比のまま使い、伸ばさない。
 */
(function () {
  'use strict';


  /* ---------- 効果音（設定で切れる。鳴らせなくても進行は止めない） ---------- */
  const SFX_KEY = 'rikuyou.sfx';
  const sfxOn = () => { try { return localStorage.getItem(SFX_KEY) !== 'off'; } catch (e) { return true; } };
  let actx = null;
  function audio() {
    if (!sfxOn()) return null;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      if (!actx) actx = new C();
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      return actx;
    } catch (e) { return null; }
  }
  // 硬い物が木の盤に当たる短い音（強さ 0〜1）
  function knock(strength) {
    const ac = audio();
    if (!ac || ac.state !== 'running') return;
    try {
      const t = ac.currentTime, len = Math.floor(ac.sampleRate * 0.05);
      const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 + 900 * strength; bp.Q.value = 1.2;
      const g = ac.createGain(); g.gain.value = 0.22 * strength;
      src.connect(bp).connect(g).connect(ac.destination); src.start(t);
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.07);
      const og = ac.createGain(); og.gain.setValueAtTime(0.18 * strength, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(og).connect(ac.destination); o.start(t); o.stop(t + 0.1);
    } catch (e) { /* 音は飾り */ }
  }

  // 出目が決まって面が飛び出す瞬間の、短く明るい音
  function chime(big) {
    const ac = audio();
    if (!ac || ac.state !== 'running') return;
    try {
      const t = ac.currentTime;
      (big ? [[880, 0.13], [1320, 0.09], [1760, 0.07], [2640, 0.04]] : [[880, 0.12], [1320, 0.07]]).forEach(([f, v], i) => {
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const s = t + (big ? i * 0.05 : 0), len = big ? 0.42 : 0.22;
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(v, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + len);
        o.connect(g).connect(ac.destination); o.start(s); o.stop(s + len + 0.02);
      });
    } catch (e) { /* 音は飾り */ }
  }

  /* ---------- リール ---------- */
  // 上から k 番目（-1〜7）のコマの数字。位置 p（0〜6）で、p=0 は 1 が中央、p=1 は 2 が中央…（p が増えると上から次の数字が降りてくる）
  const REEL = [-1, 0, 1, 2, 3, 4, 5, 6, 7].map(k => ((((6 - k) % 6) + 6) % 6) + 1);
  const PITCH = 1.086;   // コマの間隔（コマの大きさに対して。style.css の .sl-tile の下の余白と合わせる）
  const T = { pop: 300, popBig: 430, spin: 420, stopSpin: 300, still: 160 };
  const backOut = (x, c) => { c = c || 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const easeOutCubic = x => 1 - Math.pow(1 - x, 3);
  const mod6 = v => ((v % 6) + 6) % 6;

  const D = {
    stage: null, btn: null, reel: null, win: null, strip: null, pop: null, plaque: null, sub: null,
    pos: 0,           // リールの位置（上の p）
    value: null,      // 確定表示している出目（null＝出していない）
    anim: null,       // 再生中の演出 { token, finish }
    token: 0,
    opts: null,       // { canThrow(), onThrow(null, aim) }
    aim: { t0: 0, lit: 0, locked: 0 }
  };
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function setPos(p, speed) {
    D.pos = mod6(p);
    if (!D.strip) return;
    const tile = D.strip.firstElementChild ? D.strip.firstElementChild.offsetHeight : 0;
    const H = D.win.clientHeight;
    if (!tile || !H) return;
    const pitch = tile * PITCH, k = 6 - D.pos;
    D.strip.style.transform = `translateY(${(H / 2 - ((k + 1) * pitch + tile / 2)).toFixed(1)}px)`;
    // 速く動く間だけ少しぼかす（止まっている数字はくっきり）
    D.strip.style.filter = speed > 0.012 ? `blur(${Math.min(2.2, speed * 90).toFixed(1)}px)` : '';
  }
  const centered = () => 1 + Math.round(D.pos) % 6;

  // 中央の大きな出目（そのターンの間ずっと残す）
  function showPop(n) {
    D.pop.getAnimations().forEach(a => a.cancel());
    D.pop.dataset.n = n;
    D.pop.classList.remove('glow', 'glow-big');
    D.reel.classList.add('popped');
    D.value = n;
  }
  function hidePop() {
    D.pop.getAnimations().forEach(a => a.cancel());
    D.reel.classList.remove('popped');
    D.pop.classList.remove('glow', 'glow-big');
    D.value = null;
  }
  const $value = () => document.getElementById('dice-value');

  function mount(stage) {
    D.stage = stage;
    D.btn = stage.querySelector('#btn-roll');
    D.reel = stage.querySelector('.sl-reel');
    D.win = stage.querySelector('.sl-window');
    D.strip = stage.querySelector('.sl-strip');
    D.pop = stage.querySelector('.die-pop');
    D.sub = stage.querySelector('#sl-stop-sub');
    D.strip.innerHTML = REEL.map(n => `<span class="sl-tile" data-n="${n}"></span>`).join('');
    requestAnimationFrame(aimTick);
    bindPress();
    window.addEventListener('resize', () => setPos(D.pos, 0), { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
    setPos(0, 0);
  }

  /* ---------- 公開：止まっている姿を出す ---------- */
  // at：'center'（自分の番・出目あり）| 'foe'（相手が振る番）| 'me'。value があれば中央に大きな出目
  function show(opts) {
    if (!D.stage || D.anim) return;
    const o = opts || {};
    if (o.value) {
      setPos(o.value - 1, 0);
      if (D.value !== o.value || !D.reel.classList.contains('popped')) showPop(o.value);
    } else {
      if (D.value) hidePop();
      if (!D.aim.locked) D.btn.classList.remove('pressed');
    }
    D.stage.classList.toggle('foe-turn', o.at === 'foe');
    D.btn.classList.toggle('unrolled', !o.value);
    $value().textContent = o.value ? `出目 ${o.value}` : '';
  }

  /* ---------- 公開：結果を見せる ---------- */
  // { value, from, reroll, big: 目押しが当たった, still: 動きを減らす, instant, onDone }
  function roll(opts) {
    finish();
    const value = opts.value;
    const token = ++D.token;
    let done = false;
    const callDone = () => {
      if (done) return;
      done = true;
      try { opts.onDone && opts.onDone(); } catch (e) { setTimeout(() => { throw e; }); }
    };
    const settleFinal = () => {
      if (D.anim && D.anim.token === token) D.anim = null;
      setPos(value - 1, 0);
      showPop(value);
      D.aim.locked = 0; D.aim.t0 = 0;
      D.btn.classList.remove('pressed', 'aiming');
      D.btn.classList.remove('unrolled');
      $value().textContent = `出目 ${value}`;
    };
    const endAll = () => { settleFinal(); callDone(); };
    if (!D.stage) { callDone(); return; }
    hidePop();

    // 動きを減らす：送らず・拡大せず、数字をそのまま出す（短いフェードだけ）
    if (opts.still || reducedMotion()) {
      settleFinal();
      D.anim = { token, finish: endAll };
      if (!opts.instant) D.pop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.still, easing: 'ease-out' });
      setTimeout(() => { if (D.anim && D.anim.token === token) D.anim = null; callDone(); }, opts.instant ? 0 : T.still);
      return;
    }

    // リールの動き：自分が押した（目押し）ときは押した位置から短く送るだけ。相手・振り直しは速く回してから止める
    const aimed = !!D.aim.locked && !opts.reroll;
    const p0 = D.pos;
    const target = v => { let t = v - 1; while (t < p0 - 1e-6) t += 6; return t; };
    let segs;
    if (aimed) {
      const pT = target(value);
      const d = pT - p0;
      // 当たり（ほぼ中央）は「カチッ」と揃えるだけ。外れは同じ向きに数コマ送る（長い減速はしない）
      const dur = Math.min(360, 150 + 42 * d);
      segs = [{ from: p0, to: pT, dur, ease: x => backOut(x, d < 1 ? 2.4 : 1.4) }];
    } else {
      const v = 1 / 62;   // 速く回る間：62ms で 1 コマ
      const p1 = p0 + T.spin * v;
      let pT = target(value); while (pT < p1 + 1.5) pT += 6;
      segs = [{ from: p0, to: p1, dur: T.spin, ease: x => x }, { from: p1, to: pT, dur: T.stopSpin, ease: x => backOut(x, 1.2) }];
    }
    knock(aimed ? 0.5 : 0.35);

    let raf = 0, timers = [], seg = 0, s0 = null, last = p0, lastT = 0, popped = false;
    const later = (fn, ms) => { const id = setTimeout(() => { if (token === D.token && D.anim && D.anim.token === token) fn(); }, ms); timers.push(id); };
    const stopAll = () => { cancelAnimationFrame(raf); clearTimeout(guard); timers.forEach(clearTimeout); };
    const finishNow = () => { stopAll(); endAll(); };
    D.anim = { token, finish: finishNow };
    const total = segs.reduce((a, s) => a + s.dur, 0);
    const big = !!opts.big, tPop = big ? T.popBig : T.pop;
    // 描画が止まっても（裏に回ったなど）必ず結果を出す
    const guard = setTimeout(finishNow, total + tPop + 900);

    // 中央に揃った数字の面が「バン」と大きくなる：少し行き過ぎてから確定の大きさに落ち着く（小さく戻さない）
    function popOut() {
      if (popped) return;
      popped = true;
      setPos(value - 1, 0);
      showPop(value);
      const tile = D.strip.firstElementChild.getBoundingClientRect().width, B = D.pop.getBoundingClientRect().width || 1;
      const s0 = Math.min(1, tile / B);
      D.pop.animate([
        { transform: `translate(-50%, -50%) scale(${s0.toFixed(3)})`, offset: 0, easing: 'cubic-bezier(.2, .8, .3, 1)' },
        { transform: `translate(-50%, -50%) scale(${big ? 1.24 : 1.14})`, offset: big ? 0.45 : 0.55, easing: 'cubic-bezier(.4, 0, .3, 1)' },
        ...(big ? [{ transform: 'translate(-50%, -50%) scale(.96)', offset: 0.75, easing: 'ease-in-out' }] : []),
        { transform: 'translate(-50%, -50%) scale(1)', offset: 1 }
      ], { duration: tPop, fill: 'none' });
      void D.pop.offsetWidth; D.pop.classList.add(big ? 'glow-big' : 'glow');
      chime(big);
      $value().textContent = `出目 ${value}`;
      later(() => { stopAll(); settleFinal(); callDone(); }, tPop);
    }

    function frame(now) {
      if (token !== D.token || popped) return;
      try {
        if (s0 === null) { s0 = now; lastT = now; }
        let el = now - s0;
        while (seg < segs.length && el >= segs[seg].dur) { el -= segs[seg].dur; s0 += segs[seg].dur; seg++; }
        if (seg >= segs.length) { popOut(); return; }
        const sg = segs[seg];
        const p = sg.from + (sg.to - sg.from) * sg.ease(Math.min(1, el / sg.dur));
        const speed = Math.abs(p - last) / Math.max(1, now - lastT);
        last = p; lastT = now;
        setPos(p, speed);
        raf = requestAnimationFrame(frame);
      } catch (e) { finishNow(); }
    }
    raf = requestAnimationFrame(frame);
  }

  // 再生中なら、すぐ最後の姿（中央の大きな出目）にして終える
  function finish() {
    if (D.anim) { const a = D.anim; D.anim = null; a.finish(); }
  }

  /* ---------- 目押し：振れる間はリールが 1→2→…→6→1 と流れる（1 コマ CONFIG.DICE_AIM.stepMs） ---------- */
  const aimStep = () => { const C = window.RikuyouData && window.RikuyouData.CONFIG; return (C && C.DICE_AIM && C.DICE_AIM.stepMs) || 200; };
  function aimTick() {
    requestAnimationFrame(aimTick);
    const a = D.aim;
    const can = !!(D.stage && D.opts && D.opts.canThrow());
    const on = can && !D.anim && !D.value;
    D.btn.classList.toggle('ready', can && !a.locked);
    if (!on) {
      if (a.t0 && !a.locked) { a.t0 = 0; a.lit = 0; D.btn.classList.remove('aiming'); }
      if (!can && !D.anim && a.locked && !D.btn.disabled) { /* 結果待ち（対人戦のゲスト）：押した位置のまま */ }
      return;
    }
    if (a.locked) return;   // 押した後は、押した位置のまま結果を待つ
    if (!a.t0) { a.t0 = performance.now(); D.btn.classList.add('aiming'); }
    const t = (performance.now() - a.t0) / aimStep();
    const f = t - Math.floor(t);
    a.lit = 1 + Math.floor(t) % 6;
    // 目が切り替わるたびに次の目が上から降りてきて、少し行き過ぎて止まる（止まって読める時間を長めに）。動きを減らす設定では切り替えるだけ
    const e = reducedMotion() ? 1 : f < 0.42 ? backOut(f / 0.42) : 1;
    setPos(Math.floor(t) - 1 + e, e < 1 && f < 0.3 ? 0.02 : 0);
  }
  // 押した瞬間の目で止める（ポインター・キーボード共通）。押したことがすぐ分かるよう、ボタンを沈める
  function lockAim() {
    const a = D.aim;
    D.btn.classList.add('pressed');
    if (!a.lit) return 0;
    a.locked = a.lit;
    D.lastAim = a.lit;
    D.btn.classList.remove('aiming');
    setPos(D.pos, 0);
    return a.locked;
  }
  function unlockAim() { D.aim.locked = 0; D.aim.t0 = 0; D.btn.classList.remove('pressed'); }

  /* ---------- STOP（指・マウス・ペンは押した瞬間に決める。Enter・スペースは ui-battle の click から takeAim） ---------- */
  function press() {
    if (!D.opts || D.anim || D.aim.locked || !D.opts.canThrow()) return false;
    const aim = lockAim();
    D.opts.onThrow(null, aim);
    // 送れなかった（状態が変わっていた）ときは元に戻す
    if (D.opts.canThrow() && !D.anim) unlockAim();
    return true;
  }
  function bindPress() {
    D.btn.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      if (!D.opts || !D.opts.canThrow()) return;
      e.preventDefault();
      press();
    });
    // 画面のどこかに焦点がある PC：スペースキーでも止められる（入力欄・ボタンの上ではそれぞれの動きに任せる）
    document.addEventListener('keydown', e => {
      if (e.key !== ' ' || e.repeat || !D.stage || !D.stage.offsetParent) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, button, [role="button"], a, #modal')) return;
      if (D.opts && D.opts.canThrow()) { e.preventDefault(); press(); }
    });
  }

  window.RikuyouDice = {
    mount, show, roll, finish,
    // { canThrow(): 今止めてよいか, onThrow(null, aim): 止めた（aim＝押した瞬間の目） }
    bindThrow: opts => { D.opts = opts; },
    // キーボードで止めるとき：今光っている目を狙う
    takeAim: () => lockAim(),
    cancelAim: () => unlockAim(),
    playing: () => !!D.anim,
    sfxOn,
    setSfx: on => { try { localStorage.setItem(SFX_KEY, on ? 'on' : 'off'); } catch (e) { /* 保存できなくても動く */ } },
    // テスト用
    lastThrow: () => null,
    aimed: () => D.lastAim || 0,   // 最後に押した目
    flatFace: () => {
      if (!D.reel || !D.reel.classList.contains('popped')) return null;
      const r = D.pop.getBoundingClientRect();
      return { n: Number(D.pop.dataset.n), w: r.width, h: r.height };
    },
    topFace: () => centered()
  };
})();
