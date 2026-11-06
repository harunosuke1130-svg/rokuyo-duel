/* 六耀の決闘 — ボタンを押したときの効果音（window.RikuyouSound）
 * 音は全部その場で作る（音声ファイルなし）。設定の「効果音」（サイコロの音と同じ rikuyou.sfx）で切れる。
 * 鳴らせない端末・設定でも、ゲームの進行は止めない。
 *   tap   ：ふつうのボタン・カード（木の小さな「コッ」）
 *   open  ：ホーム・ガチャ・ダンジョンなどの画面を開く（明るい2音）
 *   start ：出撃・挑戦・召喚など、始める決定（太鼓と上がる和音）
 *   back  ：閉じる・戻る（下がる1音）
 */
(function () {
  'use strict';
  const SFX_KEY = 'rikuyou.sfx';
  const on = () => { try { return localStorage.getItem(SFX_KEY) !== 'off'; } catch (e) { return true; } };
  let actx = null;
  const S = { last: null, count: 0 };

  function ctx() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      if (!actx) actx = new C();
      return actx;
    } catch (e) { return null; }
  }
  // 音の部品：周波数 f の音を、t 秒後から len 秒、音量 v で（なめらかに消える）
  function tone(ac, f, t, len, v, type, slideTo) {
    const o = ac.createOscillator(); o.type = type || 'triangle';
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + len);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + len + 0.02);
  }
  function noise(ac, t, len, v, freq) {
    const n = Math.floor(ac.sampleRate * len);
    const buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const src = ac.createBufferSource(); src.buffer = buf;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.4;
    const g = ac.createGain(); g.gain.value = v;
    src.connect(bp).connect(g).connect(ac.destination); src.start(t);
  }
  const SOUNDS = {
    tap: (ac, t) => { tone(ac, 740, t, 0.06, 0.07, 'triangle', 520); noise(ac, t, 0.025, 0.05, 2400); },
    open: (ac, t) => { tone(ac, 659, t, 0.16, 0.08); tone(ac, 988, t + 0.07, 0.22, 0.07); },
    start: (ac, t) => {
      tone(ac, 120, t, 0.22, 0.22, 'sine', 60); noise(ac, t, 0.08, 0.12, 900);          // 太鼓
      [523, 659, 784].forEach((f, k) => tone(ac, f, t + 0.06 + k * 0.06, 0.32, 0.07));   // ド・ミ・ソ
      tone(ac, 1047, t + 0.24, 0.4, 0.06);
    },
    back: (ac, t) => { tone(ac, 587, t, 0.12, 0.06, 'triangle', 392); }
  };

  function play(name) {
    if (!SOUNDS[name] || !on()) return false;
    S.last = name; S.count++;
    const ac = ctx();
    if (!ac) return false;
    const go = () => { try { SOUNDS[name](ac, ac.currentTime + 0.005); } catch (e) { /* 音は飾り */ } };
    if (ac.state === 'running') go();
    else if (ac.resume) ac.resume().then(go).catch(() => {});   // iPhone などは、最初のタップで音が使えるようになる
    return true;
  }

  // どの音にするか（押したものから決める）。null は鳴らさない
  const START = '#btn-formation-ok, #btn-dg-start, .mt-go, #btn-gacha-1, #btn-gacha-10, .sk-cast, #btn-local-start, #btn-admin-start, #btn-room-create, [data-match="free"]';
  const OPEN = '[data-go], #tabbar [data-tab], [data-gacha-kind], [data-dg]';
  const BACK = '[data-close], #modal-x, .modal-x, .ga-back, .rs-link';
  const SKIP = '#btn-roll, .die, .dice-layer, .fx-skip, input, select, textarea, label';
  function kindOf(el) {
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest(SKIP)) return null;
    if (el.matches(START)) return 'start';
    if (el.matches(BACK)) return 'back';
    if (el.matches(OPEN)) return 'open';
    return 'tap';
  }
  // 画面のどこで押しても、ボタンなら鳴らす（押した処理より先に。処理が止まっても音は鳴る）
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('button, [role="button"], [data-go], [data-dg], [data-close], a[href]');
    const k = kindOf(el);
    if (k) play(k);
  }, true);

  S.play = play;
  S.kindOf = kindOf;
  window.RikuyouSound = S;
})();
