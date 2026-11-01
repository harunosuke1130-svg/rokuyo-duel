/*
 * 六耀の決闘 — 戦闘画面の立体サイコロ（見た目だけ）
 * 出目は Engine が1回だけ決める。ここは決まった数字を「投げて、跳ねて、転がって止まる」演出で見せるだけで、
 * 抽選・状態には触れない（軌道のゆらぎは Math.random で、ゲームの乱数は使わない）。
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
  const ANCHORS = {
    narrow: { me: [0.13, 0.74], center: [0.31, 0.52], foe: [0.45, 0.24] },
    wide: { me: [0.08, 0.74], center: [0.5, 0.52], foe: [0.92, 0.26] }
  };
  // 時間（ms）：溜め → 1回目の放物線 → 2回目 → 3回目 → 転がり → 収まり
  const T = { pre: 100, f0: 380, f1: 230, f2: 140, roll: 220, settle: 230 };

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

  /* ---------- 部品 ---------- */
  const D = {
    stage: null, btn: null, cam: null, world: null, body: null, shadow: null, fx: null, faces: {},
    pose: { at: 'center', value: 1, q: restQ(1, 0) },
    anim: null,     // 再生中の演出 { token, finish }
    token: 0
  };
  const size = () => (D.stage ? parseFloat(getComputedStyle(D.stage).getPropertyValue('--die')) || 44 : 44);

  function mount(stage) {
    D.stage = stage;
    D.btn = stage.querySelector('#btn-roll');
    D.btn.innerHTML = `<span class="die-cam"><span class="die-world">
        <span class="die-shadow" aria-hidden="true"></span>
        <span class="die-fx" aria-hidden="true"></span>
        <span class="die-body" id="dice" aria-hidden="true">${[1, 2, 3, 4, 5, 6].map(n => `<span class="die-face" data-n="${n}"></span>`).join('')}
          <span class="die-core x"></span><span class="die-core y"></span><span class="die-core z"></span></span>
      </span></span><span class="sr-only" id="dice-value" aria-live="polite"></span>`;
    const cap = stage.querySelector('#roll-cap');
    if (cap) D.btn.appendChild(cap);   // 「タップして振る」はサイコロについて動く
    D.cam = D.btn.querySelector('.die-cam');
    D.world = D.btn.querySelector('.die-world');
    D.body = D.btn.querySelector('.die-body');
    D.shadow = D.btn.querySelector('.die-shadow');
    D.fx = D.btn.querySelector('.die-fx');
    D.body.querySelectorAll('.die-face').forEach(f => { D.faces[f.dataset.n] = f; });
    window.addEventListener('resize', () => { finish(); place(D.pose.at, false); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
    place('center', false);
    draw(D.pose.q, 0, 0, 0);
  }

  // 置き場所の座標（盤面の左上から px）
  function anchor(at) {
    const r = D.stage.getBoundingClientRect();
    // PC の横長レイアウト（文字は右の欄）だけ広い置き方。スマホは横にしても右側に文字が重なるので狭い置き方
    const wide = window.matchMedia && window.matchMedia('(min-width: 960px) and (orientation: landscape)').matches;
    const a = ANCHORS[wide ? 'wide' : 'narrow'][at] || ANCHORS.narrow.center;
    return [r.width * a[0], r.height * a[1]];
  }
  function place(at, glide) {
    if (!D.stage) return;
    D.pose.at = at;
    const [x, y] = anchor(at);
    D.btn.classList.toggle('glide', !!glide);
    D.btn.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
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
  function lightFace(n, on) {
    Object.values(D.faces).forEach(f => f.classList.remove('lit'));
    if (on && D.faces[n]) { void D.faces[n].offsetWidth; D.faces[n].classList.add('lit'); }
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

  /* ---------- 公開：止まっている姿を出す ---------- */
  // at：'me' | 'foe' | 'center'。value が null なら今の面のまま（まだ振っていない）
  function show(opts) {
    if (!D.stage || D.anim) return;
    const o = opts || {};
    if (o.value && o.value !== D.pose.value) { D.pose.value = o.value; D.pose.q = restQ(o.value, 0); }
    if (o.at !== D.pose.at) place(o.at, !!o.glide);
    draw(D.pose.q, 0, 0, 0);
    D.btn.classList.toggle('unrolled', !o.value);
    const label = $value();
    label.textContent = o.value ? `出目 ${o.value}` : '';
  }
  const $value = () => D.btn.querySelector('#dice-value');

  /* ---------- 公開：投げる ---------- */
  // { value, from: 'me'|'foe'|'center', still: true（動きを減らす）, onDone }
  function roll(opts) {
    finish();
    const value = opts.value;
    const token = ++D.token;
    const yaw = (Math.random() * 2 - 1) * 12;
    const qEnd = restQ(value, yaw);
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      if (D.anim && D.anim.token === token) D.anim = null;
      D.btn.classList.remove('throwing');
      D.pose.value = value; D.pose.q = qEnd;
      place('center', false);
      draw(qEnd, 0, 0, 0);
      D.btn.classList.remove('unrolled');
      $value().textContent = `出目 ${value}`;
      try { opts.onDone && opts.onDone(); } catch (e) { setTimeout(() => { throw e; }); }
    };
    if (!D.stage) { end(); return; }

    // 動きを減らす：その場で短く切り替えて、同じ結果を出す
    if (opts.still) {
      D.anim = { token, finish: end };
      place('center', false);
      D.body.classList.add('fade');
      D.pose.q = qEnd; D.pose.value = value;
      draw(qEnd, 0, 0, 0);
      lightFace(value, !opts.instant);
      setTimeout(() => { D.body.classList.remove('fade'); end(); }, opts.instant ? 0 : 200);
      return;
    }

    const S = size(), half = S / 2;
    const from = opts.from === 'foe' ? 'foe' : opts.from === 'center' ? 'center' : 'me';
    place(from, false);
    const [x0, y0] = anchor(from), [x1, y1] = anchor('center');
    let dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    // 進む向き（振り直しで同じ場所なら、適当な向きに少しだけ転がる）
    let ux = dist > 1 ? dx / dist : Math.random() * 2 - 1, uy = dist > 1 ? dy / dist : -0.4;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const bow = (Math.random() * 2 - 1) * Math.min(18, dist * 0.12);   // 少し斜めに曲がる軌道
    // 転がる軸＝進む向きと盤面の上向きの外積。2本目の軸で横回転も混ぜる
    const axA = [uy, -ux, 0];
    const axB = [ux, uy, 0.7];
    const spinA = 520 + Math.random() * 200 + dist / half * 40;
    const spinB = (Math.random() < 0.5 ? -1 : 1) * (150 + Math.random() * 110);
    const qStart = D.pose.q;
    // 投げた瞬間の姿勢から、出目の姿勢へ途切れなくつなぐための補正
    const tumble = (a, b) => qMul(qAxis(axA[0], axA[1], axA[2], a), qAxis(axB[0], axB[1], axB[2], b));
    const qFix0 = qMul(qInv(tumble(spinA, spinB)), qMul(qStart, qInv(qEnd)));

    // 水平の速さ：着地のたびに落ちる。転がりで0まで減速
    const v = [1, 0.62, 0.38, 0.3];
    const segD = [T.f0 * v[0], T.f1 * v[1], T.f2 * v[2], T.roll * v[3] / 2];
    const total = segD.reduce((a, b) => a + b, 0);
    const heights = [S * 1.55, S * 0.52, S * 0.18];
    const z0 = S * 0.45;
    const tFlight = T.f0 + T.f1 + T.f2, tMove = tFlight + T.roll, tAll = T.pre + tMove + T.settle;

    // t（溜めの後からの ms）→ 進んだ割合 s と高さ z
    function travel(t) {
      let acc = 0;
      const durs = [T.f0, T.f1, T.f2];
      for (let i = 0; i < 3; i++) {
        if (t < durs[i]) {
          const u = t / durs[i];
          const z = i === 0 ? z0 * (1 - u) + 4 * (heights[0] - z0 / 2) * u * (1 - u) : 4 * heights[i] * u * (1 - u);
          return { s: (acc + v[i] * t) / total, z };
        }
        acc += segD[i]; t -= durs[i];
      }
      if (t < T.roll) { const u = t / T.roll; return { s: (acc + v[3] * T.roll * (u - u * u / 2)) / total, z: 0 }; }
      return { s: 1, z: 0 };
    }
    const contacts = [T.f0, T.f0 + T.f1, tFlight];
    const strengths = [1, 0.55, 0.28];
    let hit = 0;

    D.btn.classList.add('throwing');
    lightFace(0, false);
    let t0 = null, raf = 0;
    const finishNow = () => { cancelAnimationFrame(raf); clearTimeout(guard); end(); };
    D.anim = { token, finish: finishNow };
    // 描画が止まっても（裏に回ったなど）必ず結果を出す
    const guard = setTimeout(finishNow, tAll + 700);

    function frame(now) {
      if (done || token !== D.token) return;
      try {
        if (t0 === null) t0 = now;
        const el = now - t0;
        if (el < T.pre) {
          // 溜め：投げる向きと逆へ少しだけ傾けて、わずかに沈む（硬い物なので伸び縮みはしない）
          const k = Math.sin(Math.PI * el / T.pre);
          draw(qMul(qAxis(axA[0], axA[1], axA[2], -9 * k), qStart), 0, 0, -1.5 * k);
        } else if (el < T.pre + tMove) {
          const t = el - T.pre;
          const p = travel(t);
          while (hit < contacts.length && t >= contacts[hit]) {
            const q = travel(contacts[hit]);
            const along = q.s, perp = bow * 4 * along * (1 - along);
            sparks(dx * along - uy * perp, dy * along + ux * perp, strengths[hit]);
            knock(strengths[hit]);
            hit++;
          }
          const rem = 1 - p.s;
          const fix = qSlerp(qFix0, [1, 0, 0, 0], Math.min(1, p.s * 1.6));
          const q = qMul(tumble(spinA * rem, spinB * Math.pow(rem, 1.6)), qMul(fix, qEnd));
          const perp = bow * 4 * p.s * (1 - p.s);
          // 置き場所は投げた位置（from）。中央までのずれを足して描く
          draw(q, dx * p.s - uy * perp, dy * p.s + ux * perp, p.z);
        } else if (el < tAll + T.pre) {
          // 収まり：辺を支点に小さく2回揺れて止まる
          const t = el - T.pre - tMove;
          const w = 11 * Math.exp(-t / 75) * Math.sin(Math.PI * 2 * t / 150) * (1 - t / T.settle);
          draw(qMul(qAxis(axA[0], axA[1], axA[2], w), qEnd), dx, dy, 0);
          if (!D.btn.dataset.lit) { D.btn.dataset.lit = '1'; lightFace(value, true); }
        } else {
          delete D.btn.dataset.lit;
          clearTimeout(guard);
          end();
          return;
        }
        raf = requestAnimationFrame(frame);
      } catch (e) {
        // 演出に失敗しても、決まった出目を出して進める
        delete D.btn.dataset.lit;
        clearTimeout(guard);
        end();
      }
    }
    raf = requestAnimationFrame(frame);
  }

  // 再生中なら、すぐ最後の姿にして終える
  function finish() {
    if (D.anim) { const a = D.anim; D.anim = null; a.finish(); }
    if (D.btn) delete D.btn.dataset.lit;
  }

  window.RikuyouDice = {
    mount, show, roll, finish,
    playing: () => !!D.anim,
    sfxOn,
    setSfx: on => { try { localStorage.setItem(SFX_KEY, on ? 'on' : 'off'); } catch (e) { /* 保存できなくても動く */ } },
    // テスト用：今の姿で真上を向いている面
    topFace: () => {
      const m = qMat(D.pose.q);
      const normals = { 1: [0, 0, 1], 6: [0, 0, -1], 2: [1, 0, 0], 5: [-1, 0, 0], 3: [0, -1, 0], 4: [0, 1, 0] };
      let best = 0, bz = -2;
      Object.keys(normals).forEach(n => { const [x, y, z] = normals[n]; const wz = m[6] * x + m[7] * y + m[8] * z; if (wz > bz) { bz = wz; best = Number(n); } });
      return best;
    }
  };
})();
