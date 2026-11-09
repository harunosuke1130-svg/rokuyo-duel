/*
 * 六耀の決闘 — 戦闘画面
 *
 * 1つの画面を3つの遊び方で使う：
 *   cpu        … CPUと対戦（ダンジョン・フリー対戦）。戦闘はこの端末で計算
 *   pvp-host   … 対人戦のホスト。戦闘はこの端末で計算し、状態をルームに書き込む
 *   pvp-guest  … 対人戦のゲスト。行動の依頼をルームに送り、ホストが計算した状態を表示する
 * 「自分の陣営」は me（'player' か 'cpu'）。ホストとCPU戦は 'player'、ゲストは 'cpu'。
 * ルールの判定はすべて RikuyouEngine が行う。
 */
(function () {
  'use strict';

  const U = window.RikuyouUI;
  const CPU = window.RikuyouCPU;
  const Dice = window.RikuyouDice;
  const { E, CONFIG, DELAY, rng, $, esc, emblem, elMark, portrait, starsHtml, frameAttrs, elementTag, subTags, hpBar, hpText, levelTag, movesList, leaderBox, traitBox, openModal, closeModal, toast } = U;

  const bt = {
    active: false,
    mode: 'cpu',
    me: 'player',
    foe: 'cpu',
    state: null,
    session: 0,     // 戦闘ごとに増やし、古い非同期処理を無効化する
    timers: new Set(),
    locked: true,   // true の間はプレイヤー操作を受け付けない
    diceAnim: false,
    lastLogs: [],
    finished: false,
    opts: null,
    cpuPlan: null,
    // 対人戦
    backend: null,
    code: null,
    unwatch: null,
    pushSeq: 0,      // ホスト：書き込んだ状態の番号
    lastSeq: 0,      // ゲスト：表示済みの状態の番号
    intentSeq: 0,    // ゲスト：送った依頼の番号
    handledIntent: 0, // ホスト：処理済みの依頼の番号
    waiting: false,  // ゲスト：依頼の結果待ち
    room: null,
    heartbeat: null,
    formationShown: false,
    fmDraft: null,   // 準備画面で並べ中の配置（{ slots, leader }）。対人戦で依頼が戻されたときも引き継ぐ
    // 演出（表示だけ。状態・結果には触れない）
    hpShown: {},     // 画面に出しているHP（"side:idx" → 値）
    hpHold: {},      // 当たる瞬間まで前のHPを見せておく分
    pickKey: '',     // 技を選ぶ場面が変わったときだけ、技の欄を登場させる
    moveBefore: {},  // 固有スキルの直前に出ていた通常技の攻撃値（強化の「前→後」を見せる）
    barrierHold: {}, // 結界が消えた（被弾で消費）カード：当たる瞬間まで膜を残す
    barrierWait: {}, // 結界が付いたカード：膜が届く瞬間まで出さない
    boostShown: {},  // 画面に出している「このターン 攻撃×2」の文字（消えるときに火の粉にする）
    fxQuick: false   // 演出をタップで短縮した（この結果の残りの演出を素早く）
  };

  const foeIsCpu = () => bt.mode === 'cpu';
  const isGuest = () => bt.mode === 'pvp-guest';
  const isHost = () => bt.mode === 'pvp-host';
  const whoName = side => (side === bt.me ? 'あなた' : (bt.opts && bt.opts.foeName) || '相手');

  /* ---------- タイマー（戦闘ごとに一括破棄） ---------- */
  function schedule(fn, ms) {
    const token = bt.session;
    const id = setTimeout(() => {
      bt.timers.delete(id);
      if (token !== bt.session) return;
      fn();
    }, ms);
    bt.timers.add(id);
  }
  function stop() {
    bt.timers.forEach(id => { clearTimeout(id); clearInterval(id); });
    bt.timers.clear();
    bt.session++;
    bt.diceAnim = false;
    if (window.RikuyouDice) window.RikuyouDice.finish();
    bt.lastLogs = [];
    bt.active = false;
    bt.hpShown = {}; bt.hpHold = {}; bt.pickKey = '';
    bt.moveBefore = {}; bt.barrierHold = {}; bt.barrierWait = {}; bt.boostShown = {}; bt.fxQuick = false;
    document.querySelectorAll('#screen-battle .cast-lift').forEach(c => c.classList.remove('cast-lift'));
    $('#screen-battle').classList.remove('casting');
    if (bt.unwatch) { try { bt.unwatch(); } catch (e) { /* noop */ } }
    bt.unwatch = null;
    if (bt.heartbeat) clearInterval(bt.heartbeat);
    bt.heartbeat = null;
    $('#fx-layer').innerHTML = '';
  }

  /* ---------- 開始 ---------- */
  // opts: { mode, state, title, foeName, cpuPlan, backend, code, onFinish(result), onExit() }
  function start(opts) {
    stop();
    bt.active = true;
    bt.opts = opts;
    bt.mode = opts.mode || 'cpu';
    bt.me = isGuest() ? 'cpu' : 'player';
    bt.foe = E.opp(bt.me);
    bt.state = opts.state;
    bt.cpuPlan = opts.cpuPlan || null;
    bt.finished = false;
    bt.locked = true;
    bt.formationShown = false;
    bt.fmDraft = null;
    bt.backend = opts.backend || null;
    bt.code = opts.code || null;
    bt.pushSeq = 0; bt.lastSeq = 0; bt.intentSeq = 0; bt.handledIntent = 0; bt.waiting = false; bt.room = null;
    $('#battle-title').textContent = opts.title || '決闘';
    $('#ally-title').textContent = '味方';
    $('#enemy-title').textContent = $('#enemy-title2').textContent = foeIsCpu() ? '敵' : '相手';
    $('#screen-battle').dataset.bg = opts.bg || 'arena';
    $('#screen-battle').classList.remove('ending'); // 背景（ダンジョンごと）。操作部分の位置は共通
    U.showScreen('battle');
    if (bt.mode !== 'cpu') startRoomLink();
    if (isHost()) pushState(null); // 対戦開始時の状態をゲストに渡す
    if (bt.state) { render(); advance(); } else render();
  }

  /* ---------- 対人戦：ルームとの同期 ---------- */
  function startRoomLink() {
    const myKey = isHost() ? 'hostSeen' : 'guestSeen';
    bt.heartbeat = setInterval(() => {
      if (!bt.finished && bt.backend) bt.backend.updateRoom(bt.code, { [myKey]: Date.now() }).catch(() => {});
      renderConnection();
    }, 15000);
    bt.unwatch = bt.backend.watchRoom(bt.code, onRoom);
  }

  function onRoom(room) {
    if (!bt.active) return;
    bt.room = room;
    renderConnection();
    if (!room) { if (!bt.finished) toast('ルームが閉じられました'); return; }
    if (isHost()) {
      // ゲストの行動依頼を処理（Engine で検証してから反映）
      const it = room.intent;
      if (it && it.seq > bt.handledIntent && bt.state) {
        bt.handledIntent = it.seq;
        let args = {};
        try { args = JSON.parse(it.args || '{}'); } catch (e) { /* 不正な依頼 */ }
        const r = apply(bt.state, bt.foe, it.type, args);
        if (!r.ok) { bt.backend.updateRoom(bt.code, { reject: { seq: it.seq, error: r.error } }).catch(() => {}); return; }
        pushState(r);
        if (it.type === 'formation') { afterFormation(r); return; }
        onResult(r);
      }
    } else {
      if (room.reject && room.reject.seq === bt.intentSeq && bt.waiting) {
        bt.waiting = false;
        bt.locked = false;
        toast(room.reject.error);
        if (bt.state && bt.state.phase === 'formation' && !bt.state.front[bt.me].length) { bt.formationShown = false; advance(); }
        else if (bt.state && bt.state.phase === 'replace' && bt.state.pendingReplace.side === bt.me) advance();
        else render();
      }
      if (room.seq > bt.lastSeq && room.stateJson) {
        bt.lastSeq = room.seq;
        bt.state = JSON.parse(room.stateJson);
        const last = room.lastJson ? JSON.parse(room.lastJson) : { events: [], logs: [] };
        bt.waiting = false;
        onResult({ ok: true, events: last.events || [], logs: last.logs || [] }, true);
      }
    }
  }

  // ホスト：状態をルームに書き込む
  function pushState(r) {
    if (!isHost()) return;
    bt.pushSeq++;
    const patch = {
      stateJson: JSON.stringify(bt.state),
      lastJson: JSON.stringify({ events: (r && r.events) || [], logs: (r && r.logs) || [] }),
      seq: bt.pushSeq,
      status: bt.state.phase === 'over' ? 'over' : 'playing'
    };
    bt.backend.updateRoom(bt.code, patch).catch(e => toast('同期に失敗しました：' + e.message));
  }

  function renderConnection() {
    const box = $('#conn-info');
    if (bt.mode === 'cpu' || !bt.room) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    const seen = isHost() ? bt.room.guestSeen : bt.room.hostSeen;
    const lost = !bt.finished && seen && Date.now() - seen > 50000;
    box.classList.toggle('hidden', !lost);
    box.innerHTML = lost
      ? `<span>相手の接続が途切れているようです。</span>${isHost() ? '<button type="button" class="btn btn-small btn-ghost" id="btn-claim-win">相手の切断で勝利にする</button>' : ''}`
      : '';
    const b = $('#btn-claim-win');
    if (b) b.addEventListener('click', () => { const r = E.surrender(bt.state, bt.foe); if (r.ok) { pushState(r); onResult(r); } });
  }

  /* ---------- 行動の実行（自分・CPU・相手プレイヤー共通） ---------- */
  function apply(state, side, type, a) {
    switch (type) {
      case 'formation': return E.chooseFormation(state, side, a.front, a.leader);
      case 'roll': return E.roll(state, side, rng, a.throw);
      case 'swap': return E.swap(state, side, a.out, a.in);
      case 'skill': return E.useSkill(state, side, a.user, rng, a.dice !== undefined ? { dice: a.dice } : undefined);
      case 'move': return E.useMove(state, side, a.unit);
      case 'replace': return E.chooseReplacement(state, side, a.unit);
      case 'surrender': return E.surrender(state, side);
      default: return { ok: false, error: '不明な操作です' };
    }
  }

  // 自分の操作。ゲストは依頼を送り、それ以外はこの端末で計算する
  function perform(type, args) {
    if (!bt.state || bt.locked || bt.waiting) return false;
    if (isGuest()) {
      // 送る前に手元で検証して、明らかな誤りはすぐ知らせる（数字を出す・スキルは結果をホストが決める）
      const trial = apply(JSON.parse(JSON.stringify(bt.state)), bt.me, type, args || {});
      if (!trial.ok) { toast(trial.error); return false; }
      bt.locked = true;
      bt.waiting = true;
      bt.intentSeq++;
      closeModal(true);
      render();
      bt.backend.updateRoom(bt.code, { intent: { seq: bt.intentSeq, type, args: JSON.stringify(args || {}) } })
        .catch(e => { bt.waiting = false; bt.locked = false; toast('送信に失敗しました：' + e.message); render(); });
      return true;
    }
    bt.locked = true;
    const r = apply(bt.state, bt.me, type, args || {});
    if (!r.ok) { bt.locked = false; toast(r.error); render(); return false; }
    closeModal(true);
    pushState(r);
    if (type === 'formation') { afterFormation(r); return true; }
    onResult(r);
    return true;
  }

  // 結果の演出 → 次の段階へ
  function onResult(r, fromRoom) {
    holdHp(r.events || []);
    captureSwap(r.events || []);
    captureFx(r.events || []);
    bt.fxQuick = false;
    const rollEv = r.events.find(e => e.type === 'roll');
    const initEv = r.events.find(e => e.type === 'initiative');
    const skillEv = r.events.find(e => e.type === 'skill');
    if (initEv) { showInitiative(initEv, r); return; }
    const go = () => {
      if (rollEv) {
        bt.lastRoll = rollEv;
        if (rollEv.reroll && !rollEv.chosen) windAtDice();
        animateDice(rollEv, () => afterAction(r, rollEv.side === bt.me && !rollEv.reroll ? 0 : undefined));
        return;
      }
      afterAction(r);
    };
    void fromRoom;
    // 固有スキル：先に「誰が・何を」使ったかを見せてから、効果（届く・当たる・回復・結界・強化・振り直し）へ
    if (skillEv) { bt.skillShows = (bt.skillShows || 0) + 1; skillIntro(skillEv, go); }
    else go();
  }

  function afterAction(r, delay) {
    if (r.logs && r.logs.length) bt.lastLogs = r.logs.filter(l => l.kind !== 'turn').slice(-8);
    render();
    playSwap();
    playEvents(r.events || []);
    const quick = r.events && r.events.every(e => e.type === 'roll' || e.type === 'switch' || e.type === 'skill' || e.type === 'barrier');
    schedule(advance, delay !== undefined ? delay : (quick ? DELAY.fxGap * 3 + 60 : DELAY.after));
  }

  // CPU戦：自分の配置のあと、CPUの配置を反映する
  function afterFormation(r) {
    let logs = r.logs.slice();
    if (foeIsCpu() && bt.state.phase === 'formation' && bt.cpuPlan) {
      const r2 = E.chooseFormation(bt.state, bt.foe, bt.cpuPlan.front, bt.cpuPlan.leader);
      if (r2.ok) logs = logs.concat(r2.logs);
    }
    bt.lastLogs = logs.filter(l => l.kind !== 'turn');
    render();
    schedule(advance, 0);
  }

  function advance() {
    const s = bt.state;
    if (!s || !bt.active) return;
    if (s.phase === 'over') {
      bt.locked = true; render();
      // 決着：盤面をゆっくり暗くしてから、結果を自動で表示（報酬の確定は finish で1回だけ）
      if (!bt.finished) { bt.finished = true; $('#screen-battle').classList.add('ending'); schedule(finish, DELAY.result); }
      return;
    }
    if (s.phase === 'formation') {
      if (!s.front[bt.me].length) { bt.locked = false; render(); if (!bt.formationShown) { bt.formationShown = true; showFormationModal(); } }
      else { bt.locked = true; render(); }
      return;
    }
    if (s.phase === 'initiative') {
      bt.locked = true;
      render();
      if (!isGuest()) {
        const r = E.rollInitiative(s, rng);
        if (r.ok) { pushState(r); onResult(r); }
      }
      return;
    }
    if (s.phase === 'replace') {
      if (s.pendingReplace.side === bt.me) {
        bt.locked = false;
        render();
        if (!bt.waiting) showReplaceModal();
      } else {
        bt.locked = true;
        render();
        if (foeIsCpu()) schedule(cpuReplace, DELAY.replace);
      }
      return;
    }
    if (s.turnSide !== bt.me) {
      bt.locked = true;
      render();
      if (foeIsCpu()) schedule(cpuStep, DELAY.cpuThink);
      return;
    }
    bt.locked = false;
    render();
  }

  function cpuReplace() {
    const r = CPU.act(bt.state, bt.foe, rng);
    if (!r.ok) { console.error(r.error); return; }
    captureSwap(r.events || []);
    afterAction(r, DELAY.replace / 2);
  }

  function cpuStep() {
    const s = bt.state;
    if (s.turnSide !== bt.foe || (s.phase !== 'roll' && s.phase !== 'action')) { advance(); return; }
    const r = CPU.act(s, bt.foe, rng);
    if (!r.ok) { console.error('CPU行動エラー', r.error); advance(); return; }
    if (r.decision.type === 'skill') bt.lastLogs = r.logs.slice(-6);
    onResult(r);
  }

  function finish() {
    const s = bt.state;
    const won = s.winner === bt.me;
    if (isHost()) bt.backend.updateRoom(bt.code, { status: 'over' }).catch(() => {});
    if (bt.opts.onFinish) bt.opts.onFinish({ won, state: s, surrendered: s.surrendered || null });
  }

  function surrender() {
    if (!bt.state || bt.state.phase === 'over') return;
    if (isGuest()) { bt.locked = false; bt.waiting = false; perform('surrender', {}); return; }
    bt.locked = false;
    perform('surrender', {});
  }

  /* ---------- 描画 ---------- */
  function statusBadges(state, side, i) {
    const u = state.teams[side][i];
    const b = [];
    if (state.leader && state.leader[side] === i) b.push('<span class="badge leader">リーダー</span>');
    if (E.isBoss(u.charId)) b.push(`<span class="badge boss">${E.unitChar(u).rank || 'ボス'}</span>`);
    if (u.hp <= 0) b.push('<span class="badge ko">戦闘不能</span>');
    else if (E.isFront(state, side, i)) b.push('<span class="badge front">前衛</span>');
    else if (state.phase !== 'formation') b.push('<span class="badge bench">後衛</span>');
    if (u.barrier) b.push(`<span class="badge barrier">${u.barrier === 'quarter' ? '4分の1結界' : '結界'}</span>`);
    if (u.hp > 0 && u.poison) b.push(`<span class="badge st-poison">毒 残${u.poison.turns}</span>`);
    if (u.hp > 0 && u.weakAtk) b.push(`<span class="badge st-weak">攻撃力↓ 残${u.weakAtk.turns}</span>`);
    if (u.hp > 0 && u.weakHeal) b.push(`<span class="badge st-weak">回復力↓ 残${u.weakHeal.turns}</span>`);
    if (u.hp > 0) b.push(u.cd > 0 ? `<span class="badge cd">CD残${u.cd}</span>` : '<span class="badge ready">スキル可</span>');
    return b.join('');
  }

  const myActing = s => s && s.turnSide === bt.me && s.phase === 'action' && !!s.dice && !bt.diceAnim && !s.moveUsed;

  // 対象別の効果（Engine.previewMove と同じ計算）
  function previewChips(p) {
    let html = '';
    if (p.attacks.length) {
      const plain = p.move.atk * p.atkPow;
      const b = p.boosted !== plain ? `・強化後${atkNum(p.boosted)}` : '';
      html += `<div class="pv-line"><span class="pv-range dmg">敵前衛全員</span><span class="pv-base">攻撃力${p.atkPow}×${p.move.atk}＝${plain}${b}</span></div><div class="chips">` +
        p.attacks.map(a => `<span class="chip dmg">${esc(a.name)} <b>-${a.damage}</b>${a.hits > 1 ? ` <i class="adv">${a.hits}段</i>` : ''}${a.pursuit ? ` <i class="adv">追撃+${a.pursuit}</i>` : ''}${a.advantage ? ` <i class="adv">属性有利 ×${CONFIG.ADVANTAGE_MULTIPLIER}</i>` : ''}${a.barrier ? ` <i class="adv">${a.barrier === 'quarter' ? '4分の1結界' : '結界で半減'}</i>` : ''}</span>`).join('') + '</div>';
    } else if (p.move.atk > 0) {
      html += '<div class="pv-line muted">攻撃できる敵前衛がいません</div>';
    }
    if (p.heals.length) {
      const f = p.healPercent < 100 ? `（疲労${p.healPercent}%で${p.heals[0].amount}）` : '';
      html += `<div class="pv-line"><span class="pv-range heal">味方前衛全員</span><span class="pv-base">回復力${p.healPow}×${p.move.heal}＝${p.healPow * p.move.heal}${p.healBase !== p.healPow * p.move.heal ? `・強化後${p.healBase}` : ''}${f}</span></div><div class="chips">` +
        p.heals.map(h => `<span class="chip heal">${esc(h.name)} <b>+${h.effective}</b></span>`).join('') + '</div>';
    }
    if (p.fx) html += `<div class="pv-line"><span class="pv-range fx">技の効果</span><span class="pv-base">${esc(fxPreviewText(p))}</span></div>`;
    if (!p.move.atk && !p.move.heal && !p.fx) html += '<div class="pv-line muted">何も起こらない</div>';
    return html;
  }

  // 技の効果の予測（Engine.previewMove の fx）
  function fxPreviewText(p) {
    const f = p.fx;
    if (f.type === 'drain') return `吸収：与えたダメージの${f.percent}%（${f.amount}）を自分が回復`;
    if (f.type === 'poison') return `毒：当たった敵はターンの始めに${f.amount}ダメージ×${f.turns}回（毒では倒れない）`;
    if (f.type === 'weaken') return `当たった敵の${f.stat === 'heal' ? '回復力' : '攻撃力'}を${f.percent}%下げる（${f.turns}ターン）`;
    if (f.type === 'multi') return `${f.hits}段攻撃：結界は最初の1回だけを軽くして消える`;
    if (f.type === 'pinch') return f.active ? `反撃：HPが${f.under}%以下なので攻撃${f.mult}倍！` : `反撃：HPが${f.under}%以下なら攻撃${f.mult}倍（今は通常）`;
    if (f.type === 'guard') return '自分に4分の1結界（次に受ける防げるダメージ1回を4分の1に）';
    return '';
  }
  // 強化後の攻撃の表示（1.4倍などで出る 16.799999… のような端数の誤差を消す。計算には使わない）
  const atkNum = v => Math.round(v * 100) / 100;

  // HPの状態：色だけでなく文字（ピンチ）でも示す
  const hpState = u => (u.hp <= 0 ? 'ko' : u.hp / u.maxHp <= 0.25 ? 'low' : u.hp / u.maxHp <= 0.5 ? 'mid' : '');
  const hpNum = u => `<span class="bt-hp"><b>${u.hp}</b>/${u.maxHp}</span>`;

  // 出目の通常技（味方の前衛カードの下部に出す。押すと確認画面）
  function moveArea(i) {
    const s = bt.state;
    const u = s.teams[bt.me][i];
    const ch = E.unitChar(u);
    const p = E.previewMove(s, bt.me, i);
    const atk = p.move.atk > 0, heal = p.move.heal > 0;
    const healVal = p.heals.length ? p.heals[0].amount : p.healBase;
    const kind = atk && heal ? 'both' : atk ? 'atk' : heal ? 'heal' : 'none';
    const head = { both: '攻撃＋回復', atk: '攻撃技', heal: '回復技', none: '効果なし' }[kind];
    const main = kind === 'both' ? `攻${atkNum(p.boosted)}＋回${healVal}` : kind === 'atk' ? `攻撃 ${atkNum(p.boosted)}` : kind === 'heal' ? `回復 ${healVal}` : '—';
    // 攻撃と回復を分けて描く（固有スキルの強化で光らせるのは攻撃の数字だけ）
    const atkTxt = kind === 'both' ? `攻${atkNum(p.boosted)}` : `攻撃 ${atkNum(p.boosted)}`;
    const mainHtml = kind === 'both' ? `<span class="mo-atk">${esc(atkTxt)}</span>＋<span class="mo-heal">回${healVal}</span>`
      : kind === 'atk' ? `<span class="mo-atk">${esc(atkTxt)}</span>` : esc(main);
    const boosted = atk && s.turnSide === bt.me && (s.boost.mult > 1 || s.boost.bonus > 0);
    return `<button type="button" class="mo-btn ${kind}${boosted ? ' boosted' : ''}" data-move="${i}"${bt.locked || bt.waiting ? ' disabled' : ''} data-el="${esc(boostEl() || ch.element)}" aria-label="${esc(ch.name)}の通常技「${esc(p.move.name)}」${esc(main)}">
      <span class="mo-kind">${head}</span><b class="mo-main">${mainHtml}</b><span class="mo-name">${s.dice}「${esc(p.move.name)}」</span></button>`;
  }

  // カード：絵（押すと詳細）＋名前・★・HP＋（味方前衛で出目確定後は）通常技。枠は属性色×ランクの濃さ
  function unitCard(side, i, kind) {
    const s = bt.state;
    const u = s.teams[side][i];
    // 相手の後衛で、まだ確認していないキャラは「？」の伏せたカード（ダンジョン以外。前衛に出る・後衛から固有スキルを使うと分かる）
    if (side === bt.foe && kind === 'back' && s.phase !== 'formation' && E.isHidden(s, side, i)) {
      return `<div class="bt-card unit-card back foe veiled" data-side="${side}" data-idx="${i}" data-pos="back" data-veiled="1">
        <span class="bt-art" role="img" aria-label="相手の後衛（まだ分からない）"><span class="bt-veil" aria-hidden="true">？</span></span>
        <span class="bt-backline"><span class="bt-veil-note">未確認</span></span>
      </div>`;
    }
    const ch = E.unitChar(u);
    const hidden = side === bt.foe && s.phase === 'formation';
    const mine = side === bt.me;
    // HPは「当たる瞬間」まで前の値を見せる（演出だけ。状態は変えない）
    const key = side + ':' + i;
    const shown = key in bt.hpHold ? bt.hpHold[key] : u.hp;
    bt.hpShown[key] = shown;
    const vu = shown === u.hp ? u : Object.assign({}, u, { hp: shown });
    const st = hpState(vu);
    const lead = !hidden && s.leader && s.leader[side] === i;
    const tags = [];
    if (lead) tags.push('<span class="bt-tag lead" title="リーダー"><svg viewBox="0 0 24 18" aria-hidden="true"><path d="M2 15L1 4l6 5 5-8 5 8 6-5-1 11z" fill="currentColor"/></svg><i>リーダー</i></span>');
    if (E.isBoss(u.charId)) tags.push(`<span class="bt-tag boss">${esc(ch.rank || 'ボス')}</span>`);
    // 結界：膜が届く瞬間までは出さず、被弾で消えたときは当たる瞬間まで残す（どちらも表示だけ）
    const shield = u.hp > 0 && ((u.barrier && !(key in bt.barrierWait)) || key in bt.barrierHold);
    if (shield) tags.push(u.barrier === 'quarter' ? '<span class="bt-tag barrier" title="4分の1結界：次の防げるダメージ1回を4分の1に">◈¼結界</span>' : '<span class="bt-tag barrier" title="結界：次の防げるダメージ1回を半減">◈結界</span>');
    // 技の効果による状態（毒・攻撃力ダウン・回復力ダウン）。数字は残りの回数
    if (u.hp > 0 && u.poison) tags.push(`<span class="bt-tag st-poison" title="毒：ターンの始めに${u.poison.amount}ダメージ（あと${u.poison.turns}回・毒では倒れない）">☠${u.poison.turns}</span>`);
    if (u.hp > 0 && u.weakAtk) tags.push(`<span class="bt-tag st-weak" title="攻撃力${u.weakAtk.percent}%ダウン（あと${u.weakAtk.turns}ターン）">攻↓${u.weakAtk.turns}</span>`);
    if (u.hp > 0 && u.weakHeal) tags.push(`<span class="bt-tag st-weak" title="回復力${u.weakHeal.percent}%ダウン（あと${u.weakHeal.turns}ターン）">回↓${u.weakHeal.turns}</span>`);
    const cd = u.hp > 0 && !hidden ? (u.cd > 0 ? `<span class="bt-cd" title="固有スキルの残りターン">⌛${u.cd}</span>` : (mine ? '<span class="bt-cd ok">スキル可</span>' : '')) : '';
    const label = `${ch.name}${E.starsOf(ch.id) ? ' ★' + E.starsOf(ch.id) : ''} HP${u.hp}/${u.maxHp}${hpState(u) === 'low' ? '（ピンチ）' : ''}${u.hp <= 0 ? '（戦闘不能）' : ''}${lead ? '（リーダー）' : ''}`;
    const withMove = mine && kind === 'front' && u.hp > 0 && myActing(s) && !bt.waiting;
    return `<div class="bt-card unit-card el-frame ${kind} ${mine ? 'mine' : 'foe'}${st ? ' hp-' + st : ''}${vu.hp <= 0 ? ' ko' : ''}${withMove ? ' can-act' : ''}${shield ? ' has-barrier' : ''}" ${frameAttrs(ch)} data-side="${side}" data-idx="${i}" data-pos="${kind}">
      <span class="bt-art" role="button" tabindex="0" aria-label="${esc(label)}（詳細・固有スキル）">${portrait(ch, { zoom: !E.isBoss(u.charId) })}${elMark(ch)}<span class="bt-tags">${tags.join('')}</span>${vu.hp <= 0 ? '<span class="bt-ko">戦闘不能</span>' : ''}${kind === 'back' ? hpNum(vu) : ''}</span>
      ${kind === 'front' ? `<span class="bt-info"><span class="bt-name">${esc(ch.name)}${starsHtml(ch)}</span><span class="bt-hpline">${hpNum(vu)}${st === 'low' ? '<span class="bt-pinch">ピンチ</span>' : ''}${cd}</span>${hpBar(vu)}</span>`
        : `${hpBar(vu)}<span class="bt-backline">${starsHtml(ch)}${u.hp > 0 && u.cd > 0 && !hidden ? `<span class="bt-cd" title="固有スキルの残りターン">⌛${u.cd}</span>` : ''}</span>`}
      ${withMove ? `<span class="bt-move">${moveArea(i)}</span>` : ''}
      ${hidden ? '<span class="bt-hidden">配置前</span>' : ''}
    </div>`;
  }

  function renderSide(side) {
    const s = bt.state;
    const pre = side === bt.me ? 'ally' : 'enemy';
    const frontIds = s.phase === 'formation' && side === bt.foe ? [] : s.front[side];
    const backIds = s.teams[side].map((u, i) => i).filter(i => frontIds.indexOf(i) < 0)
      .sort((a, b) => (s.teams[side][b].hp > 0) - (s.teams[side][a].hp > 0));
    // ボス戦など、チームが3体未満の側には空き枠を出さない
    const slots = Math.min(CONFIG.FRONT_SIZE, s.teams[side].length);
    const empty = Array.from({ length: Math.max(0, slots - frontIds.length) },
      () => `<div class="bt-card front empty-slot">${s.phase === 'formation' ? '配置前' : '空き枠'}</div>`).join('');
    const fr = $('#' + pre + '-front');
    fr.innerHTML = frontIds.map(i => unitCard(side, i, 'front')).join('') + empty;
    fr.dataset.count = String(slots);
    if (side === bt.me) {
      // 技を選べる間：前衛の技の欄を強調し、後衛を少し控えめに。場面が変わったときだけ技の欄を登場させる
      const picking = myActing(s) && !bt.waiting;
      const key = picking ? [s.round, s.dice, s.front[side].join(','), s.skillUsed, s.swapUsed].join('|') : '';
      fr.classList.toggle('picking', picking);
      fr.classList.toggle('pick-enter', picking && key !== bt.pickKey);
      bt.pickKey = key;
      $('#' + pre + '-back').classList.toggle('dim', picking);
    }
    $('#' + pre + '-back').innerHTML = backIds.map(i => unitCard(side, i, 'back')).join('');
    // 後衛がいない側（ボス）は「後衛」の見出しを隠す
    $('#' + pre + '-back').previousElementSibling.classList.toggle('hidden', !backIds.length);
    $('#' + pre + '-back').classList.toggle('hidden', !backIds.length);
    renderBoost(side, pre);
    const l = s.leader[side];
    const hideLeader = side === bt.foe && s.phase === 'formation';
    const lc = l === null || l === undefined || hideLeader ? null : E.unitChar(s.teams[side][l]);
    $('#' + pre + '-leader').innerHTML = lc
      ? `<b>リーダー</b> ${esc(lc.name)}「${esc(lc.leaderSkill.name)}」<span>${esc(lc.leaderSkill.text)}</span>`
      : (s.teams[side].some(u => E.isBoss(u.charId)) ? '<span>ダンジョンの敵（リーダーなし）</span>' : '');
  }

  function renderCenter() {
    const s = bt.state;
    const pct = E.healPercent(Math.max(1, E.fatigueRound(s, bt.me)));
    $('#round-info').innerHTML = s.round > 0 ? `第<b>${s.round}</b>巡` : '準備中';
    $('#fatigue-info').innerHTML = pct < 100 ? `回復疲労：回復${pct}%` : '';
    const foe = whoName(bt.foe);
    let phase = '', sub = '';
    if (s.phase === 'formation') { phase = '戦闘準備'; sub = s.front[bt.me].length ? `${foe}が配置を決めています…` : '前衛とリーダーを決めてください'; }
    else if (s.phase === 'initiative') { phase = '先攻・後攻'; sub = 'サイコロで決めています…'; }
    else if (s.phase === 'over') { phase = s.winner === bt.me ? '勝利！' : '敗北…'; sub = '結果を表示します（サイコロで何度でも見られます）'; }
    else if (s.phase === 'replace') { phase = s.pendingReplace.side === bt.me ? '前衛の補充' : '相手のターン'; sub = s.pendingReplace.side === bt.me ? '後衛から前衛に出すキャラを選んでください' : `${foe}が前衛を補充しています…`; }
    else if (s.turnSide === bt.foe) { phase = '相手のターン'; sub = s.phase === 'roll' ? `${foe}が数字を出しています…` : `${foe}の出目 ${s.dice}：行動を考えています…`; }
    else if (bt.waiting) { phase = 'あなたのターン'; sub = '相手の端末に送信中…'; }
    else if (s.phase === 'roll') { phase = 'サイコロを振る'; sub = 'サイコロをつかんで投げる（タップでも振れる）'; }
    else if (bt.diceAnim) { phase = 'サイコロを振る'; sub = 'サイコロが転がっています…'; }
    else if (s.moveUsed) { phase = 'あなたのターン'; sub = '行動しました'; }
    else { phase = '技を選ぶ'; sub = '使う技を選んでください'; }
    $('#phase-text').textContent = phase;
    $('#phase-sub').textContent = sub;
    $('#screen-battle').classList.toggle('my-turn', s.turnSide === bt.me && (s.phase === 'roll' || s.phase === 'action'));
    $('#range-note').classList.toggle('hidden', !(myActing(s) && !bt.waiting));

    // サイコロ自体が「振る」ボタン。振る番の側の手前（自分）／奥（相手）で待ち、出目が出たら盤面の中央に残る
    if (!bt.diceAnim) {
      const at = s.phase === 'roll' ? (s.turnSide === bt.me ? 'me' : 'foe') : 'center';
      Dice.show({ at, value: s.phase === 'roll' ? null : s.dice, glide: !reduced() && !U.FAST });
    }
    const btn = $('#btn-roll');
    let cap = '';
    if (s.phase === 'over') { btn.disabled = !!U.ui.modal; cap = '結果を見る'; }
    else {
      btn.disabled = bt.locked || bt.waiting || bt.diceAnim || s.turnSide !== bt.me || s.phase !== 'roll';
      cap = btn.disabled ? '' : 'スワイプで投げる・タップで振る';
    }
    $('#roll-cap').textContent = cap;
    btn.classList.toggle('ready', !btn.disabled && s.phase !== 'over');
    btn.setAttribute('aria-label', s.phase === 'over' ? '結果を見る' : !btn.disabled ? 'サイコロを振る（つかんで投げる・Enter で振る）' : (s.dice ? `出目 ${s.dice}` : '数字はまだ出ていません'));
    // 交代できるか（できない理由）を短く出す
    const hint = $('#drag-hint');
    const swapReason = bt.locked || bt.waiting ? '処理中' : E.swapBlockReason(s, bt.me);
    const active = !(s.phase === 'over' || s.phase === 'formation' || s.phase === 'initiative');
    if (!active) hint.textContent = '';
    else if (!swapReason) hint.textContent = '長押ししてドラッグで交代';
    else hint.textContent = s.turnSide === bt.me && s.phase !== 'roll' ? `交代：${swapReason}` : '';

    const flags = [];
    if (s.phase === 'action' || s.phase === 'replace') {
      const who = s.turnSide === bt.me ? '' : foe + '：';
      if (s.boost.mult > 1) flags.push(`${who}通常技の攻撃×${s.boost.mult}`);
      if (s.boost.bonus > 0) flags.push(`${who}通常技の攻撃+${s.boost.bonus}`);
      if (s.swapUsed) flags.push(`${who}交代済み`);
      if (s.skillUsed) flags.push(`${who}スキル使用済み`);
    }
    if (s.initiative && s.round <= 1) flags.push(`先攻：${whoName(s.firstSide)}（${s.initiative[bt.me]} 対 ${s.initiative[bt.foe]}）`);
    $('#turn-flags').textContent = flags.join('・');

    const last = bt.lastLogs.filter(l => l.kind !== 'turn').slice(-2);
    $('#last-action').innerHTML = last.length
      ? last.map(l => `<div class="lk-${l.kind}">${esc(l.text)}</div>`).join('')
      : '<div class="muted">直近の行動がここに表示されます</div>';
  }

  const logHtml = () => bt.state.log.slice().reverse().map(l => `<li class="lk-${l.kind}">${esc(l.text)}</li>`).join('');
  function renderLog() {
    $('#log').innerHTML = logHtml();
  }

  function render() {
    if (!bt.state) {
      $('#phase-text').textContent = '準備中';
      $('#phase-sub').textContent = '相手の準備を待っています…';
      return;
    }
    renderSide(bt.foe);
    renderCenter();
    renderSide(bt.me);
    renderLog();
    renderConnection();
    if (U.ui.modal && U.ui.modal.refresh) U.ui.modal.refresh();
  }

  /* ---------- 上部メニュー（戦闘履歴・遊び方・降参） ---------- */
  function showLogModal() {
    openModal('', { kind: 'log', refresh: () => { const l = $('#modal-body .log'); if (l) l.innerHTML = logHtml(); } });
    $('#modal-body').innerHTML = `<h3>戦闘履歴</h3><p class="muted">新しい順</p><ol class="log log-full">${logHtml()}</ol>
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button></div>`;
  }
  function showBattleMenu() {
    const over = bt.state && bt.state.phase === 'over';
    openModal(`<h3>メニュー</h3>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-block" id="btn-menu-log">戦闘履歴</button>
        ${bt.opts && bt.opts.onHelp ? '<button type="button" class="btn btn-ghost btn-block" id="btn-menu-help">遊び方</button>' : ''}
        ${over ? '' : `<button type="button" class="btn btn-ghost btn-block btn-danger" id="btn-surrender">${bt.mode !== 'cpu' ? '降参して退出' : '戦闘をやめる'}</button>`}
        <button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button>
      </div>`, { kind: 'menu', bind: b => {
      b.querySelector('#btn-menu-log').addEventListener('click', showLogModal);
      const h = b.querySelector('#btn-menu-help');
      if (h) h.addEventListener('click', () => { closeModal(true); bt.opts.onHelp(); });
      const sr = b.querySelector('#btn-surrender');
      if (sr) sr.addEventListener('click', showSurrenderConfirm);
    } });
  }

  /* ---------- 演出（表示だけ。結果は Engine が決めたもの。状態は変えない） ---------- */
  const reduced = () => U.reducedMotion();
  const cardOf = (side, idx) => document.querySelector(`#screen-battle .unit-card[data-side="${side}"][data-idx="${idx}"]`);
  const elOf = (side, idx) => { const u = bt.state && bt.state.teams[side] && bt.state.teams[side][idx]; return u ? E.unitChar(u).element : ''; };

  function floatAt(el, text, cls, offset, elem) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    const n = document.createElement('div');
    n.className = 'fx-num ' + cls;
    if (elem) n.dataset.el = elem;
    n.textContent = text;
    n.style.top = Math.min(window.innerHeight - 20, Math.max(20, r.top + r.height * 0.5 + (offset || 0))) + 'px';
    n.style.left = (r.left + r.width / 2) + 'px';
    $('#fx-layer').appendChild(n);
    // 長い文字（「ピンチ！攻撃×2」など）が画面の端で切れないように、幅を見て内側に寄せる
    const half = (n.offsetWidth || 60) * 0.6 + 8;   // 弾む動き（少し拡大）の分も見込む
    n.style.left = Math.min(window.innerWidth - half, Math.max(half, r.left + r.width / 2)) + 'px';
    setTimeout(() => n.remove(), 1300);
  }
  function flash(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 800);
  }
  // カードの絵の上に、属性ごとの当たり・回復・結界の効果を重ねる（CSS のみ・短い）
  function cardFx(card, kind, elem) {
    const art = card && card.querySelector('.bt-art');
    if (!art) return;
    const fx = document.createElement('span');
    fx.className = 'fx-card fx-' + kind;
    if (elem) fx.dataset.el = elem;
    fx.setAttribute('aria-hidden', 'true');
    art.appendChild(fx);
    setTimeout(() => fx.remove(), 750);
  }
  // 全体攻撃・全体回復：その列全体を、属性の色の帯がなでる
  function rowSweep(side, kind, elem) {
    const row = $(side === bt.me ? '#ally-front' : '#enemy-front');
    const r = row && row.getBoundingClientRect();
    if (!r || !r.width) return;
    const n = document.createElement('div');
    n.className = 'fx-sweep fx-sweep-' + kind;
    if (elem) n.dataset.el = elem;
    Object.assign(n.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: Math.min(r.height, 220) + 'px' });
    n.innerHTML = `<span>${kind === 'heal' ? '味方前衛全員' : (side === bt.me ? '味方前衛全員' : '敵前衛全員')}</span>`;
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 900);
  }

  // HP：当たる瞬間まで前の値を見せる。結果が来た時点で「画面に出ている値」と違えば保持する
  function holdHp(events) {
    if (!bt.state) return;
    events.forEach(ev => {
      if (ev.type !== 'damage' && ev.type !== 'heal') return;
      const key = ev.side + ':' + ev.idx;
      const u = bt.state.teams[ev.side] && bt.state.teams[ev.side][ev.idx];
      if (!u || !(key in bt.hpShown) || key in bt.hpHold) return;
      if (bt.hpShown[key] !== u.hp) bt.hpHold[key] = bt.hpShown[key];
    });
  }
  // 当たった：そのカードのHPバーと数字だけを、前の値から新しい値へ滑らかに動かす
  function releaseHp(side, idx) {
    const key = side + ':' + idx;
    if (!(key in bt.hpHold)) return;
    const from = bt.hpHold[key];
    delete bt.hpHold[key];
    const u = bt.state && bt.state.teams[side] && bt.state.teams[side][idx];
    const card = cardOf(side, idx);
    if (!u || !card) return;
    const to = u.hp;
    bt.hpShown[key] = to;
    const bar = card.querySelector('.hpbar');
    const fill = bar && bar.querySelector('i');
    if (fill) {
      if (to < from && !reduced()) {
        // 減った分を明るい帯で少し残してから縮める
        const trail = document.createElement('b');
        trail.className = 'hp-trail';
        trail.style.width = (from / u.maxHp * 100) + '%';
        bar.insertBefore(trail, fill);
        requestAnimationFrame(() => { trail.style.width = Math.max(0, to / u.maxHp * 100) + '%'; });
        setTimeout(() => trail.remove(), 900);
      }
      fill.style.width = Math.max(0, to / u.maxHp * 100) + '%';
      const r = to / u.maxHp;
      bar.classList.toggle('low', r <= 0.25);
      bar.classList.toggle('mid', r > 0.25 && r <= 0.5);
    }
    const num = card.querySelector('.bt-hp b');
    if (num) countTo(num, from, to);
  }
  function countTo(el, from, to) {
    if (reduced() || U.FAST || from === to) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 380, token = bt.session;
    const step = now => {
      if (token !== bt.session || !el.isConnected) return;
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- 固有スキルの演出（表示だけ。結果は Engine が決めたもの） ---------- */
  // このターンの攻撃強化を使ったキャラの属性（強化の炎・水などの色に使う）
  const boostEl = () => { const s = bt.state; return s && s.skillUsedBy !== null && s.skillUsedBy !== undefined ? elOf(s.turnSide, s.skillUsedBy) : ''; };
  // 「このターン 攻撃×2」の印：ゲームの状態（boost）から描く。消えるときは火の粉になって散る
  function renderBoost(side, pre) {
    const s = bt.state;
    const box = $('#' + pre + '-boost');
    if (!box) return;
    const on = s.turnSide === side && (s.phase === 'action' || s.phase === 'replace') && (s.boost.mult > 1 || s.boost.bonus > 0);
    const parts = [];
    if (on && s.boost.mult > 1) parts.push(`攻撃×${atkNum(s.boost.mult)}`);
    if (on && s.boost.bonus > 0) parts.push(`攻撃+${s.boost.bonus}`);
    const text = parts.length ? `このターン ${parts.join('・')}` : '';
    const prev = bt.boostShown[side] || '';
    if (prev && !text && !reduced() && !U.FAST) embersAt(box, box.dataset.el);
    bt.boostShown[side] = text;
    box.dataset.el = on ? boostEl() : (box.dataset.el || '');
    box.innerHTML = text ? `<span class="bt-boost-ico" aria-hidden="true">⚔</span>${esc(text)}<small>（回復は変わらない）</small>` : '';
    box.classList.toggle('on', !!text);
  }
  function embersAt(el, elem) {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    for (let i = 0; i < 6; i++) {
      const n = document.createElement('i');
      n.className = 'fx-ember';
      if (elem) n.dataset.el = elem;
      n.style.left = (r.left + r.width * (0.2 + 0.6 * Math.random())) + 'px';
      n.style.top = (r.top + r.height / 2) + 'px';
      n.style.setProperty('--dx', ((Math.random() - 0.5) * 40).toFixed(0) + 'px');
      n.style.setProperty('--dy', (-20 - Math.random() * 30).toFixed(0) + 'px');
      $('#fx-layer').appendChild(n);
      setTimeout(() => n.remove(), 900);
    }
  }
  // 結果を描き直す前に、強化前の攻撃値・結界の有無を控える（「前→後」と膜の出入りを、届く瞬間に見せるため）
  function captureFx(events) {
    bt.moveBefore = {};
    document.querySelectorAll('#ally-front .mo-btn[data-move] .mo-atk').forEach(n => { bt.moveBefore[n.closest('[data-move]').dataset.move] = n.textContent; });
    const s = bt.state;
    if (!s || reduced() || U.FAST) return;
    events.forEach(ev => {
      const key = ev.side + ':' + ev.idx;
      if (ev.type === 'barrier') bt.barrierWait[key] = true;
      if (ev.type === 'damage') {
        const c = cardOf(ev.side, ev.idx);
        const u = s.teams[ev.side] && s.teams[ev.side][ev.idx];
        if (c && c.classList.contains('has-barrier') && u && !u.barrier) bt.barrierHold[key] = true;
      }
    });
  }
  const fxRect = el => { const r = el && el.getBoundingClientRect(); return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
  // 発動元から対象へ、属性の粒を飛ばす（数を抑える）
  function trail(fromEl, toEl, elem, ms, kind) {
    const a = fxRect(fromEl), b = fxRect(toEl);
    if (!a || !b) return;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'fx-mote' + (kind ? ' ' + kind : '');
      if (elem) p.dataset.el = elem;
      p.style.left = a.x + 'px'; p.style.top = a.y + 'px';
      $('#fx-layer').appendChild(p);
      const mx = (a.x + b.x) / 2 + (Math.random() - 0.5) * 70, my = (a.y + b.y) / 2 + (Math.random() - 0.5) * 50;
      p.animate([
        { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
        { transform: `translate(calc(-50% + ${mx - a.x}px), calc(-50% + ${my - a.y}px)) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(.7)`, opacity: 0.2 }
      ], { duration: ms, delay: i * 28, easing: 'cubic-bezier(.4, 0, .4, 1)', fill: 'both' });
      setTimeout(() => p.remove(), ms + i * 28 + 60);
    }
  }
  // 味方（または敵）の前衛の列に、属性の輪が広がる（攻撃強化）
  function rowRing(side, elem) {
    const row = $(side === bt.me ? '#ally-front' : '#enemy-front');
    const c = fxRect(row);
    if (!c) return;
    const n = document.createElement('div');
    n.className = 'fx-ring';
    if (elem) n.dataset.el = elem;
    n.style.left = c.x + 'px'; n.style.top = c.y + 'px';
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 800);
  }
  // 強化された通常技の攻撃値：前の値 → 新しい値（攻撃の数字だけ短く拡大。回復の数字は光らせない）
  function popBoostedMoves() {
    document.querySelectorAll('#ally-front .mo-btn[data-move]').forEach(btn => {
      const n = btn.querySelector('.mo-atk');
      const before = bt.moveBefore[btn.dataset.move];
      if (!n || !before || before === n.textContent) return;
      const after = n.textContent;
      n.innerHTML = `<s class="mo-from">${esc(before)}</s>${esc(after)}`;
      n.classList.remove('mo-pop'); void n.offsetWidth; n.classList.add('mo-pop');
      setTimeout(() => { if (n.isConnected) { n.textContent = after; n.classList.remove('mo-pop'); } }, 900);
    });
    bt.moveBefore = {};
  }
  // 強化の数字は、炎の輪が届くまで前の値のまま見せる
  function holdBoostedMoves() {
    document.querySelectorAll('#ally-front .mo-btn[data-move] .mo-atk').forEach(n => {
      const before = bt.moveBefore[n.closest('[data-move]').dataset.move];
      if (before && before !== n.textContent) { n.dataset.after = n.textContent; n.textContent = before; }
    });
  }
  function releaseBoostedMoves() {
    document.querySelectorAll('#ally-front .mo-btn[data-move] .mo-atk[data-after]').forEach(n => { n.textContent = n.dataset.after; delete n.dataset.after; });
  }
  // 振り直し：風が今の出目を巻き上げる
  function windAtDice() {
    if (reduced() || U.FAST) return;
    const pop = document.querySelector('#dice-layer .die-pop');
    const c = fxRect(pop && pop.offsetParent ? pop : $('#dice-stage'));
    if (!c) return;
    const n = document.createElement('div');
    n.className = 'fx-wind';
    n.style.left = c.x + 'px'; n.style.top = c.y + 'px';
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 700);
  }

  // 発動の前置き：戦場を少し暗くし、発動したカードを浮かせ、キャラの絵と技名のカットインを出す（約0.75秒・タップで短縮）
  function skillIntro(ev, next) {
    const token = bt.session;
    let done = false;
    const card = cardOf(ev.side, ev.idx);
    const u = bt.state.teams[ev.side] && bt.state.teams[ev.side][ev.idx];
    const ch = u && E.unitChar(u);
    const cleanup = () => {
      document.querySelectorAll('#fx-layer .fx-cutin, #fx-layer .fx-skip').forEach(n => n.remove());
      const dim = document.querySelector('#fx-layer .fx-dim');
      if (dim) { dim.classList.add('out'); setTimeout(() => dim.remove(), 260); }
    };
    const go = quick => {
      if (done) return;
      done = true;
      if (quick) bt.fxQuick = true;
      cleanup();
      if (token !== bt.session) return;
      next();
      // 浮かせたカードは効果が届くころに戻す（描き直しで新しいカードになっていれば、そちらにも付けない）
      setTimeout(() => document.querySelectorAll('#screen-battle .cast-lift').forEach(c => c.classList.remove('cast-lift')), bt.fxQuick ? 0 : 700);
    };
    if (U.FAST || !ch) { go(); return; }
    const el = ch.element;
    const foe = ev.side !== bt.me;
    if (card) { card.style.setProperty('--act-el', `var(--el-${el})`); card.classList.add('cast-lift'); }
    const layer = $('#fx-layer');
    if (reduced()) {
      // 動きを減らす：カットインの代わりに、技名を短いフェードで
      const n = document.createElement('div');
      n.className = 'fx-cutin still';
      n.dataset.el = el;
      n.innerHTML = `<div class="ci-name"><small>${foe ? esc(whoName(bt.foe)) + 'の' : ''}${esc(ch.name)}</small><b>${esc(ch.skill.name)}</b></div>`;
      layer.appendChild(n);
      schedule(() => go(), 420);
      return;
    }
    layer.insertAdjacentHTML('beforeend', `<div class="fx-dim"></div>
      <div class="fx-cutin${foe ? ' foe' : ''}" data-el="${esc(el)}" role="status" aria-label="${esc(ch.name)}の固有スキル「${esc(ch.skill.name)}」">
        <div class="ci-band"><div class="ci-art">${portrait(ch)}</div>
          <div class="ci-name"><small>${foe ? esc(whoName(bt.foe)) + 'の' : ''}${esc(ch.name)}</small><b>${esc(ch.skill.name)}</b></div>
          <span class="ci-motes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div>
      </div>
      <button type="button" class="fx-skip" aria-label="演出を短くする"></button>`);
    const skip = layer.querySelector('.fx-skip');
    skip.addEventListener('pointerdown', e => { e.preventDefault(); go(true); });
    skip.addEventListener('click', () => go(true));
    schedule(() => go(), 760);
  }

  // 1体への当たり・回復・結界（数字とHPバーは、その瞬間に動かす）
  // 技の効果：3段は3回に分けて当たる・毒は紫の泡・吸収は相手から命が流れ込む・弱体は下向きの矢印・¼結界は厚い金の盾
  function hitOne(ev, actEl) {
    const card = cardOf(ev.side, ev.idx);
    const key = ev.side + ':' + ev.idx;
    const quick = U.FAST || bt.fxQuick || reduced();
    let releaseAt = 0;
    if (ev.type === 'damage' && ev.poison) {
      // 毒のダメージ（ターンの始め）：紫の泡が立ちのぼる
      cardFx(card, 'poison');
      flash(card, ev.side === bt.me ? 'hit-down' : 'hit-up');
      floatAt(card, '毒 -' + ev.amount, 'poison', 0);
    } else if (ev.type === 'damage') {
      // 結界があった：膜が反応して砕ける（被ダメージは Engine が軽くした後）
      if (key in bt.barrierHold) {
        delete bt.barrierHold[key];
        if (card) { card.classList.remove('has-barrier'); const t = card.querySelector('.bt-tag.barrier'); if (t) t.remove(); }
        cardFx(card, 'shatter');
      }
      const parts = ev.parts && ev.parts.length > 1 ? ev.parts : null;
      if (parts && !quick) {
        // 3段攻撃：少しずつずらして3回当て、数字も1回ずつ出す。最後に合計
        parts.forEach((d, k) => schedule(() => {
          cardFx(card, 'hit', actEl);
          cardFx(card, 'multi');
          const sl = card && card.querySelector('.fx-multi:last-child'); if (sl) sl.style.setProperty('--ang', ['35deg', '145deg', '90deg'][k % 3]);
          flash(card, ev.side === bt.me ? 'hit-down' : 'hit-up');
          floatAt(card, '-' + d, 'dmg multi', -18 + k * 16, actEl);
        }, k * 170));
        releaseAt = parts.length * 170;
        schedule(() => floatAt(card, ev.pursuit ? `追撃！ 計${ev.amount}` : `${parts.length}HIT 計${ev.amount}`, 'combo', -46), releaseAt);
      } else {
        cardFx(card, 'hit', actEl);
        flash(card, ev.side === bt.me ? 'hit-down' : 'hit-up');
        floatAt(card, '-' + ev.amount, 'dmg', 0, actEl);
      }
      if (ev.guts) schedule(() => { cardFx(card, 'guard'); floatAt(card, '根性！', 'guard', -40); }, releaseAt + (quick ? 0 : 120));
      // 毒・弱体がかかった（毒に強いキャラは効かない）
      if (ev.status) {
        const label = { poison: '毒', weakAtk: '攻撃力ダウン', weakHeal: '回復力ダウン', resist: '毒に強い' }[ev.status];
        schedule(() => {
          cardFx(card, ev.status === 'poison' ? 'poison' : 'weak');
          floatAt(card, label, ev.status === 'poison' ? 'poison' : 'weak', 26);
        }, releaseAt + (quick ? 0 : 160));
      }
    } else if (ev.type === 'heal' && ev.drain) {
      // 吸収：当たった敵から、赤い命の粒が使ったキャラへ流れ込む
      const ms = quick ? 0 : 420;
      if (!quick) (ev.from || []).forEach(i => trail(cardOf(E.opp(ev.side), i), card, '', ms, 'drain'));
      schedule(() => {
        cardFx(card, 'drain');
        flash(card, 'glow-heal');
        floatAt(card, '吸収 +' + ev.amount, 'drain', 14);
        releaseHp(ev.side, ev.idx);
      }, ms);
      return;
    } else if (ev.type === 'heal') {
      cardFx(card, 'heal');
      flash(card, 'glow-heal');
      if (ev.amount > 0) floatAt(card, '+' + ev.amount, 'heal', 14); // 満タンで回復0のときは数字を出さない
    } else if (ev.type === 'barrier') {
      const tagHtml = ev.quarter ? '<span class="bt-tag barrier" title="4分の1結界：次の防げるダメージ1回を4分の1に">◈¼結界</span>' : '<span class="bt-tag barrier" title="結界：次の防げるダメージ1回を半減">◈結界</span>';
      if (key in bt.barrierWait) {
        delete bt.barrierWait[key];
        if (card && !card.classList.contains('has-barrier')) {
          card.classList.add('has-barrier');
          const tags = card.querySelector('.bt-tags');
          if (tags) tags.insertAdjacentHTML('beforeend', tagHtml);
        }
      }
      cardFx(card, ev.quarter ? 'guard' : 'barrier');
      floatAt(card, ev.quarter ? '¼結界' : '結界', ev.quarter ? 'guard' : 'info', -10);
    }
    if (releaseAt) schedule(() => releaseHp(ev.side, ev.idx), releaseAt);
    else releaseHp(ev.side, ev.idx);
  }

  // 行動 → 当たり。行動したキャラを短く強調し、その後で対象に当たり（全体なら同時）と数字を出す
  // 固有スキルは、スキルの効果の順に「発動元から対象へ届く → 当たる・回復・結界・強化」を見せる
  function playEvents(events) {
    const actEv = events.find(e => e.type === 'move') || events.find(e => e.type === 'skill');
    const actEl = actEv ? elOf(actEv.side, actEv.idx) : '';
    const quick = U.FAST || bt.fxQuick || reduced();
    if (actEv && actEv.type === 'move') {
      const c = cardOf(actEv.side, actEv.idx);
      if (c) { c.style.setProperty('--act-el', `var(--el-${actEl || 'holy'})`); flash(c, actEv.side === bt.me ? 'act-up' : 'act-down'); }
      // ピンチ：赤い気がふくらむ
      if (c && actEv.pinch) { cardFx(c, 'pinch'); floatAt(c, '反撃！攻撃×2', 'pinch', -30); }
      if (c && actEv.firstStrike) { cardFx(c, 'pinch'); floatAt(c, '先手！攻撃×1.5', 'pinch', -30); }
    }
    const groups = [];
    events.forEach(ev => {
      if (ev.type !== 'damage' && ev.type !== 'heal' && ev.type !== 'barrier') return;
      const last = groups[groups.length - 1];
      const sub = ev.poison ? 'poison' : ev.drain ? 'drain' : '';
      if (last && last.type === ev.type && last.side === ev.side && last.sub === sub) last.list.push(ev);
      else groups.push({ type: ev.type, side: ev.side, sub, list: [ev] });
    });
    // 回復疲労がなくなった：その陣営の前衛に短く表示
    const fatigue = events.filter(e => e.type === 'fatigueReset');
    const showFatigue = () => fatigue.forEach(ev => {
      const row = $(ev.side === bt.me ? '#ally-front' : '#enemy-front');
      floatAt(row, '回復疲労がなくなった', 'info', -30);
      row.querySelectorAll('.unit-card').forEach(c => cardFx(c, 'heal'));
    });
    const playGroup = g => {
      if (g.list.length >= 2 && g.type !== 'barrier' && !g.sub) rowSweep(g.side, g.type, g.type === 'heal' ? 'heal' : actEl);
      g.list.forEach(ev => hitOne(ev, actEl));
    };
    let end = 0;
    if (actEv && actEv.type === 'skill') {
      const u = bt.state.teams[actEv.side] && bt.state.teams[actEv.side][actEv.idx];
      const effects = u ? E.unitChar(u).skill.effects : [];
      const caster = () => cardOf(actEv.side, actEv.idx);
      const tTrail = quick ? 0 : 300, gap = quick ? 0 : 220;
      let t = 0;
      const used = new Set();
      const takeGroup = type => { const g = groups.find(x => x.type === type && !used.has(x)); if (g) used.add(g); return g; };
      let boosted = false;
      holdBoostedMoves();
      effects.forEach(eff => {
        if ((eff.type === 'atkMultiplier' || eff.type === 'atkBonus') && !boosted) {
          boosted = true;
          // 攻撃強化：味方側に属性の輪が広がり、強化される通常技の攻撃値が「前 → 後」に変わる（敵にはまだ何も当たらない）
          const at = t;
          schedule(() => { rowRing(actEv.side, actEl); trail(caster(), $(actEv.side === bt.me ? '#ally-front' : '#enemy-front'), actEl, Math.max(1, tTrail), 'boost'); }, at);
          schedule(() => { releaseBoostedMoves(); popBoostedMoves(); }, at + tTrail);
          t = at + tTrail + gap;
        } else if (eff.type === 'heal' || eff.type === 'barrier' || eff.type === 'damage') {
          const g = takeGroup(eff.type);
          if (!g) return;
          const at = t;
          if (!quick) schedule(() => g.list.forEach(ev => trail(caster(), cardOf(ev.side, ev.idx), eff.type === 'heal' ? 'heal' : actEl, tTrail, eff.type)), at);
          schedule(() => playGroup(g), at + tTrail);
          t = at + tTrail + gap;
        } else if (eff.type === 'fatigueReset') {
          schedule(showFatigue, t);
          t += gap;
        }
      });
      if (!boosted) releaseBoostedMoves();
      groups.filter(g => !used.has(g)).forEach(g => { schedule(() => playGroup(g), t); t += gap; });
      end = t;
    } else {
      const lead = actEv && !U.FAST ? 200 : 0;
      fatigue.length && schedule(showFatigue, lead);
      const gapM = U.FAST ? 0 : 340;
      // ターンの始めの毒は、技の当たり・「毒」の表示と重ならないよう少し遅らせる
      const extra = g => (g.sub === 'poison' && !U.FAST ? 520 : 0);
      groups.forEach((g, k) => schedule(() => playGroup(g), lead + k * gapM + extra(g)));
      end = lead + groups.length * gapM + Math.max(0, ...groups.map(extra));
    }
    // 念のため：保持したHP・結界の膜・強化前の数字は最後に必ず戻す（演出が途中で切れても表示が正しい値になる）
    schedule(() => {
      releaseBoostedMoves();
      const stale = Object.keys(bt.hpHold).length || Object.keys(bt.barrierHold).length || Object.keys(bt.barrierWait).length;
      if (!stale) return;
      bt.hpHold = {}; bt.barrierHold = {}; bt.barrierWait = {};
      render();
    }, end + 120);
  }

  // 交代：入れ替わる2枚が、前の位置から新しい位置へ滑らかに動く（FLIP）
  let swapFrom = null;
  function captureSwap(events) {
    const evs = events.filter(e => e.type === 'switch');
    swapFrom = null;
    if (!evs.length || reduced() || U.FAST) return;
    swapFrom = [];
    evs.forEach(ev => [ev.out, ev.in].forEach(idx => {
      if (idx === undefined || idx === null) return;
      const c = cardOf(ev.side, idx);
      if (c) swapFrom.push({ side: ev.side, idx, rect: c.getBoundingClientRect() });
    }));
  }
  function playSwap() {
    const list = swapFrom;
    swapFrom = null;
    if (!list || !list.length) return;
    list.forEach(({ side, idx, rect }) => {
      const c = cardOf(side, idx);
      if (!c) return;
      const now = c.getBoundingClientRect();
      if (!now.width || !rect.width) return;
      const dx = rect.left - now.left, dy = rect.top - now.top, sc = rect.width / now.width;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      c.classList.add('swapping');
      c.style.transformOrigin = '0 0';
      c.style.transform = `translate(${dx}px, ${dy}px) scale(${sc})`;
      void c.offsetWidth;
      c.style.transition = 'transform .34s cubic-bezier(.2, .8, .2, 1)';
      c.style.transform = '';
      setTimeout(() => { c.classList.remove('swapping'); c.style.transition = ''; c.style.transformOrigin = ''; }, 380);
    });
  }

  // サイコロ：Engine が決めた出目を、立体のサイコロを投げて見せる（ここでは抽選しない。演出が失敗・中断しても出目を出して進める）
  // ev.throw は投げ方（自分・対人戦の相手がスワイプしたとき）。無ければ標準の勢いで見せる
  function animateDice(ev, then) {
    const token = bt.session;
    bt.diceAnim = true;
    render();
    let called = false;
    const done = () => {
      if (called) return;
      called = true;
      if (token !== bt.session) return;
      bt.diceAnim = false;
      then();
    };
    const fast = U.FAST;
    try {
      Dice.roll({
        value: ev.value, from: ev.reroll ? 'center' : ev.side === bt.me ? 'me' : 'foe',
        throw: ev.throw || null, tap: !ev.throw && ev.side === bt.me && !ev.reroll,
        still: fast || reduced(), instant: fast,
        onDone: () => (fast ? schedule(done, DELAY.roll) : done())
      });
    } catch (e) { done(); }
  }

  // 先攻・後攻のサイコロの結果を見せる
  function showInitiative(ev, r) {
    const rows = ev.rolls.map(([p, c]) => {
      const mine = bt.me === 'player' ? p : c;
      const theirs = bt.me === 'player' ? c : p;
      return `<div class="init-row"><span class="dice mini">${mine}</span><span>あなた</span><span class="vs">対</span><span>${esc(whoName(bt.foe))}</span><span class="dice mini cpu">${theirs}</span>${p === c ? '<span class="muted">同じ数→振り直し</span>' : ''}</div>`;
    }).join('');
    const first = ev.first === bt.me;
    openModal(`<h3>先攻・後攻のサイコロ</h3>${rows}
      <p class="init-result ${first ? 'win' : ''}">${first ? 'あなたの先攻です' : `${esc(whoName(bt.foe))}の先攻です`}</p>
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close="1">決闘開始</button></div>`,
    { kind: 'initiative', onClose: () => { if (bt.state && bt.state.phase !== 'initiative') afterAction(r, 0); } });
    schedule(() => { if (U.ui.modal && U.ui.modal.kind === 'initiative') closeModal(true); }, DELAY.initiative);
  }

  /* ---------- モーダル ---------- */
  function unitButtons(side, idxs, opts) {
    const s = bt.state;
    opts = opts || {};
    return '<div class="target-list">' + idxs.map(i => {
      const u = s.teams[side][i];
      const ch = E.unitChar(u);
      const sel = opts.selected && opts.selected.indexOf(i) >= 0;
      return `<button type="button" class="target-btn${sel ? ' selected' : ''}" data-target="${i}"${u.hp <= 0 ? ' disabled' : ''}>
        ${emblem(ch, u, 'small')}<span class="t-main"><b>${esc(ch.name)}</b> ${levelTag(u.level || 1)} ${s.phase === 'formation' ? '' : statusBadges(s, side, i)}<br>${hpText(u)} ${elementTag(ch)}${subTags(ch)}</span>${sel ? '<span class="t-check">✓</span>' : ''}</button>`;
    }).join('') + '</div>';
  }

  /* ---------- 出撃準備（前衛・後衛の配置とリーダー） ----------
   * 短いタップ（クリック・Enter）でリーダー、ドラッグで前衛⇄後衛の入れ替え。
   * タッチは長押ししてから動かす（すぐ動かした場合は縦スクロールとして扱う）。
   * ドラッグできない環境向けに「タップで入れ替え」モードも用意する。 */
  const CROWN = '<svg class="crown" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 15L1 4l6 5 5-8 5 8 6-5-1 11z" fill="#d9ad45" stroke="#7a5418" stroke-width="1.2" stroke-linejoin="round"/><rect x="2" y="15" width="20" height="2.4" rx="1" fill="#b98a2c"/></svg>';

  function showFormationModal() {
    const s = bt.state, side = bt.me, team = s.teams[side];
    const need = E.frontRequired(s, side);
    if (!bt.fmDraft) {
      const sug = E.suggestFormation(s, side, bt.opts && bt.opts.formation);
      bt.fmDraft = { slots: sug.front.concat(sug.back), leader: sug.leader };
    }
    const fm = bt.fmDraft;
    let swapMode = false, swapPick = null;
    const posOf = i => (fm.slots.indexOf(i) < need ? 'front' : 'back');
    // 前衛と後衛の2体で、前衛に出る側が戦えるときだけ入れ替えられる
    const canSwap = (a, b) => {
      if (a === b || posOf(a) === posOf(b)) return false;
      const toFront = posOf(a) === 'back' ? a : b;
      return team[toFront].hp > 0;
    };
    const swap = (a, b) => {
      const ia = fm.slots.indexOf(a), ib = fm.slots.indexOf(b);
      fm.slots[ia] = b; fm.slots[ib] = a;
    };

    const card = i => {
      const u = team[i], ch = E.unitChar(u);
      const lead = fm.leader === i, ko = u.hp <= 0;
      const hp = u.hp < u.maxHp ? `${u.hp}/${u.maxHp}` : `${u.maxHp}`;
      return `<button type="button" class="fm-card el-frame${lead ? ' leader' : ''}${ko ? ' ko' : ''}${swapPick === i ? ' picked' : ''}" ${frameAttrs(ch)} data-idx="${i}" data-pos="${posOf(i)}" aria-pressed="${lead}"
        aria-label="${esc(ch.name)} ★${E.starsOf(ch.id) || ''} Lv${u.level || 1} HP${hp}${lead ? '（リーダー）' : ''}${ko ? '（戦闘不能）' : ''}">
        <span class="fm-art">${portrait(ch, { zoom: true })}${elMark(ch)}${lead ? `<span class="fm-lead">${CROWN}リーダー</span>` : ''}${ko ? '<span class="fm-ko">戦闘不能</span>' : ''}</span>
        <span class="fm-name">${esc(ch.name)}${starsHtml(ch)}</span>
        <span class="fm-stats"><span>Lv${u.level || 1}</span><span>HP ${hp}</span></span>${hpBar(u)}</button>`;
    };

    const draw = () => {
      const front = fm.slots.slice(0, need), back = fm.slots.slice(need);
      const lch = E.unitChar(team[fm.leader]);
      $('#modal-body').innerHTML = `<div class="fm-sheet">
        <header class="fm-head">
          ${foeIsCpu() ? '<button type="button" class="fm-back" id="btn-formation-x" aria-label="戦闘をやめて戻る">‹</button>' : ''}
          <div class="fm-title"><h3>出撃準備</h3>
            <p class="fm-hint">${swapMode ? '入れ替える前衛と後衛を1体ずつタップ'
              : '<span class="hint-touch">タップでリーダー選択／長押ししてドラッグで配置交換</span><span class="hint-mouse">クリックでリーダー選択／ドラッグで配置交換</span>'}</p></div>
          <button type="button" class="fm-mode" id="btn-fm-swapmode" aria-pressed="${swapMode}">⇄ ${swapMode ? '入れ替え中' : 'タップで入れ替え'}</button>
        </header>
        <h4 class="fm-row-title">前衛<small>攻撃を受ける${need}体</small></h4>
        ${need < CONFIG.FRONT_SIZE ? `<p class="fm-note">戦えるキャラが少ないため、前衛は${need}体です</p>` : ''}
        <div class="fm-grid" data-row="front">${front.map(card).join('')}</div>
        <div class="fm-divider" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5l10 10M19 5L9 15M13 17l4-4M11 17l-4-4M16 16l3 3M8 16l-3 3"/></svg></div>
        <h4 class="fm-row-title">後衛<small>控えの${back.length}体</small></h4>
        <div class="fm-grid" data-row="back">${back.map(card).join('')}</div>
        <div class="fm-foot">
          <div class="fm-leader" aria-live="polite">${CROWN}<div><b>リーダー：${esc(lch.name)}</b><span>「${esc(lch.leaderSkill.name)}」${esc(lch.leaderSkill.text)}</span></div></div>
          <button type="button" class="fm-go" id="btn-formation-ok">この配置で出撃</button>
          ${foeIsCpu() ? '<button type="button" class="fm-backlink" id="btn-formation-back">戻る</button>' : ''}
        </div></div>`;
      const sheet = $('#modal-body .fm-sheet');
      sheet.addEventListener('click', onClick);
      sheet.querySelector('#btn-fm-swapmode').addEventListener('click', () => { swapMode = !swapMode; swapPick = null; draw(); });
      // 前の画面（結果など）のボタンの連打が、出撃・戻るに当たらないようにする
      sheet.querySelector('#btn-formation-ok').addEventListener('click', () => { if (!U.tapGuarded()) confirm(); });
      sheet.querySelectorAll('#btn-formation-back, #btn-formation-x').forEach(b => b.addEventListener('click', () => {
        if (U.tapGuarded()) return;
        closeModal(true); stop(); if (bt.opts.onExit) bt.opts.onExit();
      }));
    };

    function onClick(e) {
      const c = e.target.closest('.fm-card');
      if (!c) return;
      if (dragger.suppressed()) return; // ドラッグ直後のクリックではリーダーを変えない
      const i = Number(c.dataset.idx);
      if (swapMode) {
        if (swapPick === null || swapPick === i) swapPick = swapPick === i ? null : i;
        else if (canSwap(swapPick, i)) { swap(swapPick, i); swapPick = null; }
        else { toast(posOf(swapPick) === posOf(i) ? '前衛と後衛のカードを1体ずつ選んでください' : '戦闘不能のキャラは前衛に出せません'); return; }
      } else fm.leader = i;
      draw();
      const again = $(`#modal-body .fm-card[data-idx="${i}"]`);
      if (again && e.detail === 0) again.focus(); // キーボード操作ではフォーカスを保つ
    }

    function confirm() {
      if (dragger.busy()) return;
      const front = fm.slots.slice(0, need);
      if (bt.opts && bt.opts.onFormation) bt.opts.onFormation({ front: front.map(i => team[i].charId), leader: team[fm.leader].charId });
      perform('formation', { front, leader: fm.leader });
    }

    // ドラッグは #modal-body に1つだけ付け、画面を閉じたら外す
    const dragger = U.cardDrag($('#modal-body'), {
      selector: '#modal-body .fm-card', ghostClass: 'fm-ghost',
      enabled: () => !swapMode,
      canDrop: (c, t) => canSwap(Number(c.dataset.idx), Number(t.dataset.idx)),
      onDrop: (c, t) => { swap(Number(c.dataset.idx), Number(t.dataset.idx)); draw(); }
    });
    openModal('', { closable: false, kind: 'formation', onClose: () => dragger.destroy() });
    draw();
  }

  function showReplaceModal() {
    const s = bt.state;
    const need = s.pendingReplace.need;
    openModal(`<h3>前衛を補充する</h3>
      <p class="muted">前衛が戦闘不能になりました。空いた前衛枠に出す後衛を選んでください（あと<b class="gold">${need}</b>体）。補充ではターンや交代回数を消費せず、直前の攻撃も受けません。</p>
      ${unitButtons(bt.me, E.backAlive(s, bt.me))}`, {
      closable: false, kind: 'replace',
      bind: body => body.querySelectorAll('[data-target]').forEach(b =>
        b.addEventListener('click', () => perform('replace', { unit: Number(b.dataset.target) })))
    });
  }

  function showMoveConfirm(idx) {
    const s = bt.state;
    const draw = () => {
      const u = s.teams[bt.me][idx];
      const ch = E.unitChar(u);
      const reason = bt.locked || bt.waiting ? '処理中です' : E.moveBlockReason(s, bt.me, idx);
      const p = s.dice ? E.previewMove(s, bt.me, idx) : null;
      $('#modal-body').innerHTML = `<h3>通常技の確認</h3>
        <div class="uc-head">${emblem(ch, u)}<div><b>${esc(ch.name)}</b> ${levelTag(u.level || 1)}（${elementTag(ch)}）<div class="muted">前衛から1体だけ技を使います</div></div></div>
        ${p ? `<div class="effect-box"><div class="big">${s.dice}「${esc(p.move.name)}」</div>${previewChips(p)}</div>` : ''}
        <p class="muted">使った後はこのターンの交代・スキルはできません。最後に四捨五入した値です。</p>
        <div class="modal-actions">
          ${reason ? `<div class="reason">${esc(reason)}</div>` : '<button type="button" class="btn btn-primary btn-block" id="btn-confirm-move">この技で確定する</button>'}
          <button type="button" class="btn btn-ghost btn-block" data-close="1">キャンセルして選び直す</button>
        </div>`;
      const c = $('#modal-body').querySelector('#btn-confirm-move');
      if (c) c.addEventListener('click', () => { c.disabled = true; perform('move', { unit: idx }); });
    };
    openModal('', { kind: 'move', refresh: draw });
    draw();
  }

  // 固有スキルの効果を対象別に（Engine.previewSkill と同じ計算）
  function skillPreviewLines(side, idx) {
    const s = bt.state;
    return E.previewSkill(s, side, idx).map(p => {
      if (p.type === 'damage') return `<div class="pv-line"><span class="pv-range dmg">敵前衛全員</span><span class="pv-base">${p.base}ダメージ${p.ignoreDefense ? '（防御・属性無視）' : '（属性倍率なし・結界有効）'}</span></div><div class="chips">${p.targets.map(t => `<span class="chip dmg">${esc(t.name)} <b>-${t.damage}</b>${t.barrier ? ' <i class="adv">結界で半減</i>' : ''}</span>`).join('')}</div>`;
      if (p.type === 'heal') return `<div class="pv-line"><span class="pv-range heal">味方前衛全員</span><span class="pv-base">回復${p.base}${p.percent < 100 ? `（疲労${p.percent}%で${p.amount}）` : ''}</span></div><div class="chips">${p.targets.map(t => `<span class="chip heal">${esc(t.name)} <b>+${t.effective}</b></span>`).join('')}</div>`;
      if (p.type === 'barrier') return `<div class="pv-line"><span class="pv-range heal">味方前衛全員</span><span class="pv-base">結界（次の防御可能なダメージ1回を半減）</span></div><div class="chips">${p.targets.map(t => `<span class="chip">${esc(t.name)} ${t.already ? '（すでに結界あり）' : '<b>結界</b>'}</span>`).join('')}</div>`;
      if (p.type === 'atkMultiplier') return `<div class="pv-line"><span class="pv-range">このターンの通常技</span>攻撃 ×${p.value}（回復は変わらない）</div>`;
      if (p.type === 'atkBonus') return `<div class="pv-line"><span class="pv-range">このターンの通常技</span>攻撃 +${p.value}（攻撃0の技は除く）</div>`;
      if (p.type === 'fatigueReset') return `<div class="pv-line"><span class="pv-range heal">味方</span>${p.used ? '回復疲労はこの戦闘ではもう消せない（1戦に1回）' : p.notYet ? 'まだ回復疲労がないので、疲労を消す力は取っておく（疲労してから使うと消せる）' : `回復疲労をなくす（今の回復${p.percent}%→${p.after}%・1戦に1回）`}</div>`;
      if (p.type === 'reroll') return `<div class="pv-line"><span class="pv-range">出目</span>${s.dice || '？'} を振り直す（同じ数字の可能性あり）</div>`;
      if (p.type === 'chooseDice') return `<div class="pv-line"><span class="pv-range">出目</span>${s.dice || '？'} → 下で選んだ数字</div>`;
      return '';
    }).join('');
  }
  // 対象範囲を短く
  function skillRange(ch) {
    const t = ch.skill.effects.map(e => ({ damage: '敵前衛全員', heal: '味方前衛全員', barrier: '味方前衛全員', atkMultiplier: 'このターンの通常技', atkBonus: 'このターンの通常技', reroll: '出目', chooseDice: '出目', fatigueReset: '味方の回復疲労' }[e.type]) || '');
    return t.filter((x, i) => x && t.indexOf(x) === i).join('・');
  }

  // 長押し：そのキャラの通常技（出目1〜6）。今の出目と、前衛なら出目の技の効果も
  function showMovesPeek(side, idx) {
    const s = bt.state;
    if (!s) return;
    const u = s.teams[side][idx];
    const ch = E.unitChar(u);
    const acting = side === bt.me && myActing(s) && E.isFront(s, side, idx);
    const p = acting ? E.previewMove(s, side, idx) : null;
    openModal(`<h3>${esc(ch.name)}${starsHtml(ch)} の通常技</h3>
      <p class="muted">出目1〜6に対応する技です。攻撃は敵前衛全員、回復は味方前衛全員に入ります。技の数字×攻撃力（${u.atkPow || E.charPower(u.charId, u.level || 1).atk}）がダメージ、×回復力（${u.healPow || E.charPower(u.charId, u.level || 1).heal}）が回復量です。</p>
      ${movesList(ch, s.dice && (side === bt.me ? s.turnSide === bt.me : s.turnSide === side) ? s.dice : null, u.loadout)}
      ${p ? `<div class="effect-box"><b>今の出目 ${s.dice}「${esc(p.move.name)}」</b>${previewChips(p)}</div>` : ''}
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button></div>`, { kind: 'moves' });
  }

  // 固有スキルの主な効果（大きく見せる1行）・効き目の長さ・効果の種類
  const SKILL_KIND = {
    atkMultiplier: { icon: '⚔', when: 'このターンだけ' }, atkBonus: { icon: '⚔', when: 'このターンだけ' },
    heal: { icon: '✚', when: 'すぐ（その場で回復）' }, barrier: { icon: '◈', when: '防げるダメージを1回受けるまで' },
    damage: { icon: '✦', when: 'すぐ（その場でダメージ）' }, reroll: { icon: '⟳', when: 'すぐ' }, chooseDice: { icon: '✧', when: 'すぐ（このターンの出目）' }, fatigueReset: { icon: '❖', when: 'この戦闘で1回だけ' }
  };
  function skillHeadline(side, idx) {
    const s = bt.state;
    const mine = side === bt.me;
    const pv = E.previewSkill(s, side, idx);
    return pv.map(p => {
      let big = '', sub = '';
      if (p.type === 'atkMultiplier') { big = `攻撃 ×${atkNum(p.value)}`; sub = '回復量は変わりません'; }
      else if (p.type === 'atkBonus') { big = `攻撃 +${p.value}`; sub = '攻撃0の技は除く・回復量は変わりません'; }
      else if (p.type === 'heal') { big = `回復 ${p.amount}`; sub = p.percent < 100 ? `回復疲労${p.percent}%（もとは${p.base}）` : '味方前衛全員それぞれ'; }
      else if (p.type === 'barrier') { big = '結界'; sub = `次に受ける防げるダメージ1回を${Math.round(CONFIG.BARRIER_MULTIPLIER * 100)}%に`; }
      else if (p.type === 'damage') { big = `ダメージ ${p.base}`; sub = p.ignoreDefense ? '敵前衛全員・防御と属性を無視' : '敵前衛全員・属性倍率なし・結界は有効'; }
      else if (p.type === 'chooseDice') { big = '出目を選ぶ'; sub = mine && s.dice ? `今の出目 ${s.dice} を、1〜6の好きな数字に変える` : '確定した出目を、1〜6の好きな数字に変える'; }
      else if (p.type === 'reroll') { big = '振り直し'; sub = mine && s.dice ? `今の出目 ${s.dice} を振り直す` : '確定した出目を振り直す'; }
      else if (p.type === 'fatigueReset') { big = '疲労回復'; sub = p.used ? 'この戦闘ではもう使えない（1戦に1回）' : p.notYet ? 'まだ疲労なし（使わずに取っておく）' : `回復${p.percent}% → ${p.after}%`; }
      return { type: p.type, big, sub, icon: (SKILL_KIND[p.type] || {}).icon || '✦', when: (SKILL_KIND[p.type] || {}).when || '' };
    });
  }

  // キャラの詳細＝固有スキルの確認画面。キャラの絵と技名を主役に、効果・対象・効き目・使えるかを整理する
  // 味方で使えるときだけ発動ボタン（技名入り）。交代は補助の操作としてここにも置く。文字・数値はすべてゲームのデータから
  function showDetailModal(side, idx) {
    const draw = () => {
      const s = bt.state;
      const u = s.teams[side][idx];
      const ch = E.unitChar(u);
      const el = E.ELEMENTS[ch.element] || { name: ch.element };
      const mine = side === bt.me;
      const busy = bt.locked || bt.waiting;
      const skillReason = !mine ? null : busy ? '処理中です' : u.hp <= 0 ? '戦闘不能のため使えません' : E.skillBlockReason(s, bt.me, idx);
      const isLeader = s.leader && s.leader[side] === idx && !(side === bt.foe && s.phase === 'formation');
      const inFront = E.isFront(s, side, idx);
      const stars = E.starsOf(ch.id);
      const boss = E.isBoss(ch.id);
      const heads = skillHeadline(side, idx);
      const whens = heads.map(h => h.when).filter((w, k, a) => w && a.indexOf(w) === k);
      // 待ち時間（クールダウン）：使えるなら「使用後の待ち時間」、待機中なら「あと○ターン」
      const cdHtml = u.hp <= 0 ? '<span class="sk-cd off">戦闘不能</span>'
        : u.cd > 0 ? `<span class="sk-cd wait"><i aria-hidden="true">⌛</i>待機中：あと <b>${u.cd}</b> ターン</span><span class="sk-cd-sub">クールダウン ${ch.skill.cd}ターン</span>`
          : `<span class="sk-cd ok"><i aria-hidden="true">⌛</i>使用可能</span><span class="sk-cd-sub">使用後の待ち時間（クールダウン）：${ch.skill.cd}ターン</span>`;
      // 交代（補助）：前衛なら生存している後衛、後衛なら生存している前衛と
      let swapHtml = '';
      if (mine && u.hp > 0 && s.phase !== 'formation' && s.phase !== 'over') {
        const swapReason = busy ? '処理中です' : E.swapBlockReason(s, bt.me);
        const partners = inFront ? E.backAlive(s, bt.me) : E.frontAlive(s, bt.me);
        swapHtml = `<div class="sk-swap"><div class="sk-swap-head"><span>交代</span><small>${inFront ? '後衛' : '前衛'}と入れ替える（HP・待ち時間はそのまま／ドラッグでもできます）</small></div>${swapReason
          ? `<p class="reason sk-small">今は交代できません：${esc(swapReason)}</p>`
          : `<div class="sk-swap-list">${partners.map(j => { const v = s.teams[bt.me][j]; const c2 = E.unitChar(v); return `<button type="button" class="target-btn sk-swap-btn" data-swap-with="${j}">${emblem(c2, v, 'small')}<span class="t-main"><b>${esc(c2.name)}</b><br>${hpText(v)}</span></button>`; }).join('')}</div>`}</div>`;
      }
      const castable = mine && !skillReason;
      // 出目を選ぶスキル：1〜6の面から選ぶ。選んだ数字にしたときの前衛の技も見せる（Engine.previewMove と同じ計算）
      const choose = ch.skill.effects.some(e => e.type === 'chooseDice');
      const picked = bt.pickDice && bt.pickDice.idx === idx ? bt.pickDice.n : null;
      let pickHtml = '';
      if (choose && castable) {
        const fronts = E.frontAlive(s, bt.me);
        const pv = picked ? fronts.map(i => { const p = E.previewMove(s, bt.me, i, picked); const c2 = E.unitChar(s.teams[bt.me][i]);
          return `<li><b>${esc(c2.name)}</b>「${esc(p.move.name)}」<span>${p.move.atk > 0 ? `攻撃${atkNum(p.boosted)}` : ''}${p.move.atk > 0 && p.move.heal > 0 ? '・' : ''}${p.move.heal > 0 ? `回復${p.heals.length ? p.heals[0].amount : p.healBase}` : ''}${!p.move.atk && !p.move.heal ? '効果なし' : ''}</span></li>`; }).join('') : '';
        pickHtml = `<div class="sk-pick"><div class="sk-pick-head">変える数字を選ぶ<small>今の出目：${s.dice}</small></div>
          <div class="sk-pick-row" role="radiogroup" aria-label="出目を選ぶ">${[1, 2, 3, 4, 5, 6].map(n => `<button type="button" class="sk-die${picked === n ? ' on' : ''}${s.dice === n ? ' now' : ''}" data-n="${n}" data-pick-dice="${n}" role="radio" aria-checked="${picked === n}" aria-label="${n}にする"></button>`).join('')}</div>
          ${picked ? `<ul class="sk-pick-pv">${pv}</ul>` : '<p class="sk-small">数字を選ぶと、前衛の技がどうなるか表示します。</p>'}</div>`;
      }
      $('#modal-body').innerHTML = `<div class="sk" data-el="${esc(ch.element)}">
        <div class="sk-hero${boss ? ' boss' : ''}">${portrait(ch)}
          <div class="sk-plate">
            <h3 class="sk-cname">${esc(ch.name)}</h3>
            <div class="sk-cmeta">${stars ? `<span class="stars">${'★'.repeat(stars)}</span>` : (boss ? `<span class="badge boss">${esc(ch.rank || 'ボス')}</span>` : '')}${elMark(ch)}<span>${esc(el.name)}</span>${levelTag(u.level || 1)}</div>
            <div class="sk-hp">${hpBar(u)}${hpText(u)}</div>
            <div class="sk-badges">${statusBadges(s, side, idx)}</div>
          </div>
        </div>
        <div class="sk-body">
          <div class="sk-label"><span>固有スキル</span></div>
          <h4 class="sk-name">${esc(ch.skill.name)}</h4>
          <p class="sk-text">${esc(ch.skill.text)}</p>
          <div class="sk-heads">${heads.map(h => `<div class="sk-head" data-type="${h.type}"><span class="sk-ico" aria-hidden="true">${h.icon}</span><div><b>${esc(h.big)}</b><small>${esc(h.sub)}</small></div></div>`).join('')}</div>
          <dl class="sk-facts"><div><dt>対象</dt><dd>${esc(skillRange(ch))}</dd></div><div><dt>効き目</dt><dd>${esc(whens.join('・'))}</dd></div><div><dt>使える場所</dt><dd>前衛・後衛どちらからでも</dd></div></dl>
          <div class="sk-cdrow">${cdHtml}</div>
          ${mine && u.hp > 0 ? `<div class="dt-preview sk-preview">${skillPreviewLines(side, idx)}</div>` : ''}
          ${pickHtml}
          ${castable ? `<button type="button" class="sk-cast" id="btn-use-skill" data-el="${esc(ch.element)}"${choose && !picked ? ' disabled' : ''}><span class="sk-crest" aria-hidden="true"><i></i></span><span class="sk-cast-text">${esc(ch.skill.name)}を発動${choose ? `<small class="sk-cast-sub">${picked ? `出目を ${picked} にする` : '先に数字を選んでください'}</small>` : ''}</span></button>` : ''}
          ${mine && skillReason ? `<p class="reason sk-reason">今は使えません：${esc(skillReason)}${u.cd > 0 ? `（あと ${u.cd} ターン）` : ''}</p>` : ''}
          ${!mine ? '<p class="muted sk-small">相手のキャラです（情報の確認のみ）。</p>' : ''}
          ${swapHtml}
          <details class="dt-more sk-more"><summary>通常技（出目1〜6）・リーダースキル</summary>
            ${movesList(ch, mine && myActing(s) && inFront ? s.dice : null, u.loadout)}
            ${traitBox(ch)}
            ${ch.leaderSkill ? leaderBox(ch, isLeader ? 'このチームのリーダー（発動中）' : '') : '<p class="muted">ダンジョンの敵です（リーダースキルなし）。</p>'}
          </details>
          <div class="modal-actions sk-close"><button type="button" class="btn btn-ghost btn-block" data-close="1">閉じる</button></div>
        </div>
      </div>`;
      const b = $('#modal-body');
      const use = b.querySelector('#btn-use-skill');
      if (use) use.addEventListener('click', () => {
        if (use.disabled) return;
        // 押した反応：ボタンが沈み、紋章が光る。受理されたら閉じる（無効・失敗なら成功の演出は出さない）
        use.disabled = true;
        use.classList.add('pressed');
        const ok = perform('skill', choose ? { user: idx, dice: picked } : { user: idx });
        if (ok) bt.pickDice = null;
        if (!ok && use.isConnected) { use.disabled = false; use.classList.remove('pressed'); }
      });
      b.querySelectorAll('[data-swap-with]').forEach(t => t.addEventListener('click', () => {
        const j = Number(t.dataset.swapWith);
        perform('swap', inFront ? { out: idx, in: j } : { out: j, in: idx });
      }));
      b.querySelectorAll('[data-pick-dice]').forEach(t => t.addEventListener('click', () => {
        bt.pickDice = { idx, n: Number(t.dataset.pickDice) };
        const y = $('#modal .modal-box').scrollTop;
        draw();
        $('#modal .modal-box').scrollTop = y;
      }));
    };
    bt.pickDice = null;
    openModal('', { kind: 'detail', refresh: draw });
    draw();
  }

  function showSurrenderConfirm() {
    const pvp = bt.mode !== 'cpu';
    openModal(`<h3>${pvp ? '降参して退出' : '戦闘をやめる'}</h3>
      <p>${pvp ? '降参すると相手の勝利になります。' : 'この戦闘は敗北として終わります。'}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block btn-danger" id="btn-surrender-ok">${pvp ? '降参する' : '敗北として終える'}</button>
        <button type="button" class="btn btn-ghost btn-block" data-close="1">続ける</button>
      </div>`, { kind: 'surrender', bind: b => b.querySelector('#btn-surrender-ok').addEventListener('click', () => { closeModal(true); surrender(); }) });
  }

  /* ---------- イベント登録 ---------- */
  function bind() {
    Dice.mount($('#dice-stage'));
    // 中央のサイコロ＝数字を出す（決着後は結果を見る）
    // 振る：サイコロをつかんで投げる（スワイプ・フリック）か、タップ・クリック（標準の勢い）。投げ方は Engine に渡して出目を決める
    const canThrow = () => {
      const s = bt.state;
      return !!s && bt.active && !bt.locked && !bt.waiting && !bt.diceAnim && !U.ui.modal
        && s.turnSide === bt.me && s.phase === 'roll';
    };
    Dice.bindThrow({ canThrow, onThrow: t => perform('roll', t ? { throw: t } : {}) });
    // キーボード（Enter・スペース）は標準の勢いで振る。指・マウスの操作は上で扱うので、ここでは受けない
    $('#btn-roll').addEventListener('click', e => {
      if (!bt.state) return;
      if (bt.state.phase === 'over') { if (bt.opts && bt.opts.onShowResult) bt.opts.onShowResult(); return; }
      if (e.detail === 0 && canThrow()) perform('roll', {});
    });
    $('#btn-battle-menu').addEventListener('click', showBattleMenu);
    // 前衛⇄後衛のドラッグ交代（判定はすべて Engine。対人戦のゲストはホストに依頼し、結果の状態で描き直す）
    const layout = $('#screen-battle .bt-layout');
    const dragger = U.cardDrag(layout, {
      selector: '#screen-battle .bt-card.mine:not(.ko)', ghostClass: 'bt-ghost', ignore: '[data-move]',
      holdSelector: '#screen-battle .bt-card[data-idx]',
      onHold: c => showMovesPeek(c.dataset.side, Number(c.dataset.idx)),
      enabled: () => !!bt.state && bt.active,
      canStart: () => {
        const s = bt.state;
        if (s.turnSide !== bt.me || (s.phase !== 'roll' && s.phase !== 'action')) return `${whoName(bt.foe)}のターンです`;
        if (bt.locked || bt.waiting) return '処理中です';
        const r = E.swapBlockReason(s, bt.me);
        return r ? '交代できません：' + r : null;
      },
      canDrop: (c, t) => c.dataset.pos !== t.dataset.pos,
      onDrop: (c, t) => {
        const a = Number(c.dataset.idx), b = Number(t.dataset.idx);
        const out = c.dataset.pos === 'front' ? a : b, inn = c.dataset.pos === 'front' ? b : a;
        perform('swap', { out, in: inn });
      }
    });
    // カードの技欄＝通常技、絵（そのほか）＝詳細。1回のクリックでどちらか一方だけ
    const cardClick = e => {
      if (U.tapGuarded() || dragger.suppressed() || !bt.state) return;
      const mv = e.target.closest('[data-move]');
      if (mv) {
        if (!mv.disabled && !bt.locked && !bt.waiting) showMoveConfirm(Number(mv.dataset.move));
        return;
      }
      const card = e.target.closest('.bt-card[data-idx]');
      if (card && card.dataset.veiled) { toast('相手の後衛はまだ分かりません（前衛に出るか、固有スキルを使うと分かります）'); return; }
      if (card) showDetailModal(card.dataset.side, Number(card.dataset.idx));
    };
    ['#ally-front', '#ally-back', '#enemy-front', '#enemy-back'].forEach(sel => $(sel).addEventListener('click', cardClick));
    layout.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.bt-art[role="button"]')) { e.preventDefault(); e.target.click(); }
    });
    U.ui.onModalClose = () => { if (bt.active && bt.state && bt.state.phase === 'over') renderCenter(); };
  }

  window.RikuyouBattle = {
    bind, start, stop,
    isActive: () => bt.active,
    // テスト・デバッグ用（ゲーム進行には使わない）
    getState: () => bt.state,
    lastRoll: () => bt.lastRoll || null,
    skillShows: () => bt.skillShows || 0,
    isLocked: () => bt.locked || bt.waiting,
    getSession: () => bt.session,
    me: () => bt.me,
    mode: () => bt.mode
  };
})();
