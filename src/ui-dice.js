/*
 * 六耀の決闘 — 戦闘画面の立体サイコロ（操作と見た目）
 * 操作：サイコロを指／マウスでつかんで動かし、離すと投げる（スワイプ・フリック）。速さ・距離・向きを「投げ方」として
 *   ui-battle → Engine（E.roll）へ渡す。出目は Engine が投げ方と乱数から1回だけ決める（ここでは抽選しない）。
 *   タップ・クリック・キーボードは標準の投げ方。小さな指のぶれは投げたことにしない。取り消したドラッグでは振らない。
 * 見た目：決まった出目を「投げて、跳ねて、転がって止まる」演出で見せ、止まった上の面を平らな正方形にして「バンッ」と拡大し、
 *   少し見せてから盤面の中央の小さな出目表示へ縮める（軌道のゆらぎは Math.random。ゲームの乱数は使わない）。
 *
 * 盤面（.bt-stage）の上に、6面の立方体（.die-body）と接地影（.die-shadow）を置く。
 *   座標：盤面の平面が x・y、盤面から浮く高さが z（カメラ側が +z）。カメラは固定で、盤面を少し手前に傾けて見下ろす。
 *   面の配置：1=+z 6=-z、2=+x 5=-x、3=-y 4=+y（向かい合う面の和は7）。
 *   姿勢は四元数で計算し、最後に必ず「出目の面が真上」の姿勢へ連続的に収まる（最後に面を差し替えない）。
 */
