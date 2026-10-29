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
  const { E, CONFIG, DELAY, rng, $, esc, emblem, elMark, portrait, elementTag, subTags, hpBar, hpText, levelTag, movesList, leaderBox, openModal, closeModal, toast } = U;

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
    fmDraft: null    // 準備画面で並べ中の配置（{ slots, leader }）。対人戦で依頼が戻されたときも引き継ぐ
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
    bt.lastLogs = [];
    bt.active = false;
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
    $('#screen-battle').dataset.bg = opts.bg || 'arena'; // 背景（ダンジョンごと）。操作部分の位置は共通
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
      case 'roll': return E.roll(state, side, rng);
      case 'swap': return E.swap(state, side, a.out, a.in);
      case 'skill': return E.useSkill(state, side, a.user, rng);
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
    const rollEv = r.events.find(e => e.type === 'roll');
    const initEv = r.events.find(e => e.type === 'initiative');
    if (initEv) { showInitiative(initEv, r); return; }
    if (rollEv) {
      animateDice(rollEv.value, rollEv.side, () => afterAction(r, rollEv.side === bt.me && !rollEv.reroll ? 0 : undefined));
      return;
    }
    void fromRoom;
    afterAction(r);
  }

  function afterAction(r, delay) {
    if (r.logs && r.logs.length) bt.lastLogs = r.logs.filter(l => l.kind !== 'turn').slice(-8);
    render();
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
    if (s.phase === 'over') { bt.locked = true; render(); if (!bt.finished) { bt.finished = true; schedule(finish, DELAY.result); } return; }
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
    if (u.barrier) b.push('<span class="badge barrier">結界</span>');
    if (u.hp > 0) b.push(u.cd > 0 ? `<span class="badge cd">CD残${u.cd}</span>` : '<span class="badge ready">スキル可</span>');
    return b.join('');
  }

  const myActing = s => s && s.turnSide === bt.me && s.phase === 'action' && !!s.dice && !bt.diceAnim && !s.moveUsed;

  // 対象別の効果（Engine.previewMove と同じ計算）
  function previewChips(p) {
    let html = '';
    if (p.attacks.length) {
      const b = p.boosted !== p.move.atk ? `（強化後${p.boosted}）` : '';
      html += `<div class="pv-line"><span class="pv-range dmg">敵前衛全員</span><span class="pv-base">攻撃${p.move.atk}${b}</span></div><div class="chips">` +
        p.attacks.map(a => `<span class="chip dmg">${esc(a.name)} <b>-${a.damage}</b>${a.advantage ? ` <i class="adv">属性有利 ×${CONFIG.ADVANTAGE_MULTIPLIER}</i>` : ''}${a.barrier ? ' <i class="adv">結界で半減</i>' : ''}</span>`).join('') + '</div>';
    } else if (p.move.atk > 0) {
      html += '<div class="pv-line muted">攻撃できる敵前衛がいません</div>';
    }
    if (p.heals.length) {
      const f = p.healPercent < 100 ? `（疲労${p.healPercent}%で${p.heals[0].amount}）` : '';
      html += `<div class="pv-line"><span class="pv-range heal">味方前衛全員</span><span class="pv-base">回復${p.healBase}${f}</span></div><div class="chips">` +
        p.heals.map(h => `<span class="chip heal">${esc(h.name)} <b>+${h.effective}</b></span>`).join('') + '</div>';
    }
    if (!p.move.atk && !p.move.heal) html += '<div class="pv-line muted">何も起こらない</div>';
    return html;
  }

  // HPの状態：色だけでなく文字（ピンチ）でも示す
  const hpState = u => (u.hp <= 0 ? 'ko' : u.hp / u.maxHp <= 0.25 ? 'low' : u.hp / u.maxHp <= 0.5 ? 'mid' : '');
  const hpNum = u => `<span class="bt-hp"><b>${u.hp}</b>/${u.maxHp}</span>`;

  function unitCard(side, i, kind) {
    const s = bt.state;
    const u = s.teams[side][i];
    const ch = E.unitChar(u);
    const hidden = side === bt.foe && s.phase === 'formation';
    const mine = side === bt.me;
    const st = hpState(u);
    const lead = !hidden && s.leader && s.leader[side] === i;
    const tags = [];
    if (lead) tags.push('<span class="bt-tag lead" title="リーダー"><svg viewBox="0 0 24 18" aria-hidden="true"><path d="M2 15L1 4l6 5 5-8 5 8 6-5-1 11z" fill="currentColor"/></svg><i>リーダー</i></span>');
    if (E.isBoss(u.charId)) tags.push(`<span class="bt-tag boss">${esc(ch.rank || 'ボス')}</span>`);
    if (u.barrier && u.hp > 0) tags.push('<span class="bt-tag barrier">結界</span>');
    const cd = u.hp > 0 && !hidden ? (u.cd > 0 ? `<span class="bt-cd" title="固有スキルの残りターン">⌛${u.cd}</span>` : (mine ? '<span class="bt-cd ok">スキル可</span>' : '')) : '';
    const label = `${ch.name} HP${u.hp}/${u.maxHp}${st === 'low' ? '（ピンチ）' : ''}${u.hp <= 0 ? '（戦闘不能）' : ''}${lead ? '（リーダー）' : ''}`;
    return `<div class="bt-card unit-card ${kind}${mine ? ' mine' : ''}${st ? ' hp-' + st : ''}${u.hp <= 0 ? ' ko' : ''}" data-side="${side}" data-idx="${i}" data-pos="${kind}" role="button" tabindex="0" aria-label="${esc(label)}（詳細）">
      <span class="bt-art">${portrait(ch, { zoom: true })}${elMark(ch)}<span class="bt-tags">${tags.join('')}</span>${u.hp <= 0 ? '<span class="bt-ko">戦闘不能</span>' : ''}${kind === 'back' ? hpNum(u) : ''}</span>
      ${kind === 'front' ? `<span class="bt-info"><span class="bt-name">${esc(ch.name)}</span><span class="bt-hpline">${hpNum(u)}${st === 'low' ? '<span class="bt-pinch">ピンチ</span>' : ''}${cd}</span>${hpBar(u)}</span>`
        : `${hpBar(u)}${cd ? `<span class="bt-backcd">${cd}</span>` : ''}`}
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
    $('#' + pre + '-back').innerHTML = backIds.map(i => unitCard(side, i, 'back')).join('');
    // 後衛がいない側（ボス）は「後衛」の見出しを隠す
    $('#' + pre + '-back').previousElementSibling.classList.toggle('hidden', !backIds.length);
    $('#' + pre + '-back').classList.toggle('hidden', !backIds.length);
    const l = s.leader[side];
    const hideLeader = side === bt.foe && s.phase === 'formation';
    const lc = l === null || l === undefined || hideLeader ? null : E.unitChar(s.teams[side][l]);
    $('#' + pre + '-leader').innerHTML = lc
      ? `<b>リーダー</b> ${esc(lc.name)}「${esc(lc.leaderSkill.name)}」<span>${esc(lc.leaderSkill.text)}</span>`
      : (s.teams[side].some(u => E.isBoss(u.charId)) ? '<span>ダンジョンの敵（リーダーなし）</span>' : '');
  }

  // 前衛の並びに合わせて、出目の通常技を3つ並べる（倒れた枠は空ける）
  function renderMoveOptions() {
    const s = bt.state;
    const box = $('#move-options');
    const slots = s.front[bt.me] || [];
    const note = $('#range-note');
    if (!myActing(s) || bt.waiting) {
      let msg = '';
      if (s.phase === 'roll' && s.turnSide === bt.me && !bt.waiting) msg = '数字を出すと、前衛3体の技が表示されます';
      else if (s.phase === 'roll' || s.phase === 'action') msg = s.turnSide === bt.me ? (s.moveUsed ? '' : '処理中…') : `${whoName(bt.foe)}のターン`;
      box.innerHTML = msg ? `<div class="mo-wait">${esc(msg)}</div>` : '';
      note.classList.add('hidden');
      return;
    }
    note.classList.remove('hidden');
    box.innerHTML = slots.map(i => {
      const u = s.teams[bt.me][i];
      if (u.hp <= 0) return '<div class="mo-empty" aria-hidden="true"></div>';
      const ch = E.unitChar(u);
      const p = E.previewMove(s, bt.me, i);
      const atk = p.move.atk > 0, heal = p.move.heal > 0;
      const healVal = p.heals.length ? p.heals[0].amount : p.healBase;
      const kind = atk && heal ? 'both' : atk ? 'atk' : heal ? 'heal' : 'none';
      const head = { both: '攻撃＋回復', atk: '攻撃技', heal: '回復技', none: '効果なし' }[kind];
      const main = kind === 'both' ? `攻${p.boosted}＋回${healVal}` : kind === 'atk' ? `攻撃 ${p.boosted}` : kind === 'heal' ? `回復 ${healVal}` : '—';
      return `<div class="mo-card" data-move-card="${i}">
        <button type="button" class="mo-btn ${kind} btn-pick-move" data-move="${i}"${bt.locked ? ' disabled' : ''} aria-label="${esc(ch.name)}の通常技「${esc(p.move.name)}」${esc(main)}">
          <span class="mo-kind">${head}</span><b class="mo-main">${esc(main)}</b><span class="mo-name">${s.dice}「${esc(p.move.name)}」</span></button>
      </div>`;
    }).join('');
  }

  function renderCenter() {
    const s = bt.state;
    const pct = E.healPercent(Math.max(1, s.round));
    $('#round-info').innerHTML = s.round > 0 ? `第<b>${s.round}</b>巡` : '準備中';
    $('#fatigue-info').innerHTML = pct < 100 ? `回復疲労：回復${pct}%` : '';
    const foe = whoName(bt.foe);
    let phase = '', sub = '';
    if (s.phase === 'formation') { phase = '戦闘準備'; sub = s.front[bt.me].length ? `${foe}が配置を決めています…` : '前衛とリーダーを決めてください'; }
    else if (s.phase === 'initiative') { phase = '先攻・後攻'; sub = 'サイコロで決めています…'; }
    else if (s.phase === 'over') { phase = s.winner === bt.me ? '勝利！' : '敗北…'; sub = '決着しました'; }
    else if (s.phase === 'replace') { phase = s.pendingReplace.side === bt.me ? '前衛の補充' : `${foe}のターン`; sub = s.pendingReplace.side === bt.me ? '後衛から前衛に出すキャラを選んでください' : `${foe}が前衛を補充しています…`; }
    else if (s.turnSide === bt.foe) { phase = `${foe}のターン`; sub = s.phase === 'roll' ? '数字を出しています…' : `出目 ${s.dice}：行動を考えています…`; }
    else if (bt.waiting) { phase = 'あなたのターン'; sub = '相手の端末に送信中…'; }
    else if (s.phase === 'roll') { phase = 'あなたのターン'; sub = '「数字を出す」を押してください'; }
    else if (bt.diceAnim) { phase = 'あなたのターン'; sub = '数字を出しています…'; }
    else if (s.moveUsed) { phase = 'あなたのターン'; sub = '行動しました'; }
    else { phase = 'あなたのターン'; sub = '使う技を選んでください'; }
    $('#phase-text').textContent = phase;
    $('#phase-sub').textContent = sub;
    $('#screen-battle').classList.toggle('my-turn', s.turnSide === bt.me && (s.phase === 'roll' || s.phase === 'action'));

    const dice = $('#dice');
    if (!bt.diceAnim) {
      dice.className = 'dice' + (s.dice ? '' : ' empty') + (s.turnSide === bt.foe && s.dice ? ' cpu' : '');
      dice.innerHTML = `<span>${s.dice || '？'}</span>`;
      dice.setAttribute('aria-label', s.dice ? `出目 ${s.dice}` : '数字はまだ出ていません');
    }
    const btn = $('#btn-roll');
    if (s.phase === 'over') {
      btn.disabled = !!U.ui.modal;
      btn.textContent = '結果を見る';
    } else {
      btn.disabled = bt.locked || bt.waiting || s.turnSide !== bt.me || s.phase !== 'roll';
      btn.textContent = (s.turnSide === bt.me && s.phase === 'action') ? '出目確定' : '数字を出す';
    }
    btn.classList.toggle('ready', !btn.disabled);
    const swapBtn = $('#btn-swap');
    const swapReason = bt.locked || bt.waiting ? '処理中' : E.swapBlockReason(s, bt.me);
    swapBtn.disabled = !!swapReason;
    swapBtn.querySelector('span').textContent = s.swapUsed && s.turnSide === bt.me ? '交代済み' : '交代';
    const active = !(s.phase === 'over' || s.phase === 'formation' || s.phase === 'initiative');
    $('#btn-skill-menu').disabled = !active;
    // 交代できるか・できない理由を短く出す
    const hint = $('#drag-hint');
    if (!active) hint.textContent = '';
    else if (!swapReason) hint.textContent = '長押しで後衛と交代できます';
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
    renderMoveOptions();
    renderSide(bt.me);
    renderLog();
    renderConnection();
    if (U.ui.modal && U.ui.modal.refresh) U.ui.modal.refresh();
  }

  /* ---------- 履歴・固有スキル・メニュー ---------- */
  function showLogModal() {
    openModal('', { kind: 'log', refresh: () => { const l = $('#modal-body .log'); if (l) l.innerHTML = logHtml(); } });
    $('#modal-body').innerHTML = `<h3>戦闘履歴</h3><p class="muted">新しい順</p><ol class="log log-full">${logHtml()}</ol>
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button></div>`;
  }
  // 固有スキル：6体のスキルと使える状態（後衛も使える）
  function showSkillList() {
    const draw = () => {
      const s = bt.state;
      const team = s.teams[bt.me];
      $('#modal-body').innerHTML = `<h3>固有スキル</h3>
        <p class="muted">前衛・後衛どちらのキャラも使えます。チーム全体で1ターン1回、通常技の前に使います。</p>
        <div class="target-list">${team.map((u, i) => {
          if (u.hp <= 0) return '';
          const ch = E.unitChar(u);
          const reason = bt.locked || bt.waiting ? '処理中です' : E.skillBlockReason(s, bt.me, i);
          return `<button type="button" class="target-btn skill-pick${reason ? ' unavailable' : ''}" data-skill="${i}">${emblem(ch, u, 'small')}
            <span class="t-main"><b>${esc(ch.skill.name)}</b> <span class="muted">${esc(ch.name)}・${E.isFront(s, bt.me, i) ? '前衛' : '後衛'}</span><br>
            <span class="muted">${esc(ch.skill.text)}</span>${reason ? `<br><span class="reason">${esc(reason)}</span>` : ''}</span></button>`;
        }).join('')}</div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost btn-block" data-close="1">閉じる</button></div>`;
      $('#modal-body').querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => showSkillModal(Number(b.dataset.skill))));
    };
    openModal('', { kind: 'skill-list', refresh: draw });
    draw();
  }
  function showBattleMenu() {
    const over = bt.state && bt.state.phase === 'over';
    openModal(`<h3>メニュー</h3>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-block" id="btn-menu-log">戦闘履歴</button>
        ${over ? '' : `<button type="button" class="btn btn-ghost btn-block btn-danger" id="btn-surrender">${bt.mode !== 'cpu' ? '降参して退出' : '戦闘をやめる'}</button>`}
        <button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button>
      </div>`, { kind: 'menu', bind: b => {
      b.querySelector('#btn-menu-log').addEventListener('click', showLogModal);
      const sr = b.querySelector('#btn-surrender');
      if (sr) sr.addEventListener('click', showSurrenderConfirm);
    } });
  }

  /* ---------- 演出 ---------- */
  function floatAt(el, text, cls, offset) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return;
    const n = document.createElement('div');
    n.className = 'fx-num ' + cls;
    n.textContent = text;
    n.style.left = Math.min(window.innerWidth - 30, Math.max(30, r.left + r.width / 2)) + 'px';
    n.style.top = Math.min(window.innerHeight - 20, Math.max(20, r.top + r.height / 2 + (offset || 0))) + 'px';
    $('#fx-layer').appendChild(n);
    setTimeout(() => n.remove(), 1200);
  }
  function flash(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  function playEvents(events) {
    const groups = [];
    events.forEach(ev => {
      if (ev.type !== 'damage' && ev.type !== 'heal' && ev.type !== 'barrier') return;
      const last = groups[groups.length - 1];
      if (last && last.type === ev.type && last.side === ev.side) last.list.push(ev);
      else groups.push({ type: ev.type, side: ev.side, list: [ev] });
    });
    groups.forEach((g, k) => {
      schedule(() => {
        g.list.forEach(ev => {
          const card = document.querySelector(`.unit-card[data-side="${ev.side}"][data-idx="${ev.idx}"]`);
          if (ev.type === 'damage') { floatAt(card, '-' + ev.amount, 'dmg'); flash(card, 'shake'); }
          else if (ev.type === 'heal') { floatAt(card, '+' + ev.amount, 'heal', 16); flash(card, 'glow-heal'); }
          else { floatAt(card, '結界', 'info'); flash(card, 'glow-heal'); }
        });
      }, k * (DELAY.fxGap * 3));
    });
  }

  function animateDice(value, side, then) {
    const dice = $('#dice');
    bt.diceAnim = true;
    render();
    dice.className = 'dice rolling' + (side === bt.foe ? ' cpu' : '');
    const token = bt.session;
    const iv = setInterval(() => {
      if (token !== bt.session) { clearInterval(iv); return; }
      dice.innerHTML = `<span>${1 + Math.floor(Math.random() * CONFIG.DICE_SIDES)}</span>`;
    }, 70);
    bt.timers.add(iv);
    schedule(() => {
      clearInterval(iv);
      bt.timers.delete(iv);
      bt.diceAnim = false;
      dice.className = 'dice pop' + (side === bt.foe ? ' cpu' : '');
      dice.innerHTML = `<span>${value}</span>`;
      then();
    }, DELAY.roll);
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
      return `<button type="button" class="fm-card${lead ? ' leader' : ''}${ko ? ' ko' : ''}${swapPick === i ? ' picked' : ''}" data-idx="${i}" data-pos="${posOf(i)}" aria-pressed="${lead}"
        aria-label="${esc(ch.name)} Lv${u.level || 1} HP${hp}${lead ? '（リーダー）' : ''}${ko ? '（戦闘不能）' : ''}">
        <span class="fm-art">${portrait(ch, { zoom: true })}${elMark(ch)}${lead ? `<span class="fm-lead">${CROWN}リーダー</span>` : ''}${ko ? '<span class="fm-ko">戦闘不能</span>' : ''}</span>
        <span class="fm-name">${esc(ch.name)}</span>
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
      sheet.querySelector('#btn-formation-ok').addEventListener('click', confirm);
      sheet.querySelectorAll('#btn-formation-back, #btn-formation-x').forEach(b => b.addEventListener('click', () => {
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

  function showSwapModal() {
    const s = bt.state;
    let out = null, inn = null;
    const draw = () => {
      const reason = bt.locked || bt.waiting ? '処理中です' : E.swapBlockReason(s, bt.me);
      const t = bt.state.teams[bt.me];
      let body;
      if (reason) body = `<p class="reason">交代できません：${esc(reason)}</p>`;
      else if (out === null) body = `<h4>① 後衛へ下げる前衛を選ぶ</h4>${unitButtons(bt.me, E.frontAlive(s, bt.me))}`;
      else if (inn === null) body = `<p>下げる前衛：<b>${esc(E.unitChar(t[out]).name)}</b></p><h4>② 前衛に出す後衛を選ぶ</h4>${unitButtons(bt.me, E.backAlive(s, bt.me))}`;
      else {
        body = `<div class="effect-box"><div>後衛へ：<b>${esc(E.unitChar(t[out]).name)}</b>（HP ${t[out].hp}・CD残${t[out].cd}）</div>
          <div>前衛へ：<b>${esc(E.unitChar(t[inn]).name)}</b>（HP ${t[inn].hp}・CD残${t[inn].cd}）</div></div>
          <p class="muted">HP・クールダウン・結界はそのまま引き継ぎます。交代してもターンは終わらず、出目は ${s.dice} のままです。</p>
          <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" id="btn-confirm-swap">この交代を確定する</button></div>`;
      }
      $('#modal-body').innerHTML = `<h3>前衛と後衛を交代（1ターン1回）</h3>${body}
        <div class="modal-actions">
          ${out !== null && !reason ? '<button type="button" class="btn btn-ghost btn-block" id="btn-swap-back">一つ前に戻る</button>' : ''}
          <button type="button" class="btn btn-ghost btn-block" data-close="1">交代をやめる</button>
        </div>`;
      const b = $('#modal-body');
      b.querySelectorAll('[data-target]').forEach(x => x.addEventListener('click', () => {
        if (out === null) out = Number(x.dataset.target); else inn = Number(x.dataset.target);
        draw();
      }));
      const back = b.querySelector('#btn-swap-back');
      if (back) back.addEventListener('click', () => { if (inn !== null) inn = null; else out = null; draw(); });
      const c = b.querySelector('#btn-confirm-swap');
      if (c) c.addEventListener('click', () => { c.disabled = true; perform('swap', { out, in: inn }); });
    };
    openModal('', { kind: 'swap' });
    draw();
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

  function showDetailModal(side, idx) {
    const s = bt.state;
    const draw = () => {
      const u = s.teams[side][idx];
      const ch = E.unitChar(u);
      const mine = side === bt.me;
      const acting = mine && myActing(s);
      const inFront = E.isFront(s, side, idx);
      const skillReason = mine ? E.skillBlockReason(s, bt.me, idx) : null;
      const skill = ch.skill;
      const moveOk = acting && inFront && !bt.locked && !bt.waiting && !E.moveBlockReason(s, bt.me, idx);
      const isLeader = s.leader && s.leader[side] === idx && !(side === bt.foe && s.phase === 'formation');
      $('#modal-body').innerHTML = `<h3>${esc(ch.name)} ${levelTag(u.level || 1)}</h3>
        <div class="uc-head">${emblem(ch, u, 'big')}<div style="flex:1">
          <div>${elementTag(ch)}属性 ${subTags(ch)}</div>
          <div class="uc-badges">${statusBadges(s, side, idx)}</div>
          ${hpBar(u)}${hpText(u)}</div></div>
        <h4>通常技（出目1〜6）<span class="muted">攻撃は敵前衛全員・回復は味方前衛全員${(u.level || 1) > 1 ? `・レベルで攻撃+${E.levelAtkBonus(u.level)}` : ''}</span></h4>${movesList(ch, acting && inFront ? s.dice : null, u.loadout)}
        <h4>固有スキル「${esc(skill.name)}」</h4>
        <div class="effect-box"><div>${esc(skill.text)}</div>
          <div class="muted">CD ${skill.cd}／残りCD ${u.cd}（前衛・後衛どちらでも使用可）</div>
          ${mine && skillReason && u.hp > 0 ? `<div class="reason">今は使えません：${esc(skillReason)}</div>` : ''}</div>
        ${ch.leaderSkill ? `<h4>リーダースキル</h4>${leaderBox(ch, isLeader ? 'このチームのリーダー（発動中）' : '')}
        ${isLeader ? '' : '<p class="muted">リーダーに選んだときだけ発動します。</p>'}` : '<p class="muted">ダンジョンの敵です（リーダースキルなし）。</p>'}
        <div class="modal-actions">
          ${moveOk ? `<button type="button" class="btn btn-primary btn-block" id="btn-detail-move">出目${s.dice}の技を使う…</button>` : ''}
          ${mine && !skillReason && !bt.locked && !bt.waiting ? '<button type="button" class="btn btn-skill btn-block" id="btn-open-skill">固有スキルを使う…</button>' : ''}
          <button type="button" class="btn btn-ghost btn-block" data-close="1">閉じる</button>
        </div>`;
      const b = $('#modal-body');
      const m = b.querySelector('#btn-detail-move');
      if (m) m.addEventListener('click', () => showMoveConfirm(idx));
      const sk = b.querySelector('#btn-open-skill');
      if (sk) sk.addEventListener('click', () => showSkillModal(idx));
    };
    openModal('', { kind: 'detail', refresh: draw });
    draw();
  }

  function showSkillModal(userIdx) {
    const s = bt.state;
    const draw = () => {
      const u = s.teams[bt.me][userIdx];
      const ch = E.unitChar(u);
      const skill = ch.skill;
      const reason = bt.locked || bt.waiting ? '処理中です' : E.skillBlockReason(s, bt.me, userIdx);
      const lines = E.previewSkill(s, bt.me, userIdx).map(p => {
        if (p.type === 'damage') return `<div class="pv-line"><span class="pv-range dmg">敵前衛全員</span><span class="pv-base">${p.base}ダメージ${p.ignoreDefense ? '（防御・属性無視）' : '（属性倍率なし・結界有効）'}</span></div><div class="chips">${p.targets.map(t => `<span class="chip dmg">${esc(t.name)} <b>-${t.damage}</b>${t.barrier ? ' <i class="adv">結界で半減</i>' : ''}</span>`).join('')}</div>`;
        if (p.type === 'heal') return `<div class="pv-line"><span class="pv-range heal">味方前衛全員</span><span class="pv-base">回復${p.base}${p.percent < 100 ? `（疲労${p.percent}%で${p.amount}）` : ''}</span></div><div class="chips">${p.targets.map(t => `<span class="chip heal">${esc(t.name)} <b>+${t.effective}</b></span>`).join('')}</div>`;
        if (p.type === 'barrier') return `<div class="pv-line"><span class="pv-range heal">味方前衛全員</span><span class="pv-base">結界（次の防御可能なダメージ1回を半減・消費まで持続）</span></div><div class="chips">${p.targets.map(t => `<span class="chip">${esc(t.name)} ${t.already ? '（すでに結界あり）' : '<b>結界</b>'}</span>`).join('')}</div>`;
        if (p.type === 'atkMultiplier') return `<div class="pv-line">このターンの通常技の攻撃 ×${p.value}（回復は変わらない）</div>`;
        if (p.type === 'atkBonus') return `<div class="pv-line">このターンの通常技の攻撃 +${p.value}（攻撃0の技は除く）</div>`;
        if (p.type === 'reroll') return `<div class="pv-line">出目 ${s.dice || '？'} を振り直す（同じ数字の可能性あり）</div>`;
        return '';
      }).join('');
      $('#modal-body').innerHTML = `<h3>固有スキル「${esc(skill.name)}」</h3>
        <div class="uc-head">${emblem(ch, u)}<div><b>${esc(ch.name)}</b><div class="muted">CD ${skill.cd}／残りCD ${u.cd}</div></div></div>
        <div class="effect-box"><div>${esc(skill.text)}</div></div>
        <h4>今回の効果（対象別）</h4><div class="effect-box">${lines}</div>
        <p class="muted">スキルはチーム全体で1ターン1回。使った後は、そのターンの交代はできません（通常技は使えます）。</p>
        <div class="modal-actions">
          ${reason ? `<div class="reason">使用できません：${esc(reason)}</div>` : '<button type="button" class="btn btn-primary btn-block" id="btn-confirm-skill">固有スキルを使う</button>'}
          <button type="button" class="btn btn-ghost btn-block" data-close="1">使わずに戻る</button>
        </div>`;
      const c = $('#modal-body').querySelector('#btn-confirm-skill');
      if (c) c.addEventListener('click', () => { c.disabled = true; perform('skill', { user: userIdx }); });
    };
    openModal('', { kind: 'skill', refresh: draw });
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
    $('#btn-roll').addEventListener('click', () => {
      if (!bt.state) return;
      if (bt.state.phase === 'over') { if (bt.opts && bt.opts.onShowResult) bt.opts.onShowResult(); return; }
      perform('roll', {});
    });
    $('#btn-swap').addEventListener('click', () => { if (!bt.locked && !bt.waiting) showSwapModal(); });
    $('#btn-skill-menu').addEventListener('click', () => { if (bt.state) showSkillList(); });
    $('#btn-log').addEventListener('click', () => { if (bt.state) showLogModal(); });
    $('#btn-battle-menu').addEventListener('click', showBattleMenu);
    $('#move-options').addEventListener('click', e => {
      if (U.tapGuarded() || dragger.suppressed()) return;
      const b = e.target.closest('[data-move]');
      if (b && !bt.locked && !bt.waiting) showMoveConfirm(Number(b.dataset.move));
    });
    // 前衛⇄後衛のドラッグ交代（判定はすべて Engine。対人戦のゲストはホストに依頼し、結果の状態で描き直す）
    const layout = $('#screen-battle .bt-layout');
    const dragger = U.cardDrag(layout, {
      selector: '#screen-battle .bt-card.mine:not(.ko)', ghostClass: 'bt-ghost',
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
    const cardClick = e => {
      if (U.tapGuarded() || dragger.suppressed() || !bt.state) return;
      const card = e.target.closest('.bt-card[data-idx]');
      if (card) showDetailModal(card.dataset.side, Number(card.dataset.idx));
    };
    ['#ally-front', '#ally-back', '#enemy-front', '#enemy-back'].forEach(sel => $(sel).addEventListener('click', cardClick));
    layout.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.bt-card[data-idx]')) { e.preventDefault(); e.target.click(); }
    });
    U.ui.onModalClose = () => { if (bt.active && bt.state && bt.state.phase === 'over') renderCenter(); };
  }

  window.RikuyouBattle = {
    bind, start, stop,
    isActive: () => bt.active,
    // テスト・デバッグ用（ゲーム進行には使わない）
    getState: () => bt.state,
    isLocked: () => bt.locked || bt.waiting,
    getSession: () => bt.session,
    me: () => bt.me,
    mode: () => bt.mode
  };
})();
