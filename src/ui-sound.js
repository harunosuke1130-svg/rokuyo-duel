/* 六耀の決闘 — ボタンを押したときの効果音（window.RikuyouSound）
 * 音は全部その場で作る（音声ファイルなし）。設定の「効果音」（サイコロの音と同じ rikuyou.sfx）で切れる。
 * 鳴らせない端末・設定でも、ゲームの進行は止めない。
 *   tap   ：ふつうのボタン・カード（木の小さな「コッ」）
 *   open  ：ホーム・ガチャ・ダンジョンなどの画面を開く（明るい2音）
 *   start ：出撃・挑戦・召喚など、始める決定（太鼓と上がる和音）
 *   back  ：閉じる・戻る（下がる1音）
 *
 * BGM（2026-11-26〜）：戦闘中に流す曲。音声ファイルは src/audio/（ビルドで埋め込む）。
 *   設定の「BGM」（rikuyou.bgm）で切れる。効果音とは別。
 *   ファイルは 1 周を 2 回つなげたもの（scripts/bgm-loop.py）。途中の 1 周ぶんをくり返すので継ぎ目が出ない。
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

  /* ---------- BGM ---------- */
  const BGM_KEY = 'rikuyou.bgm';
  const BGM_VOL = 0.32;
  // period：1 周の秒数（BPM と小節数から）。loopStart：2 周の途中のどこから 1 周をくり返すか
  const TRACKS = {
    battle: { src: '@audio/bgm-battle.mp3', period: 252000 / 44100, loopStart: 1.0 }   // 通常戦（168BPM・4小節）
  };
  const bgmOn = () => { try { return localStorage.getItem(BGM_KEY) !== 'off'; } catch (e) { return true; } };
  const B = { want: null, name: null, node: null, gain: null, bufs: {}, loading: {}, starts: 0 };
  function bufferOf(name) {
    const ac = ctx(), t = TRACKS[name];
    if (!ac || !t || t.src.charAt(0) === '@') return Promise.reject(new Error('no audio'));
    if (B.bufs[name]) return Promise.resolve(B.bufs[name]);
    if (!B.loading[name]) {
      B.loading[name] = new Promise((res, rej) => {
        let bytes;
        try {
          const bin = atob(t.src.slice(t.src.indexOf(',') + 1));
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch (e) { rej(e); return; }
        // 古い Safari はコールバック形式だけなので両方に対応
        const p = ac.decodeAudioData(bytes.buffer, res, rej);
        if (p && p.then) p.then(res, rej);
      }).then(buf => { B.bufs[name] = buf; return buf; }, e => { delete B.loading[name]; throw e; });
    }
    return B.loading[name];
  }
  function fadeOutNode(ac, node, gain, sec) {
    try {
      const t = ac.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + sec);
      node.stop(t + sec + 0.05);
    } catch (e) { /* 止められなくても進行には関係しない */ }
  }
  function startNode(name) {
    const ac = ctx();
    if (!ac || B.want !== name || B.node || !bgmOn()) return;
    const buf = B.bufs[name], t = TRACKS[name];
    if (!buf) return;
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf; src.loop = true;
    src.loopStart = t.loopStart; src.loopEnd = Math.min(buf.duration, t.loopStart + t.period);
    g.gain.setValueAtTime(0, ac.currentTime);
    g.gain.linearRampToValueAtTime(BGM_VOL, ac.currentTime + 0.8);
    src.connect(g).connect(ac.destination);
    src.start(ac.currentTime + 0.02, 0);
    B.node = src; B.gain = g; B.name = name; B.starts++;
  }
  // 流す（同じ曲が流れていれば何もしない）。鳴らせない端末・設定でも進行は止めない
  function bgmPlay(name) {
    if (!TRACKS[name]) return;
    if (B.want === name && B.node) return;
    if (B.node && B.name !== name) bgmStop(0.4);
    B.want = name;
    if (!bgmOn()) return;
    const ac = ctx();
    if (!ac) return;
    if (ac.state !== 'running' && ac.resume && !document.hidden) ac.resume().catch(() => {});
    bufferOf(name).then(() => startNode(name)).catch(() => {});
  }
  function bgmStop(sec) {
    B.want = null;
    const ac = ctx();
    if (B.node && ac) fadeOutNode(ac, B.node, B.gain, sec === undefined ? 0.9 : sec);
    B.node = null; B.gain = null; B.name = null;
  }
  function setBgm(v) {
    try { localStorage.setItem(BGM_KEY, v ? 'on' : 'off'); } catch (e) { /* 保存できなくても今回は切り替える */ }
    const want = B.want;
    if (!v) { bgmStop(0.3); B.want = want; }
    else if (want) { B.want = null; bgmPlay(want); }
  }
  // iPhone などは最初のタップまで音が出ない：タップのたびに、流したい曲があれば始める
  document.addEventListener('pointerdown', () => {
    if (!B.want || B.node || !bgmOn()) return;
    const ac = ctx();
    if (ac && ac.state !== 'running' && ac.resume) ac.resume().catch(() => {});
    bgmPlay(B.want);
  }, true);
  // 別のアプリ・タブに移ったら止め、戻ったら続ける（音だけ。ゲームは止めない）
  document.addEventListener('visibilitychange', () => {
    const ac = actx;
    if (!ac || !B.node) return;
    try { if (document.hidden) ac.suspend(); else ac.resume(); } catch (e) { /* 無視 */ }
  });
  S.bgm = {
    play: bgmPlay, stop: bgmStop, on: bgmOn, set: setBgm,
    // テスト・確認用
    state: () => ({ want: B.want, playing: !!B.node, name: B.name, starts: B.starts, ctx: actx ? actx.state : null, loop: B.node ? [B.node.loopStart, B.node.loopEnd] : null })
  };

  S.play = play;
  S.kindOf = kindOf;
  window.RikuyouSound = S;
})();
