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
  const { E, CONFIG, DELAY, rng, $, esc, emblem, elMark, portrait, starsHtml, frameAttrs, elementTag, subTags, hpBar, hpText, levelTag, movesList, leaderBox, openModal, closeModal, toast } = U;

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
    const main = kind === 'both' ? `攻${p.boosted}＋回${healVal}` : kind === 'atk' ? `攻撃 ${p.boosted}` : kind === 'heal' ? `回復 ${healVal}` : '—';
    return `<button type="button" class="mo-btn ${kind}" data-move="${i}"${bt.locked || bt.waiting ? ' disabled' : ''} aria-label="${esc(ch.name)}の通常技「${esc(p.move.name)}」${esc(main)}">
      <span class="mo-kind">${head}</span><b class="mo-main">${esc(main)}</b><span class="mo-name">${s.dice}「${esc(p.move.name)}」</span></button>`;
  }

  // カード：絵（押すと詳細）＋名前・★・HP＋（味方前衛で出目確定後は）通常技。枠は属性色×ランクの濃さ
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
    const label = `${ch.name}${E.starsOf(ch.id) ? ' ★' + E.starsOf(ch.id) : ''} HP${u.hp}/${u.maxHp}${st === 'low' ? '（ピンチ）' : ''}${u.hp <= 0 ? '（戦闘不能）' : ''}${lead ? '（リーダー）' : ''}`;
    const withMove = mine && kind === 'front' && u.hp > 0 && myActing(s) && !bt.waiting;
    return `<div class="bt-card unit-card el-frame ${kind} ${mine ? 'mine' : 'foe'}${st ? ' hp-' + st : ''}${u.hp <= 0 ? ' ko' : ''}" ${frameAttrs(ch)} data-side="${side}" data-idx="${i}" data-pos="${kind}">
      <span class="bt-art" role="button" tabindex="0" aria-label="${esc(label)}（詳細・固有スキル）">${portrait(ch, { zoom: true })}${elMark(ch)}<span class="bt-tags">${tags.join('')}</span>${u.hp <= 0 ? '<span class="bt-ko">戦闘不能</span>' : ''}${kind === 'back' ? hpNum(u) : ''}</span>
      ${kind === 'front' ? `<span class="bt-info"><span class="bt-name">${esc(ch.name)}${starsHtml(ch)}</span><span class="bt-hpline">${hpNum(u)}${st === 'low' ? '<span class="bt-pinch">ピンチ</span>' : ''}${cd}</span>${hpBar(u)}</span>`
        : `${hpBar(u)}<span class="bt-backline">${starsHtml(ch)}${u.hp > 0 && u.cd > 0 && !hidden ? `<span class="bt-cd" title="固有スキルの残りターン">⌛${u.cd}</span>` : ''}</span>`}
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

  function renderCenter() {
    const s = bt.state;
    const pct = E.healPercent(Math.max(1, s.round));
    $('#round-info').innerHTML = s.round > 0 ? `第<b>${s.round}</b>巡` : '準備中';
    $('#fatigue-info').innerHTML = pct < 100 ? `回復疲労：回復${pct}%` : '';
    const foe = whoName(bt.foe);
    let phase = '', sub = '';
    if (s.phase === 'formation') { phase = '戦闘準備'; sub = s.front[bt.me].length ? `${foe}が配置を決めています…` : '前衛とリーダーを決めてください'; }
    else if (s.phase === 'initiative') { phase = '先攻・後攻'; sub = 'サイコロで決めています…'; }
    else if (s.phase === 'over') { phase = s.winner === bt.me ? '勝利！' : '敗北…'; sub = 'サイコロを押すと結果を見られます'; }
    else if (s.phase === 'replace') { phase = s.pendingReplace.side === bt.me ? '前衛の補充' : '相手のターン'; sub = s.pendingReplace.side === bt.me ? '後衛から前衛に出すキャラを選んでください' : `${foe}が前衛を補充しています…`; }
    else if (s.turnSide === bt.foe) { phase = '相手のターン'; sub = s.phase === 'roll' ? `${foe}が数字を出しています…` : `${foe}の出目 ${s.dice}：行動を考えています…`; }
    else if (bt.waiting) { phase = 'あなたのターン'; sub = '相手の端末に送信中…'; }
    else if (s.phase === 'roll') { phase = 'サイコロを振る'; sub = 'サイコロを押して数字を出す'; }
    else if (bt.diceAnim) { phase = 'サイコロを振る'; sub = '数字を出しています…'; }
    else if (s.moveUsed) { phase = 'あなたのターン'; sub = '行動しました'; }
    else { phase = '技を選ぶ'; sub = '前衛の技を1つ選ぶ（スキルは絵を押す）'; }
    $('#phase-text').textContent = phase;
    $('#phase-sub').textContent = sub;
    $('#screen-battle').classList.toggle('my-turn', s.turnSide === bt.me && (s.phase === 'roll' || s.phase === 'action'));
    $('#range-note').classList.toggle('hidden', !(myActing(s) && !bt.waiting));

    const dice = $('#dice');
    if (!bt.diceAnim) {
      dice.className = 'dice' + (s.dice ? '' : ' empty') + (s.turnSide === bt.foe && s.dice ? ' cpu' : '');
      dice.innerHTML = `<span>${s.dice || '？'}</span>`;
    }
    // サイコロ自体が「数字を出す」ボタン
    const btn = $('#btn-roll');
    let cap = '';
    if (s.phase === 'over') { btn.disabled = !!U.ui.modal; cap = '結果を見る'; }
    else {
      btn.disabled = bt.locked || bt.waiting || s.turnSide !== bt.me || s.phase !== 'roll';
      cap = btn.disabled ? '' : 'タップして数字を出す';
    }
    $('#roll-cap').textContent = cap;
    btn.classList.toggle('ready', !btn.disabled);
    btn.setAttribute('aria-label', s.phase === 'over' ? '結果を見る' : !btn.disabled ? '数字を出す' : (s.dice ? `出目 ${s.dice}` : '数字はまだ出ていません'));
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
      if (p.type === 'reroll') return `<div class="pv-line"><span class="pv-range">出目</span>${s.dice || '？'} を振り直す（同じ数字の可能性あり）</div>`;
      return '';
    }).join('');
  }
  // 対象範囲を短く
  function skillRange(ch) {
    const t = ch.skill.effects.map(e => ({ damage: '敵前衛全員', heal: '味方前衛全員', barrier: '味方前衛全員', atkMultiplier: 'このターンの通常技', atkBonus: 'このターンの通常技', reroll: '出目' }[e.type]) || '');
    return t.filter((x, i) => x && t.indexOf(x) === i).join('・');
  }

  // キャラの詳細＝固有スキルの確認画面。味方で使えるときだけ「このスキルを使う」。交代の代わりの操作もここから
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
      // 交代の相手（前衛なら生存している後衛、後衛なら生存している前衛）
      let swapHtml = '';
      if (mine && u.hp > 0 && s.phase !== 'formation' && s.phase !== 'over') {
        const swapReason = busy ? '処理中です' : E.swapBlockReason(s, bt.me);
        const partners = inFront ? E.backAlive(s, bt.me) : E.frontAlive(s, bt.me);
        swapHtml = `<h4>交代（ドラッグの代わり）</h4>${swapReason
          ? `<p class="reason">今は交代できません：${esc(swapReason)}</p>`
          : `<p class="muted">${inFront ? '後衛' : '前衛'}の誰と入れ替えるか選んでください（HP・クールダウンはそのまま）。</p>
            <div class="target-list">${partners.map(j => { const v = s.teams[bt.me][j]; const c2 = E.unitChar(v); return `<button type="button" class="target-btn" data-swap-with="${j}">${emblem(c2, v, 'small')}<span class="t-main"><b>${esc(c2.name)}</b> と入れ替える<br>${hpText(v)}</span></button>`; }).join('')}</div>`}`;
      }
      const stars = E.starsOf(ch.id);
      $('#modal-body').innerHTML = `<div class="dt-head el-frame" ${frameAttrs(ch)}>${portrait(ch, { zoom: true })}<div>
          <h3>${esc(ch.name)}</h3>
          <div class="dt-meta">${stars ? `<span class="stars">${'★'.repeat(stars)}</span>` : (E.isBoss(ch.id) ? `<span class="badge boss">${esc(ch.rank || 'ボス')}</span>` : '')}${elMark(ch)}<span>${esc(el.name)}</span>${levelTag(u.level || 1)}${isLeader ? '<span class="badge leader">リーダー</span>' : ''}</div>
          <div class="dt-hp">${hpBar(u)}${hpText(u)}</div>
          <div class="uc-badges">${statusBadges(s, side, idx)}</div></div></div>
        <h4>固有スキル「${esc(ch.skill.name)}」</h4>
        <div class="effect-box"><div>${esc(ch.skill.text)}</div>
          <div class="dt-skill-meta"><span>対象：${esc(skillRange(ch))}</span><span>クールダウン ${ch.skill.cd}ターン</span><span>${u.cd > 0 ? `残り <b>${u.cd}</b>ターン` : '今は待ち時間なし'}</span><span>${inFront ? '前衛' : '後衛'}からも使える</span></div>
          ${mine && u.hp > 0 ? `<div class="dt-preview">${skillPreviewLines(side, idx)}</div>` : ''}
          ${mine && skillReason ? `<p class="reason">今は使えません：${esc(skillReason)}${u.cd > 0 ? `（残りクールダウン ${u.cd}）` : ''}</p>` : ''}
          ${!mine ? '<p class="muted">相手のキャラです（情報の確認のみ）。</p>' : ''}</div>
        ${mine && !skillReason ? '<div class="modal-actions"><button type="button" class="btn btn-primary btn-block" id="btn-use-skill">このスキルを使う</button></div>' : ''}
        ${swapHtml}
        <details class="dt-more"><summary>通常技（出目1〜6）・リーダースキル</summary>
          ${movesList(ch, mine && myActing(s) && inFront ? s.dice : null, u.loadout)}
          ${ch.leaderSkill ? leaderBox(ch, isLeader ? 'このチームのリーダー（発動中）' : '') : '<p class="muted">ダンジョンの敵です（リーダースキルなし）。</p>'}
        </details>
        <div class="modal-actions"><button type="button" class="btn btn-ghost btn-block" data-close="1">閉じる</button></div>`;
      const b = $('#modal-body');
      const use = b.querySelector('#btn-use-skill');
      if (use) use.addEventListener('click', () => { use.disabled = true; perform('skill', { user: idx }); });
      b.querySelectorAll('[data-swap-with]').forEach(t => t.addEventListener('click', () => {
        const j = Number(t.dataset.swapWith);
        perform('swap', inFront ? { out: idx, in: j } : { out: j, in: idx });
      }));
    };
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
    // 中央のサイコロ＝数字を出す（決着後は結果を見る）
    $('#btn-roll').addEventListener('click', () => {
      if (!bt.state) return;
      if (bt.state.phase === 'over') { if (bt.opts && bt.opts.onShowResult) bt.opts.onShowResult(); return; }
      perform('roll', {});
    });
    $('#btn-battle-menu').addEventListener('click', showBattleMenu);
    // 前衛⇄後衛のドラッグ交代（判定はすべて Engine。対人戦のゲストはホストに依頼し、結果の状態で描き直す）
    const layout = $('#screen-battle .bt-layout');
    const dragger = U.cardDrag(layout, {
      selector: '#screen-battle .bt-card.mine:not(.ko)', ghostClass: 'bt-ghost', ignore: '[data-move]',
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
    isLocked: () => bt.locked || bt.waiting,
    getSession: () => bt.session,
    me: () => bt.me,
    mode: () => bt.mode
  };
})();
