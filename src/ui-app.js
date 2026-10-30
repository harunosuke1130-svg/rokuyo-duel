/*
 * 六耀の決闘 — アプリ全体の画面（ログイン・ホーム・チーム・ダンジョン・ガチャ・対戦ロビー・結果）
 * 成長の計算は RikuyouProfile、保存と通信は RikuyouBackend、戦闘画面は RikuyouBattle が担当する。
 */
(function () {
  'use strict';

  const U = window.RikuyouUI;
  const B = window.RikuyouBattle;
  const P = window.RikuyouProfile;
  const BK = window.RikuyouBackend;
  const CPU = window.RikuyouCPU;
  const D = window.RikuyouData;
  const { E, CONFIG, rng, $, esc, emblem, elMark, portrait, gemIcon, starsHtml, frameAttrs, elementTag, subTags, levelTag, moveEffText, movesList, leaderBox, openModal, closeModal, toast, showScreen } = U;

  const app = {
    backend: null,
    user: null,
    profile: null,
    picked: [],
    lobby: { code: null, unwatch: null, role: null, starting: false },
    bonusOffered: false,
    lastResult: null
  };

  /* ---------- 保存 ---------- */
  let saveChain = Promise.resolve();
  function save() {
    renderTopbar();
    const snapshot = JSON.parse(JSON.stringify(app.profile));
    saveChain = saveChain.then(() => app.backend.saveProfile(snapshot)).catch(e => toast('保存に失敗しました：' + e.message));
    return saveChain;
  }

  function renderTopbar() {
    const chip = $('#top-stones');
    const p = app.profile;
    chip.classList.toggle('hidden', !p);
    if (p) chip.innerHTML = `${gemIcon()}<b>${p.stones}</b>`;
    if (p) $('#home-stones').innerHTML = `${gemIcon()}<b>${p.stones}</b>`;
    const screen = document.body.dataset.screen;
    $('#btn-home').classList.toggle('hidden', !p || screen === 'home' || screen === 'battle');
    document.querySelectorAll('#tabbar [data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === screen));
  }
  function go(name) {
    showScreen(name);
    renderTopbar();
  }

  /* ---------- 起動とログイン ---------- */
  async function boot() {
    U.ui.onScreen = renderTopbar; // 戦闘中は「ホーム」を隠す（降参・退出ボタンから抜ける）
    U.bindModalBasics();
    B.bind();
    bindAll();
    showScreen('loading');
    try { app.backend = await BK.createBackend(); }
    catch (e) { console.error(e); toast('オンライン機能を読み込めませんでした。この端末への保存で遊びます'); app.backend = BK.LocalBackend(); }
    try { await app.backend.init(); } catch (e) { console.error(e); }
    app.backend.onAuth(onAuth);
  }

  let authToken = 0;
  async function onAuth(user) {
    const token = ++authToken;
    app.user = user;
    if (!user) { app.profile = null; showLogin(); return; }
    if (app.profile && app.profile.uid === user.uid) return; // 同じユーザーの再通知
    try {
      const raw = await app.backend.loadProfile();
      if (token !== authToken) return;
      if (raw) app.profile = P.sanitize(raw, { uid: user.uid, isAdmin: user.isAdmin, name: user.name });
      else { app.profile = P.newProfile({ uid: user.uid, name: user.name, isAdmin: user.isAdmin }, rng); await save(); }
      if (user.isAdmin !== app.profile.isAdmin) app.profile = P.sanitize(app.profile, { uid: user.uid, isAdmin: user.isAdmin });
      app.bonusOffered = false;
      showHome();
    } catch (e) {
      $('#login-error').textContent = 'データを読み込めませんでした：' + e.message;
      showLogin();
    }
  }

  function showLogin() {
    B.stop();
    go('login');
    $('#login-error').textContent = '';
    const local = app.backend.mode === 'local';
    $('#login-mode').textContent = local
      ? 'データはこの端末に保存されます（オフライン）'
      : 'データはアカウントに保存されます（どの端末からでも続きができます）';
    if (local) {
      const players = app.backend.localPlayers();
      // 一番新しく作ったプレイヤーを「続ける」の先頭に。ほかのプレイヤーも選べる
      const main = players[players.length - 1];
      const others = players.slice(0, -1).reverse();
      $('#login-greet').textContent = players.length ? 'おかえりなさい' : 'ようこそ';
      $('#login-body').innerHTML = `
        ${main ? `<button type="button" class="lg-continue" data-local="${esc(main.uid)}"><span class="lg-quill" aria-hidden="true">✒</span><span class="lg-cname"><b>${esc(main.name)}</b> で続ける</span><span class="lg-chev" aria-hidden="true">›</span></button>
          ${others.length ? `<div class="lg-others"><span>ほかのプレイヤー</span>${others.map(p => `<button type="button" class="lg-chip" data-local="${esc(p.uid)}">${esc(p.name)} で続ける</button>`).join('')}</div>` : ''}` : ''}
        <div class="lg-new">
          <div class="lg-divider"><span>新しくはじめる</span></div>
          <label class="field lg-field"><span>プレイヤー名</span><input id="in-name" maxlength="16" autocomplete="nickname" placeholder="名前を入力（例：はるの）"></label>
          <button type="button" class="lg-start" id="btn-local-start">はじめる</button>
        </div>
        ${app.backend.adminCodeEnabled && app.backend.adminCodeEnabled() ? `<details class="admin-login"><summary>管理用アカウントで入る</summary>
          <p class="muted">管理用コードを持っている人だけが使えます。全キャラクターを持った状態で遊べます（この端末に保存）。</p>
          <label class="field"><span>名前</span><input id="in-admin-name" maxlength="16" autocomplete="off" placeholder="例：管理人"></label>
          <label class="field"><span>管理用コード</span><input id="in-admin-code" type="password" autocomplete="off"></label>
          <button type="button" class="btn btn-ghost btn-block" id="btn-admin-start">管理用アカウントではじめる</button></details>` : ''}`;
      $('#login-body').querySelectorAll('[data-local]').forEach(b => b.addEventListener('click', () => doAuth(() => app.backend.signIn({ uid: b.dataset.local }))));
      $('#btn-local-start').addEventListener('click', () => doAuth(() => app.backend.signIn({ name: $('#in-name').value })));
      $('#in-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-local-start').click(); });
      const ab = $('#btn-admin-start');
      if (ab) ab.addEventListener('click', () => doAuth(() => app.backend.signIn({ name: $('#in-admin-name').value || '管理人', adminCode: $('#in-admin-code').value })));
    } else {
      let signup = false;
      const draw = () => {
        $('#login-greet').textContent = signup ? 'ようこそ' : 'おかえりなさい';
        $('#login-body').innerHTML = `
          <div class="tabs lg-tabs"><button type="button" class="tab${signup ? '' : ' on'}" data-tab="in">ログイン（続きから）</button><button type="button" class="tab${signup ? ' on' : ''}" data-tab="up">新しくはじめる</button></div>
          <form id="auth-form" class="auth-form">
            ${signup ? '<label class="field lg-field"><span>プレイヤー名（表示名）</span><input id="in-name" maxlength="16" autocomplete="nickname" required></label>' : ''}
            <label class="field lg-field"><span>メールアドレス</span><input id="in-email" type="email" autocomplete="email" required></label>
            <label class="field lg-field"><span>パスワード（6文字以上）</span><input id="in-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label>
            <button type="submit" class="${signup ? 'lg-start' : 'lg-continue lg-continue-form'}" id="btn-auth">${signup ? '登録してはじめる' : 'ログインして続ける'}</button>
          </form>`;
        $('#login-body').querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => { signup = t.dataset.tab === 'up'; $('#login-error').textContent = ''; draw(); }));
        $('#auth-form').addEventListener('submit', e => {
          e.preventDefault();
          const email = $('#in-email').value, password = $('#in-pass').value;
          if (signup) doAuth(() => app.backend.signUp({ email, password, name: $('#in-name').value }));
          else doAuth(() => app.backend.signIn({ email, password }));
        });
      };
      draw();
    }
  }

  async function doAuth(fn) {
    $('#login-error').textContent = '';
    const btns = $('#login-body').querySelectorAll('button');
    btns.forEach(b => { b.disabled = true; });
    try { await fn(); }
    catch (e) { $('#login-error').textContent = e.message; }
    finally { btns.forEach(b => { b.disabled = false; }); }
  }

  /* ---------- ホーム ---------- */
  function showHome() {
    B.stop();
    leaveLobby();
    go('home');
    const p = app.profile;
    const owned = P.ownedIds(p).length;
    const lead = p.team.length ? E.getChar(p.team[0]) : null;
    $('#home-profile').innerHTML = `${lead ? emblem(lead, null, 'small') : ''}<span class="np-name">${esc(p.name)}</span>${p.isAdmin ? '<span class="badge leader">管理用アカウント</span>' : ''}`;
    $('#home-team').innerHTML = P.teamError(p, p.team)
      ? `<button type="button" class="team-missing" data-go="team"><b>チームが未完成です</b><span>「編成」で6体を選んで保存してください</span></button>`
      : p.team.map(id => {
        const ch = E.getChar(id);
        return `<button type="button" class="portrait-card el-frame" ${frameAttrs(ch)} data-go="team" aria-label="${esc(ch.name)} ★${E.starsOf(ch.id)} Lv${P.levelOf(p, id)}（編成へ）">${portrait(ch, { zoom: true })}${levelTag(P.levelOf(p, id))}${elMark(ch)}${starsHtml(ch)}</button>`;
      }).join('');
    renderBonus();
    if (!app.bonusOffered && !P.loginStatus(p).claimed) { app.bonusOffered = true; showBonusModal(); }
  }

  function renderBonus() {
    const st = P.loginStatus(app.profile);
    const last = D.ECONOMY.loginBonus.length;
    const days = D.ECONOMY.loginBonus.map((v, i) => {
      const day = i + 1;
      const got = day < st.dayInCycle || (st.claimed && day === st.dayInCycle);
      const today = day === st.dayInCycle && !st.claimed;
      const cls = 'bonus-day' + (got ? ' got' : '') + (today ? ' today' : '') + (day === last ? ' last' : '');
      const inner = got ? '<span class="bd-check" aria-label="受け取り済み">✓</span>' : `${gemIcon()}<b>${v}</b>`;
      const cell = today
        ? `<button type="button" class="bd-cell" id="btn-bonus" aria-label="今日のボーナスを受け取る（石 +${v}）">${inner}</button>`
        : `<span class="bd-cell">${inner}</span>`;
      return `<li class="${cls}"><small>${day}日目</small>${cell}</li>`;
    }).join('');
    $('#home-bonus').innerHTML = `<div class="bonus-label"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M7 13.5h2M11 13.5h2M15 13.5h2M7 17h2M11 17h2M15 17h2" stroke-width="2"/></svg><span><b>ログインボーナス</b><small>${st.claimed ? `連続${st.streak}日・また明日` : '今日の分をタップで受け取り'}</small></span></div>
      <ol class="bonus-days">${days}</ol>`;
    const b = $('#btn-bonus');
    if (b) b.addEventListener('click', claimBonus);
  }
  function showBonusModal() {
    const st = P.loginStatus(app.profile);
    openModal(`<h3>ログインボーナス</h3><p>連続${st.streak}日目のボーナスです。</p>
      <div class="big-reward">石 +${st.amount}</div>
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" id="btn-bonus-modal">受け取る</button>
      <button type="button" class="btn btn-ghost btn-block" data-close="1">あとで</button></div>`,
    { kind: 'bonus', bind: b => b.querySelector('#btn-bonus-modal').addEventListener('click', () => { closeModal(true); claimBonus(); }) });
  }
  function claimBonus() {
    const r = P.claimLogin(app.profile, new Date());
    if (!r.ok) { toast(r.error); return; }
    save();
    toast(`ログインボーナス：石 +${r.amount}（連続${r.streak}日目）`, 'ok');
    showHome();
  }

  /* ---------- 編成（前衛3体・後衛3体・所持キャラ） ----------
   * 上の6枠（0〜2が前衛、3〜5が後衛）はドラッグで入れ替え、タップで詳細（技・レベル・リーダー）。
   * 所持キャラはタップでチームに出し入れ。保存するとチームの並びと「前回の配置」（前衛・リーダー）に入る。 */
  const teamUI = { slots: [], leader: null, filter: 'all', dragger: null };
  const CROWN_SVG = '<svg viewBox="0 0 24 18" aria-hidden="true"><path d="M2 15L1 4l6 5 5-8 5 8 6-5-1 11z" fill="currentColor"/><rect x="2" y="15" width="20" height="2.4" rx="1" fill="currentColor"/></svg>';
  // 属性で絞り込むボタン（編成・図鑑で共通）
  function elFilterHtml(sel) {
    const items = [['all', 'すべて']].concat(Object.keys(D.ELEMENTS).map(el => [el, D.ELEMENTS[el].name]));
    return items.map(([k, label]) => `<button type="button" class="ef-btn" data-filter="${k}" aria-pressed="${k === sel}">${k === 'all' ? '' : `<span class="el-ico" data-el="${k}" aria-hidden="true"></span>`}${esc(label)}</button>`).join('');
  }
  function showTeam() {
    go('team');
    const p = app.profile;
    const team = p.team.filter(id => P.owns(p, id));
    // 前回の配置（前衛）を上の段に。残りはチームの並び順
    const fm = p.formation;
    const order = fm && fm.front.length && fm.front.every(id => team.indexOf(id) >= 0)
      ? fm.front.concat(team.filter(id => fm.front.indexOf(id) < 0)) : team.slice();
    teamUI.slots = Array.from({ length: CONFIG.TEAM_SIZE }, (_, i) => order[i] || null);
    teamUI.leader = fm && team.indexOf(fm.leader) >= 0 ? fm.leader : (order[0] || null);
    renderAdminTools();
    renderTeam();
  }
  function teamSlotCard(id, i) {
    if (!id) return `<div class="tm-card empty" data-tslot="${i}"><span>空き</span></div>`;
    const p = app.profile;
    const ch = E.getChar(id);
    const lv = P.levelOf(p, id);
    const lead = id === teamUI.leader;
    return `<div class="tm-card el-frame" ${frameAttrs(ch)} data-tslot="${i}" data-id="${esc(id)}" role="button" tabindex="0" aria-label="${esc(ch.name)} Lv${lv}${lead ? '（リーダー）' : ''}（詳細）">
      <span class="tm-art">${portrait(ch, { zoom: true })}${lead ? `<span class="tm-crown" title="リーダー">${CROWN_SVG}</span>` : ''}</span>
      <span class="tm-plate">${elMark(ch)}<span class="tm-plate-text"><b class="tm-name">${esc(ch.name)}</b><span class="tm-meta">${starsHtml(ch)}<span class="tm-lv">Lv.${lv}</span></span></span></span>
    </div>`;
  }
  function renderTeam() {
    const p = app.profile;
    const s = teamUI.slots;
    if (teamUI.leader && s.indexOf(teamUI.leader) < 0) teamUI.leader = null;
    if (!teamUI.leader) teamUI.leader = s.find(Boolean) || null;
    $('#team-front').innerHTML = s.slice(0, CONFIG.FRONT_SIZE).map((id, i) => teamSlotCard(id, i)).join('');
    $('#team-back').innerHTML = s.slice(CONFIG.FRONT_SIZE).map((id, i) => teamSlotCard(id, i + CONFIG.FRONT_SIZE)).join('');
    $('#team-filter').innerHTML = elFilterHtml(teamUI.filter);
    const list = E.CHARACTERS.filter(ch => P.owns(p, ch.id) && (teamUI.filter === 'all' || ch.element === teamUI.filter));
    $('#team-grid').innerHTML = list.map(ch => {
      const inTeam = s.indexOf(ch.id) >= 0;
      const lv = P.levelOf(p, ch.id);
      return `<div class="tm-mini el-frame${inTeam ? ' picked' : ''}" ${frameAttrs(ch)}>
        <button type="button" class="tm-mini-btn" data-pick="${esc(ch.id)}" aria-pressed="${inTeam}" aria-label="${esc(ch.name)} Lv${lv}（${inTeam ? 'チームから外す' : 'チームに入れる'}）">
          <span class="tm-art">${portrait(ch, { zoom: true })}${inTeam ? '<span class="tm-check" aria-hidden="true">✓</span>' : ''}</span>
          <span class="tm-mini-foot">${elMark(ch)}<span class="tm-lv">Lv.${lv}</span>${starsHtml(ch)}</span>
        </button>
        <button type="button" class="tm-info" data-info="${esc(ch.id)}" aria-label="${esc(ch.name)}の詳細">i</button>
      </div>`;
    }).join('') || '<p class="paper-empty">この属性のキャラはまだ持っていません。</p>';
    const filled = s.filter(Boolean).length;
    $('#team-count').textContent = filled;
    $('#btn-team-ok').disabled = filled !== CONFIG.TEAM_SIZE;
    if (!teamUI.dragger) bindTeamDrag();
  }
  function bindTeamDrag() {
    teamUI.dragger = U.cardDrag($('#screen-team'), {
      selector: '#team-front .tm-card, #team-back .tm-card', ghostClass: 'tm-ghost',
      enabled: () => document.body.dataset.screen === 'team',
      canStart: c => (c.dataset.id ? null : '空き枠は動かせません'),
      canDrop: (c, t) => c !== t,
      onDrop: (c, t) => {
        const a = Number(c.dataset.tslot), b = Number(t.dataset.tslot);
        const sl = teamUI.slots;
        [sl[a], sl[b]] = [sl[b], sl[a]];
        renderTeam();
      }
    });
  }
  function togglePick(id) {
    if (!P.owns(app.profile, id)) return;
    const s = teamUI.slots;
    const k = s.indexOf(id);
    if (k >= 0) s[k] = null;
    else {
      const free = s.indexOf(null);
      if (free < 0) { toast(`チームは${CONFIG.TEAM_SIZE}体までです。外したいキャラをもう一度タップしてください`); return; }
      s[free] = id;
    }
    renderTeam();
  }
  // キャラの詳細（編成から）：レベル・経験値・技構成・スキル。チームに入っていればリーダーにする／外す
  function showTeamChar(id) {
    const p = app.profile;
    const ch = E.getChar(id);
    if (!ch || !P.owns(p, id)) return;
    const c = p.chars[id];
    const lo = P.loadoutsFor(p, [id])[id];
    const custom = lo.join() !== E.defaultLoadout(id).join();
    const usable = ch.moves.filter((m, k) => E.moveUnlockLevel(k) <= c.level).length;
    const nextUnlock = ch.moves.map((m, k) => E.moveUnlockLevel(k)).filter(l => l > c.level).sort((a, b) => a - b)[0];
    const maxed = c.level >= CONFIG.LEVEL.max;
    const inTeam = teamUI.slots.indexOf(id) >= 0;
    const lead = id === teamUI.leader;
    openModal(`<div class="zk-detail">${portrait(ch)}<div>
        <h3>${esc(ch.name)}${starsHtml(ch)}</h3>
        <div>${elementTag(ch)}${subTags(ch)}</div>
        <p class="hptext">Lv${c.level}・最大HP <b>${E.levelMaxHp(ch.maxHp, c.level)}</b>${c.level > 1 ? `（基礎${ch.maxHp}）・攻撃+${E.levelAtkBonus(c.level)}` : ''}</p>
        <div class="exp-line"><span class="muted">${maxed ? '最大レベル' : `次のレベルまで ${P.expToNext(c.level) - c.exp}`}</span><div class="hpbar exp"><i style="width:${maxed ? 100 : c.exp / P.expToNext(c.level) * 100}%"></i></div></div>
      </div></div>
      ${p.isAdmin ? levelControl(id, c.level) : ''}
      <div class="lo-head"><span>技構成（出目1〜6）${custom ? ' <span class="badge ready">カスタム</span>' : ''}</span><span class="muted">技力 ${E.loadoutPower(id, lo)} / ${E.loadoutBudget(id, c.level)}・使える技${usable}/${ch.moves.length}${nextUnlock ? `（次はLv${nextUnlock}）` : ''}</span></div>
      ${movesList(ch, null, lo)}
      <button type="button" class="btn btn-small btn-ghost btn-block btn-edit" data-edit="${esc(id)}">技の入れ替え・並べ替え</button>
      <div class="effect-box"><b>固有スキル「${esc(ch.skill.name)}」</b> CD${ch.skill.cd}<br><span class="muted">${esc(ch.skill.text)}</span></div>
      ${leaderBox(ch, lead ? 'リーダー' : '')}
      <div class="modal-actions">
        ${inTeam ? `${lead ? '' : '<button type="button" class="btn btn-primary btn-block" id="btn-tc-leader">リーダーにする</button>'}<button type="button" class="btn btn-ghost btn-block" id="btn-tc-toggle">チームから外す</button>`
          : '<button type="button" class="btn btn-primary btn-block" id="btn-tc-toggle">チームに入れる</button>'}
        <button type="button" class="btn btn-ghost btn-block" data-close="1">閉じる</button>
      </div>`, {
      kind: 'team-char',
      bind: b => {
        b.addEventListener('click', e => {
          const st = e.target.closest('[data-lv-step]');
          if (st) { changeLevel(st.dataset.lv, P.levelOf(app.profile, st.dataset.lv) + Number(st.dataset.lvStep)); return; }
          const ed = e.target.closest('[data-edit]');
          if (ed) { showLoadoutEditor(ed.dataset.edit); return; }
          if (e.target.closest('#btn-tc-leader')) { teamUI.leader = id; closeModal(true); renderTeam(); toast(`${ch.name}をリーダーにしました`, 'ok'); return; }
          if (e.target.closest('#btn-tc-toggle')) { closeModal(true); togglePick(id); }
        });
        b.addEventListener('change', e => {
          const inp = e.target.closest('[data-lv-input]');
          if (inp) changeLevel(inp.dataset.lvInput, Number(inp.value));
        });
        b.addEventListener('keydown', e => { if (e.target.closest('[data-lv-box]')) e.stopPropagation(); });
      }
    });
  }
  // 管理用アカウント：レベルを直接動かす（キャラごと・全員まとめて）
  function levelControl(id, lv) {
    const b = (d, t) => `<button type="button" class="lv-btn" data-lv="${id}" data-lv-step="${d}" aria-label="レベル${t}"${(d < 0 && lv <= 1) || (d > 0 && lv >= CONFIG.LEVEL.max) ? ' disabled' : ''}>${t}</button>`;
    return `<div class="lv-control" data-lv-box="${id}"><span>レベル変更</span>${b(-10, '−10')}${b(-1, '−1')}
      <input type="number" class="lv-input" data-lv-input="${id}" min="1" max="${CONFIG.LEVEL.max}" value="${lv}" aria-label="レベル（1〜${CONFIG.LEVEL.max}）">${b(1, '+1')}${b(10, '+10')}</div>`;
  }
  function renderAdminTools() {
    const box = $('#admin-level-all');
    box.classList.toggle('hidden', !app.profile.isAdmin);
    if (!app.profile.isAdmin) return;
    box.innerHTML = `<b>管理用</b><span>所持キャラ全員のレベルを</span>
      <input type="number" class="lv-input" id="in-level-all" min="1" max="${CONFIG.LEVEL.max}" value="${CONFIG.LEVEL.max}" aria-label="全員のレベル">
      <button type="button" class="btn btn-small btn-ghost" id="btn-level-all">にする</button>`;
    $('#btn-level-all').addEventListener('click', () => {
      const lv = Number($('#in-level-all').value);
      P.ownedIds(app.profile).forEach(id => P.setLevel(app.profile, id, lv));
      save();
      toast(`所持キャラ全員を Lv${E.clampLevel(lv)} にしました`, 'ok');
      renderTeam();
    });
  }
  function changeLevel(id, lv) {
    const r = P.setLevel(app.profile, id, lv);
    if (!r.ok) { toast(r.error); return; }
    save();
    renderTeam();
    if (U.ui.modal && U.ui.modal.kind === 'team-char') showTeamChar(id);
    const inp = document.querySelector(`[data-lv-input="${id}"]`);
    if (inp) inp.focus();
  }


  function showLoadoutEditor(charId) {
    const ch = E.getChar(charId);
    const lv = P.levelOf(app.profile, charId);
    let draft = P.loadoutsFor(app.profile, [charId])[charId].slice();
    let sel = null;
    const draw = () => {
      const err = E.loadoutError(charId, draft, lv);
      const power = E.loadoutPower(charId, draft);
      const budget = E.loadoutBudget(charId, lv);
      const unused = ch.moves.map((m, k) => k).filter(k => draft.indexOf(k) < 0);
      const open = unused.filter(k => E.moveUnlockLevel(k) <= lv);
      const locked = unused.filter(k => E.moveUnlockLevel(k) > lv);
      $('#modal-body').innerHTML = `<h3>技のカスタム：${esc(ch.name)}</h3>
        <p class="muted">枠（出目）を押して選び、<b>別の枠</b>を押すと順番を入れ替え、<b>控えの技</b>を押すとその枠の技と交換します。技力（攻撃＋回復）の合計は上限まで。<b>レベルが上がると上限が上がり、控えの技も解放されます。</b></p>
        <div class="power-meter${power > budget ? ' over' : ''}">技力 <b>${power}</b> / 上限 ${budget}<span class="muted">（Lv${lv}${lv > 1 ? `・レベルで+${budget - E.loadoutBudget(charId, 1)}` : ''}）</span>
          <div class="hpbar"><i style="width:${Math.min(100, power / budget * 100)}%"></i></div></div>
        <h4>出目1〜6の技</h4>
        <div class="slot-list">${draft.map((k, d) => `<button type="button" class="slot-btn${sel === d ? ' selected' : ''}" data-slot="${d}"><span class="num">${d + 1}</span><span class="s-name">${esc(ch.moves[k].name)}</span><span class="eff">${moveEffText(ch.moves[k])}</span></button>`).join('')}</div>
        <h4>控えの技（${open.length}個）</h4>
        <div class="slot-list">${open.map(k => `<button type="button" class="slot-btn pool" data-pool="${k}"${sel === null ? ' aria-disabled="true"' : ''}><span class="num">控</span><span class="s-name">${esc(ch.moves[k].name)}</span><span class="eff">${moveEffText(ch.moves[k])}</span></button>`).join('') || '<p class="muted">ありません</p>'}</div>
        ${locked.length ? `<h4>まだ使えない技</h4><div class="slot-list">${locked.map(k => `<div class="slot-btn pool locked-move"><span class="num">鍵</span><span class="s-name">${esc(ch.moves[k].name)}</span><span class="eff">Lv${E.moveUnlockLevel(k)}で解放・${moveEffText(ch.moves[k])}</span></div>`).join('')}</div>` : ''}
        ${sel !== null ? `<p class="muted">選択中：出目${sel + 1}「${esc(ch.moves[draft[sel]].name)}」</p>` : ''}
        <div class="modal-actions">
          ${err ? `<div class="reason">保存できません：${esc(err)}</div>` : ''}
          <button type="button" class="btn btn-primary btn-block" id="btn-lo-save"${err ? ' disabled' : ''}>この構成で保存</button>
          <button type="button" class="btn btn-ghost btn-block" id="btn-lo-reset">初期構成に戻す</button>
          <button type="button" class="btn btn-ghost btn-block" data-close="1">保存せずに閉じる</button>
        </div>`;
      const b = $('#modal-body');
      b.querySelectorAll('[data-slot]').forEach(t => t.addEventListener('click', () => {
        const d = Number(t.dataset.slot);
        if (sel === null) sel = d;
        else if (sel === d) sel = null;
        else { [draft[sel], draft[d]] = [draft[d], draft[sel]]; sel = null; }
        draw();
      }));
      b.querySelectorAll('[data-pool]').forEach(t => t.addEventListener('click', () => {
        if (sel === null) { toast('先に、入れ替える出目の枠を選んでください'); return; }
        draft[sel] = Number(t.dataset.pool);
        sel = null;
        draw();
      }));
      b.querySelector('#btn-lo-reset').addEventListener('click', () => { draft = E.defaultLoadout(charId); sel = null; draw(); });
      b.querySelector('#btn-lo-save').addEventListener('click', () => {
        const r = P.setLoadout(app.profile, charId, draft);
        if (!r.ok) { toast(r.error); return; }
        save();
        closeModal(true);
        renderTeam();
        toast('技構成を保存しました', 'ok');
      });
    };
    openModal('', { kind: 'loadout' });
    draw();
  }

  /* ---------- CPU戦の共通処理 ---------- */
  function requireTeam() {
    const err = P.teamError(app.profile, app.profile.team);
    if (err) { toast('先にチームを6体で保存してください'); showTeam(); return false; }
    return true;
  }

  // ctx: { kind: 'free' | 'match' | 'dungeon', title, foeName, enemy: { ids, levels, leader }, boss, startHp, ... }
  function startCpuBattle(ctx) {
    if (!requireTeam()) return;
    const p = app.profile;
    const team = ctx.team || p.team.slice();
    ctx.team = team;
    const state = E.createBattle(team, ctx.enemy.ids, {
      loadouts: { player: P.loadoutsFor(p, team) },
      levels: { player: P.levelsFor(p, team), cpu: ctx.enemy.levels },
      enemyKind: ctx.kind === 'dungeon' ? 'boss' : undefined,
      startHp: ctx.startHp ? { player: ctx.startHp } : undefined
    });
    // CPUは自分のチームの情報だけで配置を決める（プレイヤーの選択は見ない）
    const cpuPlan = {
      front: CPU.chooseFormation(state, 'cpu', rng),
      leader: ctx.kind === 'dungeon' ? null
        : (ctx.enemy.leader !== undefined && ctx.enemy.leader !== null ? ctx.enemy.leader : CPU.chooseLeader(state, 'cpu', rng))
    };
    B.start({
      mode: 'cpu', state, cpuPlan, title: ctx.title, foeName: ctx.foeName, ...formationOpts(),
      bg: ctx.kind === 'dungeon' ? ctx.dungeonId : 'arena', onHelp: showHelp,
      onFinish: res => (ctx.kind === 'dungeon' ? onDungeonFloorFinish(ctx, res) : onMatchFinish(ctx, res)),
      onExit: () => (ctx.kind === 'dungeon' ? showDungeon() : showMatch()),
      onShowResult: () => app.lastResult && app.lastResult()
    });
  }

  // 出撃準備：前回の配置を初期値にし、出撃した配置を保存する
  function formationOpts() {
    return {
      formation: app.profile.formation || null,
      onFormation: fm => { app.profile.formation = fm; save(); }
    };
  }

  // レベルアップで新しく使えるようになった技
  function unlockedHtml(ups) {
    const list = [];
    ups.forEach(u => {
      const ch = E.getChar(u.id);
      ch.moves.forEach((m, k) => { const l = E.moveUnlockLevel(k); if (l > u.from && l <= u.to) list.push(`${ch.name}「${m.name}」`); });
    });
    return list.length ? `<p class="unlock-note">新しい技が使えるようになりました：${list.map(esc).join('、')}<br><span class="muted">「編成」の「技の入れ替え・並べ替え」で入れられます</span></p>` : '';
  }


  /* ---------- 戦闘結果（水彩の結果画面） ----------
   * 報酬・経験値・戦績は呼び出し側で確定済み（1回だけ）。ここは表示と演出だけで、演出の完了を条件にしない。
   * growth：[{ id, fromLv, fromExp, toLv, toExp, gained, hp? }]（成長前後の実際の値） */
  function snapTeam(ids) {
    const p = app.profile;
    return ids.filter(id => P.owns(p, id)).map(id => ({ id, lv: P.levelOf(p, id), exp: p.chars[id].exp || 0 }));
  }
  function growthFrom(snap, gained) {
    const p = app.profile;
    return snap.map(b => ({ id: b.id, fromLv: b.lv, fromExp: b.exp, toLv: P.levelOf(p, b.id), toExp: p.chars[b.id].exp || 0, gained: gained || 0 }));
  }
  const LV_MAX = CONFIG.LEVEL.max;
  const expPct = (lv, exp) => (lv >= LV_MAX ? 100 : Math.min(100, exp / P.expToNext(lv) * 100));
  // 経験値バーの区切り：レベルが上がるたびに 100% まで伸びて 0 から続ける
  function barPlan(g) {
    if (g.fromLv >= LV_MAX || !g.gained) return [{ from: expPct(g.toLv, g.toExp), to: expPct(g.toLv, g.toExp) }];
    const segs = [];
    let lv = g.fromLv, start = expPct(lv, g.fromExp);
    while (lv < g.toLv) { segs.push({ from: start, to: 100, up: lv + 1 }); start = 0; lv++; }
    segs.push({ from: start, to: expPct(g.toLv, g.toExp) });
    return segs;
  }
  function growthCard(g, k) {
    const ch = E.getChar(g.id);
    const up = g.toLv > g.fromLv;
    const stats = up ? [`HP ${E.levelMaxHp(ch.maxHp, g.fromLv)}→${E.levelMaxHp(ch.maxHp, g.toLv)}`, `攻撃+${E.levelAtkBonus(g.toLv) - E.levelAtkBonus(g.fromLv)}`, `技力+${E.loadoutBudget(g.id, g.toLv) - E.loadoutBudget(g.id, g.fromLv)}`] : [];
    const expText = g.toLv >= LV_MAX ? 'MAX' : `${g.toExp} / ${P.expToNext(g.toLv)}`;
    return `<div class="rs-card${up ? ' up' : ''}" data-k="${k}" style="--i:${k}">
      <span class="rs-art">${portrait(ch, { zoom: !E.isBoss(ch.id) })}${up ? `<span class="rs-badge">${g.toLv >= LV_MAX ? 'MAX LEVEL' : 'LEVEL UP'}</span>` : ''}</span>
      <span class="rs-info">
        <span class="rs-name">${elMark(ch)}<b>${esc(ch.name)}</b></span>
        <span class="rs-lvline"><span class="rs-lv">Lv <b class="rs-lv-from">${g.fromLv}</b><span class="rs-up"> → <b>${g.toLv}</b></span></span>${g.gained ? `<span class="rs-exp">EXP <b>+${g.gained}</b></span>` : ''}</span>
        <span class="rs-bar"><i></i></span>
        <span class="rs-sub">${g.hp !== undefined ? `<span class="rs-hp">${g.hp}</span>` : ''}<span class="rs-expnum">${expText}</span></span>
        ${up ? `<span class="rs-stats">${stats.map(esc).join('・')}</span>` : ''}
      </span>
    </div>`;
  }
  // o: { won, grand, kind, title, lines[], round, stones, stoneNote, expEach, growth, note, extra, buttons[{label, primary, run}], growthTitle }
  function showResult(o) {
    const render = animate => {
      const primary = o.buttons.filter(b => b.primary);
      const secondary = o.buttons.filter(b => !b.primary);
      const ups = o.growth.map(g => ({ id: g.id, from: g.fromLv, to: g.toLv })).filter(u => u.to > u.from);
      const laurel = side => `<svg class="rs-laurel ${side}" viewBox="0 0 40 90" aria-hidden="true"><path d="M30 88C10 70 6 40 20 4" fill="none" stroke="currentColor" stroke-width="2"/>${[12, 24, 36, 48, 60, 72].map((y, n) => `<ellipse cx="${n % 2 ? 26 : 14}" cy="${y}" rx="7" ry="3.2" transform="rotate(${n % 2 ? 35 : -35} ${n % 2 ? 26 : 14} ${y})" fill="currentColor"/>`).join('')}</svg>`;
      openModal(`<div class="rs ${o.won ? 'win' : 'lose'}${o.grand ? ' grand' : ''}${animate ? ' rs-play' : ' rs-done'}">
        ${animate ? '<button type="button" class="rs-skip" id="btn-rs-skip">スキップ</button>' : ''}
        <section class="rs-hero">
          <div class="rs-head">
            ${o.won ? laurel('l') : '<svg class="rs-moon" viewBox="0 0 40 40" aria-hidden="true"><path d="M26 4a16 16 0 1 0 10 28A13 13 0 0 1 26 4z" fill="currentColor"/></svg>'}
            <h3 class="rs-title">${o.grand ? '踏破' : o.won ? '勝利' : '敗北'}</h3>
            ${o.won ? laurel('r') : ''}
            ${o.won ? '<span class="rs-spark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}
          </div>
          <div class="rs-lines">${o.lines.map((t, n) => `<p class="${n === 0 ? 'rs-mode' : ''}">${esc(t)}</p>`).join('')}<p class="rs-round">第${o.round}巡で決着</p></div>
          ${o.stones ? `<div class="rs-reward"><span class="gem-wrap">${gemIcon()}</span><span>石</span><b class="rs-count" data-to="${o.stones}">+${o.stones}</b>${o.stoneNote ? `<small>${esc(o.stoneNote)}</small>` : ''}</div>` : ''}
          ${o.note ? `<p class="rs-note">${esc(o.note)}</p>` : ''}
        </section>
        <section class="rs-paper">
          <h4 class="rs-sec">${esc(o.growthTitle || '仲間の成長')}</h4>
          ${o.expEach ? `<p class="rs-each">各キャラ 経験値 +${o.expEach}</p>` : ''}
          <div class="rs-grid">${o.growth.map(growthCard).join('')}</div>
          ${o.extra || ''}
          ${unlockedHtml(ups)}
          ${!o.won && o.expEach ? '<p class="rs-cheer">成長を力に、もう一度。</p>' : ''}
          <div class="rs-actions">
            ${primary.map(b => `<button type="button" class="rs-btn rs-btn-main" data-act="${o.buttons.indexOf(b)}">${esc(b.label)}</button>`).join('')}
            ${secondary.length ? `<div class="rs-subs">${secondary.map(b => `<button type="button" class="rs-btn rs-btn-sub" data-act="${o.buttons.indexOf(b)}">${esc(b.label)}</button>`).join('')}</div>` : ''}
            <div class="rs-links"><button type="button" class="rs-link" id="btn-rs-home">ホーム</button><span aria-hidden="true">｜</span><button type="button" class="rs-link" data-close="1">戦闘ログ</button></div>
          </div>
        </section>
      </div>`, {
        kind: 'result',
        bind: b => {
          b.querySelectorAll('[data-act]').forEach(x => x.addEventListener('click', () => { closeModal(true); o.buttons[Number(x.dataset.act)].run(); }));
          b.querySelector('#btn-rs-home').addEventListener('click', () => { closeModal(true); showHome(); });
          playResult(b.querySelector('.rs'), o, animate);
        }
      });
    };
    // 2回目以降（戦闘ログから戻る）は演出なしで最終結果だけ
    app.lastResult = () => render(false);
    render(!U.FAST && !U.reducedMotion());
  }
  // 演出（約2秒）：見出し → 仲間 → 報酬のカウントアップ → 経験値バー・レベルアップ。スキップで即座に最終表示
  function playResult(root, o, animate) {
    const cards = Array.from(root.querySelectorAll('.rs-card'));
    const finalize = () => {
      if (!root.isConnected) return;
      timers.forEach(clearTimeout); timers.length = 0;
      root.classList.remove('rs-play'); root.classList.add('rs-done');
      root.querySelectorAll('.rs-count').forEach(c => { c.textContent = '+' + c.dataset.to; });
      cards.forEach((c, k) => {
        const g = o.growth[k];
        const i = c.querySelector('.rs-bar i');
        i.style.transition = 'none'; i.style.width = expPct(g.toLv, g.toExp) + '%';
        if (g.toLv > g.fromLv) c.classList.add('up-on');
      });
      const sk = root.querySelector('#btn-rs-skip');
      if (sk) sk.remove();
    };
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(() => { if (root.isConnected) fn(); }, ms));
    if (!animate) { finalize(); return; }
    root.querySelector('#btn-rs-skip').addEventListener('click', finalize);
    // 経験値バーは成長前の位置から
    cards.forEach((c, k) => { const i = c.querySelector('.rs-bar i'); i.style.transition = 'none'; i.style.width = barPlan(o.growth[k])[0].from + '%'; });
    // 報酬のカウントアップ（0.5〜1.1秒）
    root.querySelectorAll('.rs-count').forEach(c => {
      const to = Number(c.dataset.to);
      c.textContent = '+0';
      at(500, () => {
        const t0 = performance.now();
        const step = now => {
          if (!root.classList.contains('rs-play')) return;
          const k = Math.min(1, (now - t0) / 600);
          c.textContent = '+' + Math.round(to * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    });
    // 経験値バー（0.9〜1.7秒）。レベルが上がった瞬間に光と「Lv a → b」
    cards.forEach((c, k) => {
      const segs = barPlan(o.growth[k]);
      const i = c.querySelector('.rs-bar i');
      const per = 800 / segs.length;
      segs.forEach((sg, n) => {
        const t = 900 + k * 40 + n * per;
        at(t, () => { i.style.transition = 'none'; i.style.width = sg.from + '%'; void i.offsetWidth; i.style.transition = `width ${per * 0.9}ms ease-out`; i.style.width = sg.to + '%'; });
        if (sg.up) at(t + per * 0.9, () => { c.querySelector('.rs-lv-from').textContent = o.growth[k].fromLv; c.classList.add('up-on'); });
      });
    });
    at(2000, finalize);
  }

  /* ---------- 対戦（CPUチームと6対6） ---------- */
  function showMatch() {
    B.stop();
    go('match');
    const p = app.profile;
    const avg = teamAvgLevel();
    $('#match-team').textContent = P.teamError(p, p.team) ? 'チームが未完成です。先に6体を保存してください。'
      : '出撃チーム：' + p.team.map(id => `${E.getChar(id).name}(Lv${P.levelOf(p, id)})`).join('・');
    $('#match-list').innerHTML = `
      <div class="floor"><div class="floor-main"><b>フリー対戦</b><span class="muted">自分のチームと同じくらいの強さ（敵Lv${avg}）・毎回ちがう相手・経験値 勝ち40／負け10</span></div>
        <button type="button" class="btn btn-small btn-primary" data-match="free">挑戦</button></div>
      <h4>ランク戦（勝つと次の相手が出てくる）</h4>` +
      D.CPU_MATCHES.map(m => {
        const un = P.matchUnlocked(p, m.id);
        const won = !!p.matches.won[m.id];
        return `<div class="floor${won ? ' cleared' : ''}${un ? '' : ' locked'}">
          <div class="floor-main"><b>${esc(m.rank)}「${esc(m.name)}」</b><span class="muted">敵Lv${m.level}・経験値${m.exp}・石${won ? m.stones : m.firstStones + '（初勝利）'}</span>
            <span class="floor-enemies">${m.enemies.map(id => emblem(E.getChar(id), null, 'small')).join('')}</span></div>
          ${un ? `<button type="button" class="btn btn-small ${won ? 'btn-ghost' : 'btn-primary'}" data-match="${m.id}">${won ? '再戦' : '挑戦'}</button>` : '<span class="badge">未解放</span>'}
        </div>`;
      }).join('');
  }
  function teamAvgLevel() {
    const p = app.profile;
    if (!p.team.length) return 1;
    return Math.max(1, Math.round(p.team.reduce((a, id) => a + P.levelOf(p, id), 0) / p.team.length));
  }
  function startFree() {
    if (!requireTeam()) return;
    const avg = teamAvgLevel();
    const ids = E.randomTeam(rng);
    const levels = {};
    ids.forEach(id => { levels[id] = avg; });
    startCpuBattle({ kind: 'free', title: `フリー対戦（敵Lv${avg}）`, foeName: '敵チーム', enemy: { ids, levels, leader: null } });
  }
  function startMatch(id) {
    if (id === 'free') { startFree(); return; }
    if (!P.matchUnlocked(app.profile, id)) { toast('まだ挑戦できない相手です'); return; }
    const m = P.getMatch(id);
    startCpuBattle({ kind: 'match', matchId: id, title: `ランク戦 ${m.rank}「${m.name}」`, foeName: `${m.name}（Lv${m.level}）`, enemy: P.matchEnemy(id) });
  }
  function onMatchFinish(ctx, res) {
    const p = app.profile;
    const snap = snapTeam(ctx.team);
    let nextId = null, exp, stones = 0, note = '', lines;
    if (ctx.kind === 'match') {
      const r = P.applyMatchResult(p, ctx.matchId, ctx.team, res.won);
      exp = r.exp; stones = r.stones; note = r.firstWin ? '初勝利' : '';
      const k = D.CPU_MATCHES.findIndex(m => m.id === ctx.matchId);
      const m = D.CPU_MATCHES[k];
      if (res.won && D.CPU_MATCHES[k + 1]) nextId = D.CPU_MATCHES[k + 1].id;
      lines = ['ランク戦', `${m.rank}「${m.name}」`];
    } else {
      exp = res.won ? 40 : 10;
      ctx.team.forEach(id => P.addExp(p, id, exp));
      lines = ['フリー対戦', ctx.title.replace(/^フリー対戦/, '').replace(/[（）]/g, '') || ''];
    }
    save();
    const buttons = [];
    if (nextId) buttons.push({ label: '次の相手に挑戦', primary: true, run: () => startMatch(nextId) });
    buttons.push({ label: 'もう一度挑戦', primary: !nextId, run: () => (ctx.kind === 'match' ? startMatch(ctx.matchId) : startFree()) });
    buttons.push({ label: '対戦の一覧へ', run: showMatch });
    showResult({ won: res.won, kind: ctx.kind, lines: lines.filter(Boolean), round: res.state.round, stones, stoneNote: note, expEach: exp, growth: growthFrom(snap, exp), buttons });
  }

  /* ---------- ダンジョン（冒険の地図。雑魚 → 中ボス → 大ボス を順に倒す） ---------- */
  // カードの色：既存の3つは場所の色、それ以外は大ボスの属性の色
  const DG_THEMES = ['forest', 'sea', 'tower'];
  function dungeonTheme(d) {
    if (DG_THEMES.indexOf(d.id) >= 0) return d.id;
    const last = d.floors[d.floors.length - 1];
    return (last && E.getChar(last.boss) && E.getChar(last.boss).element) || 'nature';
  }
  function dungeonStatus(p, d) {
    const open = P.dungeonUnlocked(p, d.id);
    const cleared = P.dungeonCleared(p, d.id);
    const req = P.dungeonRequires(d).map(r => P.getDungeon(r)).filter(Boolean);
    return {
      open, cleared, req,
      key: cleared ? 'cleared' : open ? 'open' : 'locked',
      label: cleared ? '踏破済み' : open ? '挑戦可能' : '未解放',
      unlockText: req.length ? `${req.map(r => `「${r.name}」`).join('か')}を踏破で解放` : ''
    };
  }
  function dungeonArt(d) {
    const boss = E.getChar(d.floors[d.floors.length - 1].boss);
    return `<span class="dg-art" data-art="${esc(d.id)}" aria-hidden="true"><i>${esc(boss ? boss.glyph : '')}</i></span>`;
  }
  function teamFaces(p) {
    if (P.teamError(p, p.team)) return '<span class="dg-team-missing">チームが未完成です。「編成」で6体を保存してください。</span>';
    return `<span class="dg-faces">${p.team.map(id => {
      const ch = E.getChar(id);
      return `<span class="dg-face" title="${esc(ch.name)} Lv${P.levelOf(p, id)}">${emblem(ch, null, 'small')}<b>${P.levelOf(p, id)}</b></span>`;
    }).join('')}</span>`;
  }
  function showDungeon() {
    B.stop();
    go('dungeon');
    const p = app.profile;
    $('#dungeon-team').innerHTML = `<div class="dg-team-head"><span>出撃チーム</span><button type="button" class="dg-link" data-go="team">編成 ›</button></div>${teamFaces(p)}`;
    $('#dungeon-list').innerHTML = D.DUNGEONS.map(d => {
      const st = dungeonStatus(p, d);
      const fork = P.dungeonSiblings(d.id).length > 0;
      const reward = st.cleared ? `再挑戦報酬 ${gemIcon()}${d.clearStones}` : `初回報酬 ${gemIcon()}${d.firstClearStones}`;
      return `<button type="button" class="dg-card" data-dg="${esc(d.id)}" data-theme="${esc(dungeonTheme(d))}" data-state="${st.key}"
          aria-label="${esc(d.name)}（${st.label}・推奨 ${esc(d.recommend)}）の詳細を見る">
        ${dungeonArt(d)}
        <span class="dg-body">
          <span class="dg-row"><span class="dg-name">${esc(d.name)}</span><span class="dg-state">${st.label}</span></span>
          <span class="dg-text">${esc(d.text)}</span>
          <span class="dg-meta"><span>推奨 ${esc(d.recommend)}</span>${fork ? '<span class="dg-fork">分かれ道</span>' : ''}<span class="dg-reward">${reward}</span></span>
          <span class="dg-go">${st.open ? '<span>詳細を見る</span><span aria-hidden="true">›</span>' : `<span class="dg-lock">${esc(st.unlockText || '未解放')}</span><span>詳細</span>`}</span>
        </span>
      </button>`;
    }).join('');
    mapParallax.update();
  }
  // 詳細：敵3体・階層・報酬・出撃チームを確かめてから「挑む」
  function showDungeonDetail(id) {
    const p = app.profile;
    const d = P.getDungeon(id);
    if (!d) return;
    const st = dungeonStatus(p, d);
    const teamErr = P.teamError(p, p.team);
    const totalExp = d.floors.reduce((a, f) => a + f.exp, 0);
    const action = !st.open
      ? `<div class="dg-locked-note">${esc(st.unlockText || 'まだ挑戦できません')}</div><button type="button" class="dg-btn" disabled>未解放</button>`
      : teamErr ? `<div class="reason">${esc(teamErr)}</div><button type="button" class="dg-btn" id="btn-dg-team">編成へ</button>`
      : `<button type="button" class="dg-btn dg-btn-go" id="btn-dg-start" data-start="${esc(d.id)}">${st.cleared ? 'もう一度挑む' : '挑む'}</button>`;
    openModal(`<div class="dg-detail" data-theme="${esc(dungeonTheme(d))}" data-state="${st.key}">
        <div class="dg-detail-hero">${dungeonArt(d)}<div class="dg-detail-title"><h3>${esc(d.name)}</h3><span class="dg-state">${st.label}</span></div></div>
        <p class="dg-detail-text">${esc(d.text)}　<span class="muted">推奨 ${esc(d.recommend)}</span></p>
        <h4>階層と敵</h4>
        <ol class="dg-floors">${d.floors.map((f, i) => {
          const b = E.getChar(f.boss);
          return `<li class="dg-floor${i === d.floors.length - 1 ? ' last' : ''}">${emblem(b, null, 'big')}
            <span class="dg-floor-info"><span class="dg-floor-no">${i + 1}階・${esc(b.rank)}</span><b>${esc(b.name)}</b>
            <span class="muted">Lv${f.level}・HP${E.levelMaxHp(b.maxHp, f.level)}・${elementTag(b)}</span></span>
            <span class="dg-floor-exp">経験値<br>${f.exp}</span></li>`;
        }).join('')}</ol>
        <h4>報酬</h4>
        <div class="dg-rewards">
          <div class="${st.cleared ? 'done' : ''}"><span>初回踏破</span><b>${gemIcon()}${d.firstClearStones}</b>${st.cleared ? '<em>受け取り済み</em>' : ''}</div>
          <div><span>2回目以降</span><b>${gemIcon()}${d.clearStones}</b></div>
          <div><span>経験値（勝った階ごと）</span><b>合計 ${totalExp}</b></div>
        </div>
        <h4>出撃チーム</h4>
        <div class="dg-detail-team">${teamFaces(p)}</div>
        <p class="muted small-note">HPと戦闘不能は次の階に引き継ぎます。くわしくは「ダンジョンの遊び方」へ。</p>
        <div class="dg-actions">${action}<button type="button" class="dg-btn dg-btn-sub" data-close="1">一覧へ戻る</button></div>
      </div>`, {
      kind: 'dungeon',
      bind: b => {
        const go2 = b.querySelector('#btn-dg-start');
        if (go2) go2.addEventListener('click', () => { closeModal(true); startDungeon(id, 0); });
        const tm = b.querySelector('#btn-dg-team');
        if (tm) tm.addEventListener('click', () => { closeModal(true); showTeam(); });
      }
    });
  }
  function showDungeonRules() {
    const R = D.DUNGEON_RULES;
    openModal(`<h3>ダンジョンの遊び方</h3>
      <ol class="help-list">
        <li>自分の6体のチームで、1階の雑魚・2階の中ボス・3階の大ボスを1体ずつ順番に倒します。</li>
        <li>HPと戦闘不能は次の階に引き継ぎます。階の間に、生き残ったキャラは最大HPの${R.healBetweenFloorsPercent}%回復します。</li>
        <li>勝った階では経験値が入ります。負けた階でも${R.loseExpPercent}%もらえます。</li>
        <li>大ボスを倒すと踏破です。初回は多めの石、2回目以降も石がもらえます。</li>
        <li>前のダンジョンを踏破すると、次のダンジョンが解放されます。道が2つに分かれる所（分かれ道）は、どちらか1つを踏破すれば先へ進めます。</li>
        <li>途中経過は保存されません。やめたときは、次は1階からです。</li>
      </ol>
      <div class="modal-actions"><button type="button" class="btn btn-block" data-close="1">閉じる</button></div>`, { kind: 'dungeon-rules' });
  }
  // 地図の背景のパララックス：固定した背景の層を、スクロールの一部だけ上へずらす（iPhone の Safari でも動く transform 方式）。
  // 「視差効果を減らす」設定・動きの遅い端末では止めて静止背景にする。ずらす量は層の余白（--dg-extra）以内なので端は空かない
  const mapParallax = (() => {
    const RATE = 0.12;
    let ticking = false, enabled = null;
    const ok = () => {
      if (enabled !== null) return enabled;
      const mm = q => !!(window.matchMedia && window.matchMedia(q).matches);
      enabled = typeof window.requestAnimationFrame === 'function' && !mm('(prefers-reduced-motion: reduce)') && !mm('(update: slow)');
      return enabled;
    };
    function apply() {
      ticking = false;
      const bg = $('#dungeon-bg');
      if (!bg) return;
      if (!ok() || document.body.dataset.screen !== 'dungeon') { bg.style.transform = ''; return; }
      const max = bg.offsetHeight - window.innerHeight;
      const y = Math.max(0, Math.min(max > 0 ? max : 0, window.scrollY * RATE));
      bg.style.transform = `translate3d(0, ${-y.toFixed(1)}px, 0)`;
    }
    function update() {
      if (ticking) return;
      ticking = true;
      if (ok()) window.requestAnimationFrame(apply); else apply();
    }
    window.addEventListener('scroll', () => { if (document.body.dataset.screen === 'dungeon') update(); }, { passive: true });
    window.addEventListener('resize', () => { if (document.body.dataset.screen === 'dungeon') update(); }, { passive: true });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const reset = () => { enabled = null; update(); };
      if (mq.addEventListener) mq.addEventListener('change', reset); else if (mq.addListener) mq.addListener(reset);
    }
    return { update };
  })();
  function startDungeon(id, floor, startHp) {
    if (!P.dungeonUnlocked(app.profile, id)) { toast('まだ挑戦できないダンジョンです'); return; }
    const d = P.getDungeon(id);
    const f = d.floors[floor];
    const b = E.getChar(f.boss);
    startCpuBattle({
      kind: 'dungeon', dungeonId: id, floor, startHp,
      title: `${d.name} ${floor + 1}階（${b.rank}）`, foeName: `${b.name}（Lv${f.level}）`, enemy: P.floorEnemy(id, floor)
    });
  }
  function onDungeonFloorFinish(ctx, res) {
    const p = app.profile;
    const d = P.getDungeon(ctx.dungeonId);
    const snap = snapTeam(ctx.team);
    const r = P.applyDungeonFloor(p, ctx.dungeonId, ctx.floor, ctx.team, res.won);
    save();
    const units = res.state.teams[B.me()];
    const growth = growthFrom(snap, r.exp);
    const buttons = [];
    let extra = '', line2;
    if (res.won && !r.last) {
      const hp = P.carryOverHp(units);
      growth.forEach(g => { const u = units.find(x => x.charId === g.id); if (u) g.hp = hp[g.id] > 0 ? `HP ${hp[g.id]}/${u.maxHp}` : '戦闘不能'; });
      extra = `<p class="rs-carry">次の階へ引き継ぐHP（カードの数字）：生き残ったキャラは最大HPの${D.DUNGEON_RULES.healBetweenFloorsPercent}%回復します。</p>`;
      line2 = `${ctx.floor + 1}階 突破（全${d.floors.length}階）`;
      const nb = E.getChar(d.floors[ctx.floor + 1].boss);
      buttons.push({ label: `${ctx.floor + 2}階へ進む（${nb.rank}：${nb.name}）`, primary: true, run: () => startDungeon(ctx.dungeonId, ctx.floor + 1, hp) });
      buttons.push({ label: 'ここで引き返す', run: showDungeon });
    } else {
      line2 = r.cleared ? `全${d.floors.length}階 踏破` : `${ctx.floor + 1}階まで到達（全${d.floors.length}階）`;
      buttons.push({ label: r.cleared ? 'もう一度挑む' : '1階から挑み直す', primary: true, run: () => startDungeon(ctx.dungeonId, 0) });
      buttons.push({ label: 'ダンジョン一覧へ', run: showDungeon });
    }
    showResult({ won: res.won, grand: !!r.cleared, kind: 'dungeon', lines: [d.name, line2], round: res.state.round, stones: r.stones,
      stoneNote: r.firstClear ? '初回踏破' : (r.cleared ? '踏破' : ''), expEach: r.exp, growth, extra, buttons });
  }

  /* ---------- ガチャ ---------- */
  function showGacha() {
    go('gacha');
    renderGacha();
  }
  // ガチャの種類（通常・属性ごと）。値段はどれも同じ
  let gachaKind = 'all';
  function renderGacha() {
    const p = app.profile;
    if (!P.getGacha(gachaKind)) gachaKind = 'all';
    const g = P.getGacha(gachaKind);
    const pool = P.gachaPool(gachaKind);
    $('#gacha-kinds').innerHTML = D.GACHAS.map(k => `<button type="button" class="gk-btn" data-gacha-kind="${k.id}" aria-pressed="${k.id === gachaKind}"${k.element ? ` data-el="${k.element}"` : ''}>${k.element ? `<span class="el-ico" data-el="${k.element}" aria-hidden="true"></span>` : ''}${esc(k.element ? D.ELEMENTS[k.element].name : '通常')}</button>`).join('');
    $('#gacha-kind-text').innerHTML = `<b>${esc(g.name)}</b>：${esc(g.text)}`;
    $('#gacha-stones').textContent = p.stones;
    const b1 = $('#btn-gacha-1'), b10 = $('#btn-gacha-10');
    b1.textContent = `1回引く（石${P.gachaCost(1)}）`;
    b10.textContent = `10回引く（石${P.gachaCost(10)}）`;
    b1.disabled = p.stones < P.gachaCost(1) || !pool.length;
    b10.disabled = p.stones < P.gachaCost(10) || !pool.length;
    const owned = pool.filter(id => P.owns(p, id)).length;
    $('#gacha-pool-title').textContent = `${g.name}で呼び出せるキャラ（${pool.length}体・所持${owned}体）`;
    $('#gacha-pool').innerHTML = pool.map(id => E.getChar(id)).map(ch => `<div class="pool-item${P.owns(p, ch.id) ? '' : ' missing'}">${emblem(ch, P.owns(p, ch.id) ? null : { hp: 0 }, 'small')}<span>${esc(ch.name)}${starsHtml(ch)}</span><span class="muted">${P.owns(p, ch.id) ? 'Lv' + P.levelOf(p, ch.id) : '未所持'}</span></div>`).join('');
  }
  let gachaBusy = false;
  function pullGacha(count) {
    if (gachaBusy) return;
    gachaBusy = true;
    const r = P.drawGacha(app.profile, count, rng, gachaKind);
    if (!r.ok) { gachaBusy = false; toast(r.error); return; }
    save();
    renderGacha();
    openModal(`<h3>${esc(P.getGacha(gachaKind).name)}の結果（${count}回）</h3>
      <div class="gacha-results">${r.results.map((x, i) => {
        const ch = E.getChar(x.id);
        return `<div class="gacha-card${x.isNew ? ' new' : ''}" style="animation-delay:${U.FAST ? 0 : i * 90}ms">${emblem(ch, null, 'big')}<b>${esc(ch.name)}</b>${starsHtml(ch)}
          ${x.isNew ? '<span class="badge leader">NEW 仲間になった</span>' : `<span class="muted">経験値+${x.exp}${x.to > x.from ? `<br>Lv${x.from}→${x.to}` : ''}</span>`}</div>`;
      }).join('')}</div>
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button></div>`,
    { kind: 'gacha', onClose: () => { gachaBusy = false; } });
  }

  /* ---------- プレイヤー対戦（ロビー） ---------- */
  function mySetup() {
    const p = app.profile;
    return { team: p.team.slice(), levels: P.levelsFor(p, p.team), loadouts: P.loadoutsFor(p, p.team) };
  }
  function leaveLobby() {
    if (app.lobby.unwatch) { try { app.lobby.unwatch(); } catch (e) { /* noop */ } }
    app.lobby.unwatch = null;
    if (app.lobby.role === 'host' && app.lobby.code && !app.lobby.starting) app.backend.deleteRoom(app.lobby.code);
    app.lobby = { code: null, unwatch: null, role: null, starting: false };
  }
  function showLobby() {
    if (!requireTeam()) return;
    leaveLobby();
    go('lobby');
    $('#lobby-note').textContent = app.backend.mode === 'local'
      ? 'この端末のブラウザだけで遊ぶモードです。同じブラウザで別のタブを開き、別のプレイヤーでログインすると対戦できます。離れた人と遊ぶにはオンライン版（Firebase設定済みのURL）を使ってください。'
      : 'ルームを作って相手にコードを伝えるか、相手のコードで参加します。待機中のルームにそのまま参加することもできます。';
    $('#lobby-body').innerHTML = `
      <div class="lobby-actions">
        <button type="button" class="btn btn-primary btn-block" id="btn-room-create">ルームを作る</button>
        <form id="join-form" class="join-form"><label class="field"><span>ルームコード（6文字）</span><input id="in-code" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="例：K7P2QX"></label>
        <button type="submit" class="btn btn-ghost">参加する</button></form>
      </div>
      <h4>待機中のルーム <button type="button" class="btn btn-small btn-ghost" id="btn-room-refresh">更新</button></h4>
      <div id="room-list" class="target-list"><p class="muted">読み込み中…</p></div>`;
    $('#btn-room-create').addEventListener('click', createRoom);
    $('#join-form').addEventListener('submit', e => { e.preventDefault(); joinRoom($('#in-code').value); });
    $('#btn-room-refresh').addEventListener('click', refreshRooms);
    refreshRooms();
  }
  async function refreshRooms() {
    const box = $('#room-list');
    if (!box) return;
    try {
      const list = (await app.backend.listOpenRooms()).filter(r => !r.mine);
      box.innerHTML = list.length
        ? list.map(r => `<button type="button" class="target-btn" data-room="${esc(r.code)}"><span class="t-main"><b>${esc(r.hostName)}</b> のルーム<br><span class="muted">コード ${esc(r.code)}</span></span><span class="t-check">参加</span></button>`).join('')
        : '<p class="muted">待機中のルームはありません。</p>';
      box.querySelectorAll('[data-room]').forEach(b => b.addEventListener('click', () => joinRoom(b.dataset.room)));
    } catch (e) { box.innerHTML = `<p class="reason">${esc(e.message)}</p>`; }
  }
  async function createRoom() {
    try {
      const code = await app.backend.createRoom({ name: app.profile.name, setup: mySetup() });
      app.lobby.code = code;
      app.lobby.role = 'host';
      $('#lobby-body').innerHTML = `<div class="room-wait"><p>ルームを作りました。相手にこのコードを伝えてください。</p>
        <div class="room-code" id="room-code">${esc(code)}</div>
        <p class="phase-text">相手の参加を待っています…</p>
        <button type="button" class="btn btn-ghost btn-block" id="btn-room-cancel">ルームを閉じる</button></div>`;
      $('#btn-room-cancel').addEventListener('click', showLobby);
      app.lobby.unwatch = app.backend.watchRoom(code, room => onHostRoom(code, room));
    } catch (e) { toast(e.message); }
  }
  function onHostRoom(code, room) {
    if (!room || app.lobby.code !== code || app.lobby.starting) return;
    if (room.status !== 'ready' || !room.guest) return;
    app.lobby.starting = true;
    if (app.lobby.unwatch) app.lobby.unwatch();
    const host = room.host, guest = room.guest;
    let state;
    try {
      state = E.createBattle(host.team, guest.team, {
        loadouts: { player: host.loadouts, cpu: guest.loadouts },
        levels: { player: host.levels, cpu: guest.levels },
        labels: { player: { team: room.hostName + 'のチーム', who: room.hostName }, cpu: { team: room.guestName + 'のチーム', who: room.guestName } }
      });
    } catch (e) {
      app.backend.updateRoom(code, { status: 'closed' }).catch(() => {});
      toast('相手のチーム設定が正しくありません：' + e.message);
      showLobby();
      return;
    }
    startPvp('pvp-host', code, room.guestName, state);
  }
  async function joinRoom(raw) {
    const code = BK.normalizeCode(raw);
    if (code.length !== 6) { toast('ルームコードは6文字です'); return; }
    try {
      await app.backend.joinRoom(code, { name: app.profile.name, setup: mySetup() });
      app.lobby.code = code;
      app.lobby.role = 'guest';
      $('#lobby-body').innerHTML = `<div class="room-wait"><p>ルーム <b>${esc(code)}</b> に参加しました。</p><p class="phase-text">ホストの準備を待っています…</p></div>`;
      app.lobby.unwatch = app.backend.watchRoom(code, room => {
        if (!room || app.lobby.starting) return;
        if (room.status === 'closed') { toast('ルームが閉じられました'); showLobby(); return; }
        if (room.stateJson) {
          app.lobby.starting = true;
          if (app.lobby.unwatch) app.lobby.unwatch();
          startPvp('pvp-guest', code, room.hostName, null);
        }
      });
    } catch (e) { toast(e.message); }
  }
  function startPvp(mode, code, foeName, state) {
    const unwatchLobby = app.lobby.unwatch;
    app.lobby.unwatch = null;
    if (unwatchLobby) { try { unwatchLobby(); } catch (e) { /* noop */ } }
    B.start({
      mode, state, code, backend: app.backend, foeName, title: `プレイヤー対戦（ルーム ${code}）`, ...formationOpts(), bg: 'arena', onHelp: showHelp,
      onFinish: res => onPvpFinish(foeName, res),
      onExit: showLobby,
      onShowResult: () => app.lastResult && app.lastResult()
    });
    app.lobby = { code: null, unwatch: null, role: null, starting: false };
  }
  function onPvpFinish(foeName, res) {
    const r = P.applyPvpResult(app.profile, res.won, new Date());
    save();
    const team = app.profile.team.filter(id => P.owns(app.profile, id));
    const lines = ['プレイヤー対戦', `${foeName} との対戦`];
    if (res.surrendered) lines.push(res.surrendered === B.me() ? 'あなたが降参しました' : '相手が降参しました');
    showResult({ won: res.won, kind: 'pvp', lines, round: res.state.round, stones: r.stones, note: `今日の対人戦報酬 ${r.rewardedToday} / ${r.limit} 回`,
      expEach: 0, growthTitle: '戦った仲間', growth: growthFrom(snapTeam(team), 0),
      buttons: [{ label: 'ロビーへ', primary: true, run: () => { B.stop(); showLobby(); } }] });
  }

  /* ---------- 遊び方 ---------- */
  /* ---------- 設定（遊び方・ログアウト） ---------- */
  function showSettings() {
    const p = app.profile;
    openModal(`<h3>設定</h3>
      <div class="profile-stats">
        <div><span>石</span><b>${p.stones}</b></div>
        <div><span>所持キャラ</span><b>${P.ownedIds(p).length} / ${P.ALL_IDS.length}</b></div>
        <div><span>対人戦</span><b>${p.pvp.wins}勝 ${p.pvp.losses}敗</b></div>
      </div>
      <p class="muted">${esc(p.name)}・${esc(app.backend.label)}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-block" id="btn-settings-help">遊び方</button>
        <button type="button" class="btn btn-ghost btn-block" data-go="logout">ログアウト<small class="btn-sub">${app.backend.mode === 'local' ? '別のプレイヤーに切り替える' : 'このアカウントからログアウト'}</small></button>
        <button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button>
      </div>`, { kind: 'settings', bind: b => b.querySelector('#btn-settings-help').addEventListener('click', () => { closeModal(true); showHelp(); }) });
  }

  /* ---------- 図鑑 ---------- */
  let zukanFilter = 'all';
  function showZukan() {
    go('zukan');
    renderZukan();
  }
  function renderZukan() {
    const p = app.profile;
    $('#zukan-count').textContent = P.ownedIds(p).length;
    $('#zukan-total').textContent = E.CHARACTERS.length;
    $('#zukan-filter').innerHTML = elFilterHtml(zukanFilter);
    $('#zukan-grid').innerHTML = E.CHARACTERS.filter(ch => zukanFilter === 'all' || ch.element === zukanFilter).map(ch => {
      const owned = P.owns(p, ch.id);
      return `<button type="button" class="zukan-card el-frame${owned ? '' : ' missing'}" ${frameAttrs(ch)} data-zukan="${ch.id}" aria-label="${esc(ch.name)}${owned ? '' : '（未所持）'}の詳細">
        <span class="zk-art">${portrait(ch, { dim: !owned })}<span class="zk-el" data-el="${esc(ch.element)}"><span class="el-ico" data-el="${esc(ch.element)}" aria-hidden="true"></span></span>${owned ? levelTag(P.levelOf(p, ch.id)) : '<span class="lv-tag">未所持</span>'}</span>
        <span class="zk-plate"><b class="zk-name">${esc(ch.name)}</b>${starsHtml(ch)}</span></button>`;
    }).join('');
  }
  function showZukanEntry(id) {
    const ch = E.getChar(id);
    const p = app.profile;
    const owned = P.owns(p, id);
    const lv = owned ? P.levelOf(p, id) : 1;
    const lo = owned ? P.loadoutsFor(p, [id])[id] : E.defaultLoadout(id);
    const moves = ch.moves.map((m, k) => {
      const slot = lo.indexOf(k);
      const unlock = E.moveUnlockLevel(k);
      const lockNote = unlock > 1 ? ` <small class="${unlock > lv ? 'reason' : 'muted'}">Lv${unlock}〜</small>` : '';
      return `<li class="${slot >= 0 ? 'hit' : ''}"><span class="num">${slot >= 0 ? slot + 1 : '・'}</span><span>${esc(m.name)}${lockNote}</span><span class="eff">${moveEffText(m)}</span></li>`;
    }).join('');
    openModal(`<div class="zk-detail">${portrait(ch, { dim: !owned })}<div>
        <h3>${esc(ch.name)}${starsHtml(ch)}</h3>
        <div>${elementTag(ch)}${subTags(ch)}</div>
        <p class="hptext">${owned ? `Lv${lv}・最大HP <b>${E.levelMaxHp(ch.maxHp, lv)}</b>（基礎${ch.maxHp}）` : `最大HP <b>${ch.maxHp}</b>（Lv1）・<span class="reason">未所持</span>`}</p>
      </div></div>
      <h4>技（候補${ch.moves.length}個・番号は${owned ? '今の' : '初期の'}出目）</h4>
      <p class="muted">技力の上限 ${E.loadoutBudget(id, lv)}（Lv${lv}）。「Lv○〜」の技はそのレベルから入れ替えに使えます。</p>
      <ul class="moves">${moves}</ul>
      <div class="effect-box"><b>固有スキル「${esc(ch.skill.name)}」</b> CD${ch.skill.cd}<br><span class="muted">${esc(ch.skill.text)}</span></div>
      ${leaderBox(ch)}
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button></div>`, { kind: 'zukan' });
  }

  function showHelp() {
    const E2 = D.ECONOMY;
    openModal(`<h3>遊び方</h3>
      <h4>戦い方</h4>
      <ol class="help-list">
        <li>持っているキャラから異なる6体でチームを作ります。戦闘前に前衛3体・後衛3体と<b>リーダー</b>を決めます。</li>
        <li><b>先攻・後攻はサイコロ</b>で決めます。大きい数を出した方が先攻、同じ数なら振り直しです。</li>
        <li>自分のターンは「数字を出す」→（必要なら交代1回・固有スキル1回。どちらが先でもよい）→ 前衛から1体の「出目に対応する技」を1つ使う、の順です。交代や選び直しで数字は変わりません（振り直しスキルだけ例外）。</li>
        <li>攻撃は<b>敵前衛全員</b>、回復は<b>味方前衛全員</b>にそれぞれ全量。後衛は攻撃も回復も受けません。固有スキルは後衛のキャラも使えます。</li>
        <li>前衛が倒れたら後衛から補充します。6体すべてが戦闘不能になったら負けです。</li>
      </ol>
      <h4>遊び方の種類</h4>
      <ul class="help-list">
        <li><b>対戦（CPU）</b>：CPUのチームと6対6。ランク戦は勝つと次の相手が出てきます。フリー対戦は自分と同じくらいの強さの相手です。</li>
        <li><b>ダンジョン</b>：6人のチームで、1階の雑魚・2階の中ボス・3階の大ボスを1体ずつ順に倒します。HPと戦闘不能は次の階に引き継ぎ（階の間に生存キャラが最大HPの${D.DUNGEON_RULES.healBetweenFloorsPercent}%回復）。大ボスを倒すと踏破です。</li>
        <li><b>プレイヤー対戦</b>：ルームを作ってコードを伝えるか、コードで参加します。</li>
      </ul>
      <h4>成長</h4>
      <ul class="help-list">
        <li><b>レベル</b>：1レベルごとに最大HP+${CONFIG.LEVEL.hpPercentPerLevel}%、通常技の攻撃+${CONFIG.LEVEL.atkPerLevel}（攻撃0の技は除く）。最大Lv${CONFIG.LEVEL.max}。</li>
        <li><b>経験値</b>：対戦・ダンジョン（勝利で全量・敗北で3割）、ガチャで同じキャラが出たとき（+${E2.duplicateExp}）。</li>
        <li><b>技のカスタム</b>：各キャラ9個の技から6個を選び、出目1〜6の順番を決められます（技力の上限あり）。7・8・9個目の技はLv${CONFIG.LEVEL.moveUnlock.join('・')}で解放、技力の上限は1レベルごとに+${CONFIG.LEVEL.powerPerLevel}。</li>
        <li><b>リーダースキル</b>：リーダーにしたキャラの効果が戦闘中ずっと有効です。</li>
      </ul>
      <h4>石の集め方</h4>
      <ul class="help-list">
        <li>ログインボーナス：1日1回（連続日数で ${E2.loginBonus.join('・')}）。日本時間0時に切り替わり。</li>
        <li>対戦（ランク戦）の初勝利、ダンジョンの踏破（初回は多め）。</li>
        <li>対人戦：勝利${E2.pvpWinStones}・敗北${E2.pvpLoseStones}（1日${E2.pvpRewardsPerDay}回まで）。</li>
        <li>ガチャ：1回${E2.gachaCost}・10回${E2.gacha10Cost}。</li>
      </ul>
      <h4>属性相性（通常技の攻撃のみ ×${CONFIG.ADVANTAGE_MULTIPLIER}）</h4>
      <p>${['water', 'fire', 'nature', 'water'].map(k => D.ELEMENTS[k].name).join(' → ')}、${D.ELEMENTS.holy.name} ⇄ ${D.ELEMENTS.dark.name}。それ以外は等倍です。</p>
      <h4>計算の順番</h4>
      <p class="muted">基礎ダメージ ×スキル倍率 ＋（スキル・リーダー・レベルの加算）→ 属性倍率 → 結界（半減）→ 最後に四捨五入。</p>
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button></div>`, { kind: 'help' });
  }

  /* ---------- イベント登録 ---------- */
  function bindAll() {
    $('#btn-help').addEventListener('click', showHelp);
    $('#btn-login-help').addEventListener('click', showHelp);
    $('#btn-home').addEventListener('click', () => { if (app.profile) showHome(); });
    $('#btn-settings').addEventListener('click', showSettings);
    // ホームのメニュー・下のタブ・設定の中のボタン（data-go）
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-go]');
      if (!b || !app.profile) return;
      const g = b.dataset.go;
      if (g === 'logout') { closeModal(true); app.profile = null; app.backend.signOut(); return; }
      if (document.body.dataset.screen === 'lobby' && g !== 'lobby') leaveLobby();
      if (g === 'home') showHome();
      else if (g === 'dungeon') showDungeon();
      else if (g === 'match') showMatch();
      else if (g === 'lobby') showLobby();
      else if (g === 'gacha') showGacha();
      else if (g === 'team') showTeam();
      else if (g === 'zukan') showZukan();
    });
    $('#zukan-grid').addEventListener('click', e => {
      const c = e.target.closest('[data-zukan]');
      if (c) showZukanEntry(c.dataset.zukan);
    });
    $('#team-grid').addEventListener('click', e => {
      const info = e.target.closest('[data-info]');
      if (info) { showTeamChar(info.dataset.info); return; }
      const c = e.target.closest('[data-pick]');
      if (c) togglePick(c.dataset.pick);
    });
    // 上の6枠：タップで詳細（ドラッグした直後のクリックは無視）
    ['#team-front', '#team-back'].forEach(sel => $(sel).addEventListener('click', e => {
      if (U.tapGuarded() || (teamUI.dragger && teamUI.dragger.suppressed())) return;
      const card = e.target.closest('.tm-card');
      if (!card) return;
      if (card.dataset.id) showTeamChar(card.dataset.id);
      else toast('下の所持キャラをタップすると、空いている枠に入ります');
    }));
    ['#team-front', '#team-back'].forEach(sel => $(sel).addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tm-card[data-id]')) { e.preventDefault(); showTeamChar(e.target.dataset.id); }
    }));
    $('#team-filter').addEventListener('click', e => {
      const b = e.target.closest('[data-filter]');
      if (b) { teamUI.filter = b.dataset.filter; renderTeam(); }
    });
    $('#zukan-filter').addEventListener('click', e => {
      const b = e.target.closest('[data-filter]');
      if (b) { zukanFilter = b.dataset.filter; renderZukan(); }
    });
    $('#btn-team-back').addEventListener('click', showHome);
    $('#btn-team-ok').addEventListener('click', () => {
      const ids = teamUI.slots.slice();
      const r = P.setTeam(app.profile, ids);
      if (!r.ok) { toast(r.error); return; }
      // 上の段（前衛）とリーダーは、出撃準備の初期配置として覚える
      app.profile.formation = { front: ids.slice(0, CONFIG.FRONT_SIZE), leader: teamUI.leader || ids[0] };
      save();
      toast('編成を保存しました', 'ok');
      showHome();
    });
    $('#dungeon-list').addEventListener('click', e => {
      const b = e.target.closest('[data-dg]');
      if (b && !U.tapGuarded()) showDungeonDetail(b.dataset.dg);
    });
    $('#btn-dungeon-rules').addEventListener('click', showDungeonRules);
    $('#match-list').addEventListener('click', e => {
      const b = e.target.closest('[data-match]');
      if (b) startMatch(b.dataset.match);
    });
    $('#gacha-kinds').addEventListener('click', e => {
      const b = e.target.closest('[data-gacha-kind]');
      if (!b || gachaBusy) return;
      gachaKind = b.dataset.gachaKind;
      renderGacha();
    });
    $('#btn-gacha-1').addEventListener('click', () => pullGacha(1));
    $('#btn-gacha-10').addEventListener('click', () => pullGacha(10));
  }

  // テスト・デバッグ用（ゲーム進行には使わない）
  window.RikuyouApp = {
    getState: () => B.getState(),
    isLocked: () => B.isLocked(),
    getSession: () => B.getSession(),
    getProfile: () => app.profile,
    backendMode: () => app.backend && app.backend.mode,
    me: () => B.me()
  };

  boot();
})();