(function () {
  'use strict';

  const TILT = 17;                 // 盤面の傾き（度）。上の面と手前の側面が見える
  const COS_T = Math.cos(TILT * Math.PI / 180);
  // 置き場所（盤面の幅・高さに対する割合）。me＝自分が投げる位置（手前）、foe＝相手が投げる位置（奥）、center＝止まる位置
  // サイコロは戦闘画面全体（.dice-layer）を動くが、待つ場所と出目を大きく出す場所（center）は盤面の帯で決める
  const ANCHORS = {
    narrow: { me: [0.13, 0.72], center: [0.5, 0.5], foe: [0.5, 0.24] },
    wide: { me: [0.08, 0.74], center: [0.5, 0.5], foe: [0.92, 0.26] }
  };
  // 時間（ms）：タップのときの溜め・止まった面を見せる・拡大（行き過ぎて戻る）・大きく見せる・縮める
  const T = { pre: 90, hold: 100, pop: 290 };
  // 投げ方の判定
  const SWIPE_MIN = 12;        // これより小さい動きは指のぶれ（タップ扱い）
  const STD_POWER = 0.55;      // タップ・キーボード・相手の投げ方が分からないときの勢い

  /* ---------- 四元数（回転の向きは CSS の rotate3d と同じ） ---------- */
  const qAxis = (x, y, z, deg) => {
    const l = Math.hypot(x, y, z) || 1, h = deg * Math.PI / 360, s = Math.sin(h);
    return [Math.cos(h), x / l * s, y / l * s, z / l * s];
  };
  const qMul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ];
  const qInv = q => [q[0], -q[1], -q[2], -q[3]];
  function qSlerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map(v => -v); d = -d; }
    if (d > 0.9995) { const r = a.map((v, i) => v + (b[i] - v) * t); const l = Math.hypot(...r); return r.map(v => v / l); }
    const th = Math.acos(d), s = Math.sin(th);
    const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((v, i) => v * wa + b[i] * wb);
  }
  function qMat(q) {
    const [w, x, y, z] = q;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
      2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
      2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)
    ];
  }
  // 盤面の上の立方体：底がちょうど盤面に触れる高さ（角や辺で立つと中心が上がる）＋ 浮いている高さ z
  function bodyTransform(q, x, y, z, half) {
    const m = qMat(q);
    const lift = half * (Math.abs(m[6]) + Math.abs(m[7]) + Math.abs(m[8]));
    const f = v => (Math.abs(v) < 1e-6 ? 0 : +v.toFixed(5));
    return `matrix3d(${f(m[0])},${f(m[3])},${f(m[6])},0,${f(m[1])},${f(m[4])},${f(m[7])},0,${f(m[2])},${f(m[5])},${f(m[8])},0,${f(x)},${f(y)},${f(z + lift)},1)`;
  }
  // 出目 n の面を真上（+z）に向ける姿勢
  const BASE = {
    1: [1, 0, 0, 0], 6: qAxis(0, 1, 0, 180), 2: qAxis(0, 1, 0, -90),
    5: qAxis(0, 1, 0, 90), 3: qAxis(1, 0, 0, -90), 4: qAxis(1, 0, 0, 90)
  };
  const restQ = (n, yaw) => qMul(qAxis(0, 0, 1, yaw), BASE[n] || BASE[1]);

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
  function chime() {
    const ac = audio();
    if (!ac || ac.state !== 'running') return;
    try {
      const t = ac.currentTime;
      [[880, 0.12], [1320, 0.07]].forEach(([f, v]) => {
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.24);
      });
    } catch (e) { /* 音は飾り */ }
  }

  /* ---------- 部品 ---------- */
  const D = {
    stage: null, layer: null, btn: null, body: null, shadow: null, fx: null, pop: null, faces: {},
    pose: { at: 'center', value: 1, q: restQ(1, 0) },
    anim: null,       // 再生中の演出 { token, finish }
    token: 0,
    drag: null,       // つかんでいる最中の情報
    release: null,    // 投げた（指を離した）位置 { x, y, t }。結果が来たらそこから飛ぶ
    opts: null,       // { canThrow(), onThrow(throwInput|null, aim) }
    aim: { el: null, t0: 0, lit: 0, locked: 0, timer: 0 }   // 目押し：1→6 と順に光る目（押した瞬間の目を狙う）
  };
  const cssPx = (name, def) => (D.layer ? parseFloat(getComputedStyle(D.layer).getPropertyValue(name)) || def : def);
  const size = () => cssPx('--die', 44);
  const popSize = () => cssPx('--pop', 104);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function mount(stage) {
    D.stage = stage;
    // サイコロの層：戦闘画面全体に重ね、カードより手前に描く（つかむ・投げる・転がるはこの層の上）
    D.layer = document.createElement('div');
    D.layer.className = 'dice-layer';
    D.layer.id = 'dice-layer';
    (stage.closest('.bt-layout') || stage.parentNode).appendChild(D.layer);
    D.btn = stage.querySelector('#btn-roll');
    D.layer.appendChild(D.btn);
    D.btn.innerHTML = `<span class="die-cam"><span class="die-world">
        <span class="die-shadow" aria-hidden="true"></span>
        <span class="die-fx" aria-hidden="true"></span>
        <span class="die-body" id="dice" aria-hidden="true">${[1, 2, 3, 4, 5, 6].map(n => `<span class="die-face" data-n="${n}"></span>`).join('')}
          <span class="die-core x"></span><span class="die-core y"></span><span class="die-core z"></span></span>
      </span></span><span class="sr-only" id="dice-value" aria-live="polite"></span>`;
    const cap = stage.querySelector('#roll-cap');
    if (cap) D.btn.appendChild(cap);   // 案内はサイコロについて動く
    D.pop = document.createElement('span');
    D.pop.className = 'die-pop';
    D.pop.setAttribute('aria-hidden', 'true');
    D.layer.appendChild(D.pop);
    D.body = D.btn.querySelector('.die-body');
    D.shadow = D.btn.querySelector('.die-shadow');
    D.fx = D.btn.querySelector('.die-fx');
    D.body.querySelectorAll('.die-face').forEach(f => { D.faces[f.dataset.n] = f; });
    // 目押しの目（サイコロの上に 1〜6 が並び、順に光る）
    D.aim.el = document.createElement('span');
    D.aim.el.className = 'die-aim';
    D.aim.el.setAttribute('aria-hidden', 'true');
    D.aim.el.innerHTML = [1, 2, 3, 4, 5, 6].map(n => `<i data-n="${n}">${n}</i>`).join('');
    D.btn.appendChild(D.aim.el);
    D.aim.timer = setInterval(aimTick, 40);
    bindPointer();
    window.addEventListener('resize', () => { cancelDrag(); finish(); place(D.pose.at, false); if (D.layer.classList.contains('flat')) bigFace(D.pose.value); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelDrag(); finish(); } });
    place('center', false);
    draw(D.pose.q, 0, 0, 0);
  }

  // 座標はすべてサイコロの層の左上から（px）
  const isWide = () => !!(window.matchMedia && window.matchMedia('(min-width: 960px) and (orientation: landscape)').matches);
  function anchor(at) {
    const r = D.stage.getBoundingClientRect(), l = D.layer.getBoundingClientRect();
    // PC の横長レイアウト（文字は右の欄）だけ広い置き方。スマホは横にしても右側に文字が重なるので狭い置き方
    const a = ANCHORS[isWide() ? 'wide' : 'narrow'][at] || ANCHORS.narrow.center;
    return [r.left - l.left + r.width * a[0], r.top - l.top + r.height * a[1]];
  }
  // 画面に見えている範囲（層の座標）。サイコロはこの中を動き、端で跳ね返る
  function bounds(margin) {
    const l = D.layer.getBoundingClientRect();
    const m = margin || 0;
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const minX = Math.max(0, -l.left) + m, maxX = Math.min(l.width, vw - l.left) - m;
    const minY = Math.max(0, -l.top) + m, maxY = Math.min(l.height, vh - l.top) - m;
    return { minX, maxX: Math.max(minX, maxX), minY, maxY: Math.max(minY, maxY) };
  }
  function placeXY(x, y, glide) {
    D.btn.classList.toggle('glide', !!glide);
    D.btn.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
  function place(at, glide) {
    if (!D.stage) return;
    D.pose.at = at;
    const [x, y] = anchor(at);
    placeXY(x, y, glide);
  }
  // ox, oy：置き場所からのずれ（画面上の px）。z：盤面からの高さ
  function draw(q, ox, oy, z) {
    const half = size() / 2;
    const wy = oy / COS_T;
    D.body.style.transform = bodyTransform(q, ox, wy, z, half);
    const k = Math.min(1, z / (half * 3.4));
    // 光は左上から：影は少し右下へ。浮くほど離れて大きく薄く、接地で寄って小さく濃く
    const off = 5 + k * half * 0.8;
    D.shadow.style.transform = `translate3d(${(ox + off * 0.7).toFixed(1)}px, ${(wy + off).toFixed(1)}px, 0) scale(${(0.92 + k * 0.55).toFixed(3)})`;
    D.shadow.style.opacity = (0.95 - k * 0.7).toFixed(3);
  }
  function sparks(ox, oy, strength) {
    if (!D.fx) return;
    const n = strength > 0.7 ? 7 : strength > 0.4 ? 4 : 2;
    const wy = oy / COS_T;
    let html = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const r = (14 + Math.random() * 12) * (0.6 + strength * 0.6);
      html += `<i style="left:${ox.toFixed(1)}px;top:${wy.toFixed(1)}px;--dx:${(Math.cos(a) * r).toFixed(1)}px;--dy:${(Math.sin(a) * r).toFixed(1)}px;--o:${(0.45 + strength * 0.5).toFixed(2)}"></i>`;
    }
    const box = document.createElement('span');
    box.className = 'die-sparks';
    box.innerHTML = html;
    D.fx.appendChild(box);
    setTimeout(() => box.remove(), 520);
  }

  /* ---------- 平らな出目（立体の上の面を、画面と平行な正方形にしたもの） ---------- */
  // 立体を隠して平らな面だけを出す（2つが同時に残らない）
  function setFlat(on) { D.layer.classList.toggle('flat', !!on); }
  const popTf = (dx, dy, persp, rx, rz, sc) => `translate(-50%, -50%) translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) perspective(${persp}px) rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
  // 盤面の中央に、大きな平らな出目を置く（そのターンの間ずっと見える。押しても下のカード・技に届く）
  function bigFace(n) {
    const [x, y] = anchor('center'), S = popSize();
    D.pop.getAnimations().forEach(a => a.cancel());
    D.pop.dataset.n = n;
    D.pop.classList.remove('glow');
    Object.assign(D.pop.style, { left: x.toFixed(1) + 'px', top: y.toFixed(1) + 'px', width: S + 'px', height: S + 'px', transform: 'translate(-50%, -50%)' });
    setFlat(true);
  }

  /* ---------- 公開：止まっている姿を出す ---------- */
  // at：'me' | 'foe' | 'center'。value があれば出目（中央では平らな出目）。value が null なら今の面のまま（まだ振っていない）
  function show(opts) {
    if (!D.stage || D.drag) return;
    const o = opts || {};
    if (D.anim) return;
    if (o.value && o.value !== D.pose.value) { D.pose.value = o.value; D.pose.q = restQ(o.value, 0); }
    if (o.at === 'center' && o.value) {
      place('center', false);
      draw(D.pose.q, 0, 0, 0);
      // 描き直しのたびに盤面の中央へ置き直す（画面の並びが変わってもずれない。グローの演出は消さない）
      if (!D.layer.classList.contains('flat') || D.pop.dataset.n !== String(o.value)) bigFace(o.value);
      else { const [x, y] = anchor('center'); D.pop.style.left = x.toFixed(1) + 'px'; D.pop.style.top = y.toFixed(1) + 'px'; }
    } else {
      setFlat(false);
      // 投げて結果を待っている間（対人戦のゲスト）は、離した場所に置いたまま
      const waitingThrow = o.at === 'me' && D.release && Date.now() - D.release.t < 5000;
      if (waitingThrow) D.pose.at = 'me';
      else { if (o.at !== 'me') D.release = null; place(o.at, !!o.glide); }
      draw(D.pose.q, 0, 0, 0);
    }
    D.btn.classList.toggle('unrolled', !o.value);
    $value().textContent = o.value ? `出目 ${o.value}` : '';
  }
  const $value = () => D.btn.querySelector('#dice-value');

  /* ---------- 公開：投げる ---------- */
  // { value, from: 'me'|'foe'|'center', throw: { power, angle, dist }（無ければ標準）, tap: タップで振った, still: 動きを減らす, instant, onDone }
  function roll(opts) {
    cancelDrag();
    finish();
    const value = opts.value;
    const token = ++D.token;
    const yaw = (Math.random() * 2 - 1) * 12;
    const qEnd = restQ(value, yaw);
    let done = false;
    const callDone = () => {
      if (done) return;
      done = true;
      try { opts.onDone && opts.onDone(); } catch (e) { setTimeout(() => { throw e; }); }
    };
    // 最後の姿：盤面の中央に大きな平らな出目（立体は隠れる）
    const settleFinal = () => {
      if (D.anim && D.anim.token === token) D.anim = null;
      D.btn.classList.remove('throwing');
      D.pose.value = value; D.pose.q = qEnd; D.release = null;
      place('center', false);
      draw(qEnd, 0, 0, 0);
      bigFace(value);
      D.btn.classList.remove('unrolled');
      $value().textContent = `出目 ${value}`;
    };
    const endAll = () => { settleFinal(); callDone(); };
    if (!D.stage) { callDone(); return; }

    // 動きを減らす：転がり・急な拡大はせず、平らな出目を短いフェードで出す
    if (opts.still) {
      D.anim = { token, finish: endAll };
      settleFinal();
      D.anim = { token, finish: endAll };
      if (!opts.instant) D.pop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      setTimeout(() => { if (D.anim && D.anim.token === token) D.anim = null; callDone(); }, opts.instant ? 0 : 200);
      return;
    }

    const S = size(), half = S / 2;
    const t = opts.throw || null;
    const power = clamp(t && Number.isFinite(t.power) ? t.power : STD_POWER + (opts.tap ? 0 : (Math.random() - 0.5) * 0.3), 0.1, 1);
    const from = opts.from === 'foe' ? 'foe' : opts.from === 'center' ? 'center' : 'me';
    setFlat(false);
    D.pop.getAnimations().forEach(a => a.cancel());
    // 投げ始め：指を離した場所（最近のものだけ）か、置き場所
    let x0, y0;
    if (from === 'me' && D.release && Date.now() - D.release.t < 6000) { x0 = D.release.x; y0 = D.release.y; } else [x0, y0] = anchor(from);
    D.pose.at = from;
    placeXY(x0, y0, false);
    // 軌道：離した場所から投げた向きへまっすぐ進み、画面の端（見えている範囲）で跳ね返る。カードの上も通り、どこで止まってもよい
    const bd = bounds(half + 2);
    x0 = clamp(x0, bd.minX, bd.maxX); y0 = clamp(y0, bd.minY, bd.maxY);
    placeXY(x0, y0, false);
    let ux, uy;
    if (t && Number.isFinite(t.angle)) { ux = Math.cos(t.angle * Math.PI / 180); uy = Math.sin(t.angle * Math.PI / 180); }
    else {
      // 投げ方が分からないとき（タップ・相手）：画面の中ほどへ向けて、少しばらつかせる
      const [cx0, cy0] = anchor('center');
      let bx = cx0 - x0, by = cy0 - y0;
      const l = Math.hypot(bx, by);
      if (l < 2) { bx = Math.random() * 2 - 1; by = -0.6; } else { bx /= l; by /= l; }
      const r = (Math.random() * 2 - 1) * 0.5;
      ux = bx * Math.cos(r) - by * Math.sin(r); uy = bx * Math.sin(r) + by * Math.cos(r);
    }
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    // 進む距離：勢いで決まる（上限・下限あり。PC の広い画面では少し長く）
    const reach = (90 + 430 * power) * (isWide() ? 1.25 : 1);
    // 端で折り返す（鏡のように跳ね返る）
    const fold = (v, lo, hi) => {
      const w = hi - lo;
      if (w <= 0) return lo;
      let k = (v - lo) % (2 * w);
      if (k < 0) k += 2 * w;
      return lo + (k <= w ? k : 2 * w - k);
    };
    const path = s => [fold(x0 + ux * reach * s, bd.minX, bd.maxX) - x0, fold(y0 + uy * reach * s, bd.minY, bd.maxY) - y0];
    const [dx, dy] = path(1);
    const cx = ux, cy = uy;
    // 転がる軸＝飛び出す向きと盤面の上向きの外積。2本目の軸で横回転も混ぜる
    let tx = cx, ty = cy;
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const axA = [ty, -tx, 0];
    const axB = [tx, ty, 0.7];
    // 勢い：速いほどよく回り、高く跳ね、長く転がる。弱いと2回だけ低く跳ねる（上限・下限あり）
    const spinA = 260 + 820 * power + Math.random() * 120;
    const spinB = (Math.random() < 0.5 ? -1 : 1) * (90 + 200 * power);
    const heights = [S * (0.75 + 0.95 * power), S * (0.28 + 0.3 * power), power > 0.38 ? S * (0.08 + 0.12 * power) : 0];
    const durs = [250 + 140 * power, 160 + 70 * power, heights[2] ? 100 + 30 * power : 0];
    const tRoll = 130 + 110 * power, tSettle = 170;
    const z0 = S * 0.4;
    const v = [1, 0.62, 0.38, 0.3];
    const segD = [durs[0] * v[0], durs[1] * v[1], durs[2] * v[2], tRoll * v[3] / 2];
    const total = segD.reduce((a, b) => a + b, 0);
    const tFlight = durs[0] + durs[1] + durs[2], tMove = tFlight + tRoll;
    const pre = opts.tap ? T.pre : 0;
    const tStop = pre + tMove + tSettle;
    const qStart = D.pose.q;
    const tumble = (a, b) => qMul(qAxis(axA[0], axA[1], axA[2], a), qAxis(axB[0], axB[1], axB[2], b));
    // 投げた瞬間の姿勢から、出目の姿勢へ途切れなくつなぐための補正
    const qFix0 = qMul(qInv(tumble(spinA, spinB)), qMul(qStart, qInv(qEnd)));

    function travel(tt) {
      let acc = 0;
      for (let i = 0; i < 3; i++) {
        if (!durs[i]) continue;
        if (tt < durs[i]) {
          const u = tt / durs[i];
          const z = i === 0 ? z0 * (1 - u) + 4 * (heights[0] - z0 / 2) * u * (1 - u) : 4 * heights[i] * u * (1 - u);
          return { s: (acc + v[i] * tt) / total, z };
        }
        acc += segD[i]; tt -= durs[i];
      }
      if (tt < tRoll) { const u = tt / tRoll; return { s: (acc + v[3] * tRoll * (u - u * u / 2)) / total, z: 0 }; }
      return { s: 1, z: 0 };
    }
    const contacts = [durs[0], durs[0] + durs[1], tFlight].filter((c, i) => durs[i]);
    const strengths = [0.55 + 0.45 * power, 0.3 + 0.3 * power, 0.25];
    let hit = 0;

    D.btn.classList.add('throwing');
    let t0 = null, raf = 0, popped = false, timers = [];
    const later = (fn, ms) => { const id = setTimeout(() => { if (token === D.token && D.anim && D.anim.token === token) fn(); }, ms); timers.push(id); };
    const stopAll = () => { cancelAnimationFrame(raf); clearTimeout(guard); timers.forEach(clearTimeout); };
    const finishNow = () => { stopAll(); endAll(); };
    D.anim = { token, finish: finishNow };
    // 描画が止まっても（裏に回ったなど）必ず結果を出す
    const guard = setTimeout(finishNow, tStop + T.hold + T.pop + 900);

    // 停止 → 上の面を少し見せる → その面だけが盤面の中央へ移りながら、平らな大きな正方形に「バンッ」と（行き過ぎて戻る）。そのまま残す
    function popOut() {
      if (popped) return;
      popped = true;
      const face = D.faces[value].getBoundingClientRect(), lr = D.layer.getBoundingClientRect();
      const B = popSize();
      const fx = face.left + face.width / 2 - lr.left, fy = face.top + face.height / 2 - lr.top;
      const [px, py] = anchor('center');
      D.pop.getAnimations().forEach(a => a.cancel());
      D.pop.dataset.n = value;
      Object.assign(D.pop.style, { left: px.toFixed(1) + 'px', top: py.toFixed(1) + 'px', width: B + 'px', height: B + 'px', transform: popTf(0, 0, 2000, 0, 0, 1) });
      setFlat(true);
      const sc0 = Math.max(face.width, face.height) / B;
      D.pop.animate([
        { transform: popTf(fx - px, fy - py, 260, TILT, yaw, sc0), offset: 0, easing: 'cubic-bezier(.15, .7, .3, 1)' },
        { transform: popTf(0, 0, 2000, 0, 0, 1.13), offset: 0.52, easing: 'cubic-bezier(.4, 0, .3, 1)' },
        { transform: popTf(0, 0, 2000, 0, 0, 1), offset: 1 }
      ], { duration: T.pop, fill: 'none' });
      D.pop.classList.remove('glow'); void D.pop.offsetWidth; D.pop.classList.add('glow');
      chime();
      $value().textContent = `出目 ${value}`;
      // 拡大しきったら、ゲームは次へ（技を選べる）。大きな面はそのターンの間、中央に残す（押しても下のカード・技に届く）
      later(() => { stopAll(); settleFinal(); callDone(); }, T.pop);
    }

    function frame(now) {
      if (done && popped) return;
      if (token !== D.token) return;
      try {
        if (t0 === null) t0 = now;
        const el = now - t0;
        if (el < pre) {
          // タップの溜め：投げる向きと逆へ少しだけ傾けて、わずかに沈む（硬い物なので伸び縮みはしない）
          const k = Math.sin(Math.PI * el / pre);
          draw(qMul(qAxis(axA[0], axA[1], axA[2], -9 * k), qStart), 0, 0, -1.5 * k);
        } else if (el < pre + tMove) {
          const tt = el - pre;
          const p = travel(tt);
          while (hit < contacts.length && tt >= contacts[hit]) {
            const [hx, hy] = path(travel(contacts[hit]).s);
            sparks(hx, hy, strengths[hit]);
            knock(strengths[hit]);
            hit++;
          }
          const rem = 1 - p.s;
          const fix = qSlerp(qFix0, [1, 0, 0, 0], Math.min(1, p.s * 1.6));
          const q = qMul(tumble(spinA * rem, spinB * Math.pow(rem, 1.6)), qMul(fix, qEnd));
          const [ox, oy] = path(p.s);
          draw(q, ox, oy, p.z);
        } else if (el < tStop) {
          // 収まり：辺を支点に小さく揺れて止まる（勢いが強いほど少し大きく）
          const tt = el - pre - tMove;
          const w = (6 + 6 * power) * Math.exp(-tt / 70) * Math.sin(Math.PI * 2 * tt / 140) * (1 - tt / tSettle);
          draw(qMul(qAxis(axA[0], axA[1], axA[2], w), qEnd), dx, dy, 0);
        } else {
          draw(qEnd, dx, dy, 0);
          // 止まった上の面を少し見せてから飛び出す
          if (el >= tStop + T.hold) { popOut(); return; }
        }
        raf = requestAnimationFrame(frame);
      } catch (e) {
        // 演出に失敗しても、決まった出目を出して進める
        finishNow();
      }
    }
    raf = requestAnimationFrame(frame);
  }

  // 再生中なら、すぐ最後の姿（中央の平らな出目）にして終える
  function finish() {
    if (D.anim) { const a = D.anim; D.anim = null; a.finish(); }
  }

  /* ---------- 目押し（2026-11-14〜） ---------- */
  // 振れる間は 1→6 の順に一定の速さで光る。押した瞬間（つかんだ瞬間）に光っていた目を狙う（Engine が CONFIG.DICE_AIM.chance で決める）
  const aimStep = () => { const C = window.RikuyouData && window.RikuyouData.CONFIG; return (C && C.DICE_AIM && C.DICE_AIM.stepMs) || 190; };
  function aimTick() {
    const a = D.aim;
    if (!a.el) return;
    const on = !!(D.opts && D.opts.canThrow() && !D.anim);
    if (!on) { if (a.lit || a.locked) { a.lit = 0; a.locked = 0; a.t0 = 0; a.el.classList.remove('on', 'locked'); a.el.querySelectorAll('i.lit').forEach(i => i.classList.remove('lit')); } return; }
    if (a.locked) return;   // 押している間は、押した目のまま
    if (!a.t0) { a.t0 = performance.now(); a.el.classList.add('on'); }
    const n = 1 + Math.floor((performance.now() - a.t0) / aimStep()) % 6;
    if (n !== a.lit) {
      a.lit = n;
      keepAimOnScreen();
      a.el.querySelectorAll('i').forEach(i => i.classList.toggle('lit', Number(i.dataset.n) === n));
    }
  }
  // 目の並びが画面の端で切れないように、左右にずらす
  function keepAimOnScreen() {
    const el = D.aim.el;
    el.style.marginLeft = '0px';
    const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth || window.innerWidth;
    if (!r.width) return;
    const shift = r.left < 6 ? 6 - r.left : r.right > vw - 6 ? vw - 6 - r.right : 0;
    if (shift) el.style.marginLeft = shift.toFixed(0) + 'px';
  }
  // 押した瞬間の目で止める（ポインター・キーボード共通）
  function lockAim() {
    const a = D.aim;
    if (!a.el || !a.lit) return 0;
    a.locked = a.lit;
    a.el.classList.add('locked');
    return a.locked;
  }
  function unlockAim() { D.aim.locked = 0; if (D.aim.el) D.aim.el.classList.remove('locked'); }

  /* ---------- つかんで投げる（ポインター：指・マウス・ペン） ---------- */
  function bindPointer() {
    const b = D.btn;
    b.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      if (!D.opts || D.anim || D.drag || !D.opts.canThrow()) return;
      e.preventDefault();
      lockAim();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(b.style.transform) || [0, 0, 0];
      D.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, bx: +m[1], by: +m[2], t0: performance.now(), path: 0, lx: e.clientX, ly: e.clientY, moved: false, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    });
    b.addEventListener('pointermove', e => {
      const d = D.drag;
      if (!d || e.pointerId !== d.id) return;
      e.preventDefault();
      const now = performance.now();
      d.path += Math.hypot(e.clientX - d.lx, e.clientY - d.ly);
      d.lx = e.clientX; d.ly = e.clientY;
      d.samples.push({ x: e.clientX, y: e.clientY, t: now });
      while (d.samples.length > 2 && now - d.samples[0].t > 140) d.samples.shift();
      const ox = e.clientX - d.sx, oy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(ox, oy) < SWIPE_MIN) return;   // 小さなぶれは動かさない
      if (!d.moved) { d.moved = true; b.classList.add('dragging'); }
      // サイコロは指について動く（盤面の中に収める）。動かす向きへ少し傾け、わずかに持ち上げる
      // 画面に見えている範囲ならどこへでも（自分のカードの上まで引いてもよい）
      const bd = bounds(size() / 2 + 2);
      const x = clamp(d.bx + ox, bd.minX, bd.maxX), y = clamp(d.by + oy, bd.minY, bd.maxY);
      placeXY(x, y, false);
      d.x = x; d.y = y;
      const v = velocity(d);
      const sp = Math.hypot(v[0], v[1]);
      draw(sp > 0.02 ? qMul(qAxis(v[1], -v[0], 0, -Math.min(16, sp * 14)), D.pose.q) : D.pose.q, 0, 0, size() * 0.18);
    });
    const end = e => {
      const d = D.drag;
      if (!d || e.pointerId !== d.id) return;
      D.drag = null;
      b.classList.remove('dragging');
      try { b.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      const aim = D.aim.locked || 0;
      if (e.type !== 'pointerup') { unlockAim(); restore(); return; }        // 取り消し（OS がつかみを奪ったなど）：振らない
      if (!d.moved) {                                          // 動かしていない＝タップ：標準の勢いで振る
        D.release = null;
        if (D.opts && D.opts.canThrow()) D.opts.onThrow(null, aim);
        else unlockAim();
        return;
      }
      const ox = e.clientX - d.sx, oy = e.clientY - d.sy;
      if (Math.hypot(ox, oy) < SWIPE_MIN) { unlockAim(); restore(); return; }  // 元の場所へ戻して離した：取り消し
      const v = velocity(d);
      const sp = Math.hypot(v[0], v[1]);                        // px/ms
      // 勢い：離す直前の速さ（主）と動かした距離（従）。上限・下限つき
      const power = clamp(0.1 + 0.62 * clamp((sp - 0.08) / 1.5, 0, 1) + 0.28 * clamp(d.path / 220, 0, 1), 0.1, 1);
      const ang = sp > 0.05 ? Math.atan2(v[1], v[0]) : Math.atan2(oy, ox);
      const input = { power: Math.round(power * 100) / 100, angle: Math.round(ang * 180 / Math.PI), dist: Math.round(Math.min(2000, d.path)) };
      D.release = { x: d.x, y: d.y, t: Date.now() };
      D.lastThrow = input;
      if (D.opts && D.opts.canThrow()) D.opts.onThrow(input, aim);
      else { unlockAim(); restore(); }
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', e => { if (D.drag && D.drag.id === e.pointerId) end({ type: 'cancel', pointerId: e.pointerId }); });
    // ドラッグ中の Esc は取り消し
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && D.drag) { const id = D.drag.id; end({ type: 'cancel', pointerId: id }); } });
  }
  function velocity(d) {
    const s = d.samples, a = s[0], z = s[s.length - 1];
    const dt = Math.max(16, z.t - a.t);
    return [(z.x - a.x) / dt, (z.y - a.y) / dt];
  }
  // 投げずに元の場所へ戻す
  function restore() {
    D.release = null;
    place(D.pose.at, true);
    draw(D.pose.q, 0, 0, 0);
  }
  function cancelDrag() {
    if (!D.drag) return;
    D.drag = null;
    D.btn.classList.remove('dragging');
    restore();
  }

  window.RikuyouDice = {
    mount, show, roll, finish,
    // { canThrow(): 今投げてよいか, onThrow(throwInput | null): 投げた（null＝タップ・標準の投げ方） }
    bindThrow: opts => { D.opts = opts; },
    // キーボードで振るとき：今光っている目を狙う
    takeAim: () => lockAim(),
    playing: () => !!D.anim,
    sfxOn,
    setSfx: on => { try { localStorage.setItem(SFX_KEY, on ? 'on' : 'off'); } catch (e) { /* 保存できなくても動く */ } },
    // テスト用
    lastThrow: () => D.lastThrow || null,
    flatFace: () => {
      if (!D.layer || !D.layer.classList.contains('flat')) return null;
      const r = D.pop.getBoundingClientRect();
      return { n: Number(D.pop.dataset.n), w: r.width, h: r.height };
    },
    topFace: () => {
      const m = qMat(D.pose.q);
      const normals = { 1: [0, 0, 1], 6: [0, 0, -1], 2: [1, 0, 0], 5: [-1, 0, 0], 3: [0, -1, 0], 4: [0, 1, 0] };
      let best = 0, bz = -2;
      Object.keys(normals).forEach(n => { const [x, y, z] = normals[n]; const wz = m[6] * x + m[7] * y + m[8] * z; if (wz > bz) { bz = wz; best = Number(n); } });
      return best;
    }
  };
})();
