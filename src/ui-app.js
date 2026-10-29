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
  const { E, CONFIG, rng, $, esc, emblem, elementTag, subTags, levelTag, moveEffText, movesList, leaderBox, openModal, closeModal, toast, showScreen } = U;

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
    if (p) chip.innerHTML = `石 <b>${p.stones}</b>`;
    $('#btn-home').classList.toggle('hidden', !p || document.body.dataset.screen === 'home' || document.body.dataset.screen === 'battle');
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
      ? 'この端末のブラウザに保存して遊びます（オフライン）。プレイヤー対戦は同じ端末の別タブ同士で遊べます。'
      : 'アカウントに保存して遊びます。どの端末からでも続きができ、離れたプレイヤーと対戦できます。';
    if (local) {
      const players = app.backend.localPlayers();
      $('#login-body').innerHTML = `
        ${players.length ? `<h4>この端末のプレイヤー</h4><div class="target-list">${players.map(p => `<button type="button" class="target-btn" data-local="${esc(p.uid)}"><span class="t-main"><b>${esc(p.name)}</b> で続ける</span></button>`).join('')}</div>` : ''}
        <h4>新しくはじめる</h4>
        <label class="field"><span>プレイヤー名</span><input id="in-name" maxlength="16" autocomplete="nickname" placeholder="例：はるの"></label>
        <button type="button" class="btn btn-primary btn-block" id="btn-local-start">はじめる</button>
        ${app.backend.adminCodeEnabled && app.backend.adminCodeEnabled() ? `<details class="admin-login"><summary>管理用アカウントで入る</summary>
          <p class="muted">管理用コードを持っている人だけが使えます。全キャラクターを持った状態で遊べます（この端末に保存）。</p>
          <label class="field"><span>名前</span><input id="in-admin-name" maxlength="16" autocomplete="off" placeholder="例：管理人"></label>
          <label class="field"><span>管理用コード</span><input id="in-admin-code" type="password" autocomplete="off"></label>
          <button type="button" class="btn btn-ghost btn-block" id="btn-admin-start">管理用アカウントではじめる</button></details>` : ''}`;
      $('#login-body').querySelectorAll('[data-local]').forEach(b => b.addEventListener('click', () => doAuth(() => app.backend.signIn({ uid: b.dataset.local }))));
      $('#btn-local-start').addEventListener('click', () => doAuth(() => app.backend.signIn({ name: $('#in-name').value })));
      const ab = $('#btn-admin-start');
      if (ab) ab.addEventListener('click', () => doAuth(() => app.backend.signIn({ name: $('#in-admin-name').value || '管理人', adminCode: $('#in-admin-code').value })));
    } else {
      let signup = false;
      const draw = () => {
        $('#login-body').innerHTML = `
          <div class="tabs"><button type="button" class="tab${signup ? '' : ' on'}" data-tab="in">ログイン</button><button type="button" class="tab${signup ? ' on' : ''}" data-tab="up">新規登録</button></div>
          <form id="auth-form" class="auth-form">
            ${signup ? '<label class="field"><span>プレイヤー名（表示名）</span><input id="in-name" maxlength="16" autocomplete="nickname" required></label>' : ''}
            <label class="field"><span>メールアドレス</span><input id="in-email" type="email" autocomplete="email" required></label>
            <label class="field"><span>パスワード（6文字以上）</span><input id="in-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></label>
            <button type="submit" class="btn btn-primary btn-block" id="btn-auth">${signup ? '登録してはじめる' : 'ログイン'}</button>
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
    $('#home-profile').innerHTML = `
      <div class="profile-row">
        <div><div class="profile-name">${esc(p.name)} ${p.isAdmin ? '<span class="badge leader">管理用アカウント</span>' : ''}</div>
        <div class="muted">${esc(app.backend.label)}</div></div>
        <div class="profile-stats">
          <div><span>石</span><b>${p.stones}</b></div>
          <div><span>所持キャラ</span><b>${owned} / ${P.ALL_IDS.length}</b></div>
          <div><span>対人戦</span><b>${p.pvp.wins}勝 ${p.pvp.losses}敗</b></div>
        </div>
      </div>
      ${P.teamError(p, p.team) ? '<p class="reason">チームが未完成です。「チーム・キャラ」で6体を選んで保存してください。</p>' : `<div class="team-strip">${p.team.map(id => { const ch = E.getChar(id); return `<span class="team-chip">${emblem(ch, null, 'small')}${esc(ch.name)} ${levelTag(P.levelOf(p, id))}</span>`; }).join('')}</div>`}`;
    renderBonus();
    $('#logout-sub').textContent = app.backend.mode === 'local' ? '別のプレイヤーに切り替える' : 'このアカウントからログアウト';
    if (!app.bonusOffered && !P.loginStatus(p).claimed) { app.bonusOffered = true; showBonusModal(); }
  }

  function renderBonus() {
    const st = P.loginStatus(app.profile);
    const cycle = D.ECONOMY.loginBonus.map((v, i) => `<span class="bonus-day${i + 1 < st.dayInCycle || (st.claimed && i + 1 === st.dayInCycle) ? ' got' : ''}${i + 1 === st.dayInCycle ? ' today' : ''}"><small>${i + 1}日目</small>${v}</span>`).join('');
    $('#home-bonus').innerHTML = `<div class="bonus-head"><b>ログインボーナス</b><span class="muted">連続${st.claimed ? st.streak : st.streak}日目・日本時間の0時に切り替わり</span></div>
      <div class="bonus-days">${cycle}</div>
      ${st.claimed ? '<p class="muted">今日の分は受け取り済みです。また明日。</p>' : `<button type="button" class="btn btn-primary btn-block" id="btn-bonus">今日のボーナスを受け取る（石 +${st.amount}）</button>`}`;
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

  /* ---------- チーム・キャラ ---------- */
  function showTeam() {
    go('team');
    app.picked = P.teamError(app.profile, app.profile.team) ? app.profile.team.filter(id => P.owns(app.profile, id)) : app.profile.team.slice();
    renderTeam();
  }
  function renderTeam() {
    const p = app.profile;
    $('#team-grid').innerHTML = E.CHARACTERS.map(ch => {
      const owned = P.owns(p, ch.id);
      const sel = app.picked.indexOf(ch.id) >= 0;
      if (!owned) {
        return `<div class="pick-card locked"><span class="pick-mark">未所持</span>
          <div class="uc-head">${emblem(ch, { hp: 0 }, 'big')}<div><div class="uc-name">${esc(ch.name)}</div><div>${elementTag(ch)}${subTags(ch)}</div></div></div>
          <p class="muted">ガチャで仲間にできます。</p>${leaderBox(ch)}</div>`;
      }
      const c = p.chars[ch.id];
      const lo = p.loadouts[ch.id] || E.defaultLoadout(ch.id);
      const custom = !!p.loadouts[ch.id];
      const maxed = c.level >= CONFIG.LEVEL.max;
      return `<div class="pick-card${sel ? ' selected' : ''}" data-pick="${ch.id}" role="button" tabindex="0" aria-pressed="${sel}">
        <span class="pick-mark">${sel ? '選択中 ' + (app.picked.indexOf(ch.id) + 1) : '未選択'}</span>
        <div class="uc-head">${emblem(ch, null, 'big')}<div><div class="uc-name">${esc(ch.name)} ${levelTag(c.level)}</div>
        <div>${elementTag(ch)}${subTags(ch)}</div>
        <div class="hptext">最大HP <b>${E.levelMaxHp(ch.maxHp, c.level)}</b>${c.level > 1 ? `（基礎${ch.maxHp}）・攻撃+${E.levelAtkBonus(c.level)}` : ''}</div></div></div>
        <div class="exp-line"><span class="muted">${maxed ? '最大レベル' : `次のレベルまで ${P.expToNext(c.level) - c.exp}`}</span><div class="hpbar exp"><i style="width:${maxed ? 100 : c.exp / P.expToNext(c.level) * 100}%"></i></div></div>
        <div class="lo-head"><span>技構成（出目1〜6）${custom ? ' <span class="badge ready">カスタム</span>' : ''}</span><span class="muted">技力 ${E.loadoutPower(ch.id, lo)} / ${E.loadoutBudget(ch.id)}・候補${ch.moves.length}個</span></div>
        ${movesList(ch, null, lo)}
        <button type="button" class="btn btn-small btn-ghost btn-block btn-edit" data-edit="${ch.id}">技の入れ替え・並べ替え</button>
        <div class="effect-box"><b>固有スキル「${esc(ch.skill.name)}」</b> CD${ch.skill.cd}<br><span class="muted">${esc(ch.skill.text)}</span></div>
        ${leaderBox(ch)}
      </div>`;
    }).join('');
    $('#team-count').textContent = app.picked.length;
    $('#btn-team-ok').disabled = app.picked.length !== CONFIG.TEAM_SIZE;
  }
  function togglePick(id) {
    if (!P.owns(app.profile, id)) return;
    const k = app.picked.indexOf(id);
    if (k >= 0) app.picked.splice(k, 1);
    else if (app.picked.length < CONFIG.TEAM_SIZE) app.picked.push(id);
    else toast(`チームは${CONFIG.TEAM_SIZE}体までです。外したいキャラをもう一度タップしてください`);
    renderTeam();
  }

  function showLoadoutEditor(charId) {
    const ch = E.getChar(charId);
    let draft = (app.profile.loadouts[charId] || E.defaultLoadout(charId)).slice();
    let sel = null;
    const draw = () => {
      const err = E.loadoutError(charId, draft);
      const power = E.loadoutPower(charId, draft);
      const budget = E.loadoutBudget(charId);
      const unused = ch.moves.map((m, k) => k).filter(k => draft.indexOf(k) < 0);
      $('#modal-body').innerHTML = `<h3>技のカスタム：${esc(ch.name)}</h3>
        <p class="muted">枠（出目）を押して選び、<b>別の枠</b>を押すと順番を入れ替え、<b>控えの技</b>を押すとその枠の技と交換します。技力（攻撃＋回復）の合計は上限まで。</p>
        <div class="power-meter${power > budget ? ' over' : ''}">技力 <b>${power}</b> / 上限 ${budget}
          <div class="hpbar"><i style="width:${Math.min(100, power / budget * 100)}%"></i></div></div>
        <h4>出目1〜6の技</h4>
        <div class="slot-list">${draft.map((k, d) => `<button type="button" class="slot-btn${sel === d ? ' selected' : ''}" data-slot="${d}"><span class="num">${d + 1}</span><span class="s-name">${esc(ch.moves[k].name)}</span><span class="eff">${moveEffText(ch.moves[k])}</span></button>`).join('')}</div>
        <h4>控えの技（${unused.length}個）</h4>
        <div class="slot-list">${unused.map(k => `<button type="button" class="slot-btn pool" data-pool="${k}"${sel === null ? ' aria-disabled="true"' : ''}><span class="num">控</span><span class="s-name">${esc(ch.moves[k].name)}</span><span class="eff">${moveEffText(ch.moves[k])}</span></button>`).join('')}</div>
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
      mode: 'cpu', state, cpuPlan, title: ctx.title, foeName: ctx.foeName,
      onFinish: res => (ctx.kind === 'dungeon' ? onDungeonFloorFinish(ctx, res) : onMatchFinish(ctx, res)),
      onExit: () => (ctx.kind === 'dungeon' ? showDungeon() : showMatch()),
      onShowResult: () => app.lastResult && app.lastResult()
    });
  }

  function rewardHtml(exp, stones, levelUps, note) {
    const ups = (levelUps || []).filter(u => u.to > u.from);
    return `<div class="effect-box reward-box">
      ${stones ? `<div class="big-reward">石 +${stones}${note ? ` <small>${esc(note)}</small>` : ''}</div>` : ''}
      <div>チームの6体がそれぞれ経験値 <b>+${exp}</b></div>
      ${ups.length ? `<div class="levelups">${ups.map(u => `<span class="team-chip">${esc(E.getChar(u.id).name)} <b>Lv${u.from}→${u.to}</b></span>`).join('')}</div>` : ''}
    </div>`;
  }

  function resultModal(won, title, round, body, buttons) {
    const show = () => openModal(`<div class="result-title ${won ? 'win' : 'lose'}">${won ? '勝利' : '敗北'}</div>
      <p style="text-align:center">${esc(title)}<br><span class="muted">第${round}巡で決着</span></p>
      ${body}
      <div class="modal-actions">
        ${buttons.map((b, k) => `<button type="button" class="btn ${b.primary ? 'btn-primary' : 'btn-ghost'} btn-block" data-act="${k}">${esc(b.label)}</button>`).join('')}
        <button type="button" class="btn btn-ghost btn-block" data-close="1">戦闘ログを見る</button>
      </div>`, {
      kind: 'result',
      bind: b => b.querySelectorAll('[data-act]').forEach(x => x.addEventListener('click', () => { closeModal(true); buttons[Number(x.dataset.act)].run(); }))
    });
    app.lastResult = show;
    show();
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
    let body;
    let nextId = null;
    if (ctx.kind === 'match') {
      const r = P.applyMatchResult(p, ctx.matchId, ctx.team, res.won);
      body = rewardHtml(r.exp, r.stones, r.levelUps, r.firstWin ? '初勝利' : '');
      const k = D.CPU_MATCHES.findIndex(m => m.id === ctx.matchId);
      if (res.won && D.CPU_MATCHES[k + 1]) nextId = D.CPU_MATCHES[k + 1].id;
    } else {
      const exp = res.won ? 40 : 10;
      body = rewardHtml(exp, 0, ctx.team.map(id => P.addExp(p, id, exp)), '');
    }
    save();
    const buttons = [];
    if (nextId) buttons.push({ label: '次の相手に挑戦', primary: true, run: () => startMatch(nextId) });
    buttons.push({ label: 'もう一度挑戦', primary: !nextId, run: () => (ctx.kind === 'match' ? startMatch(ctx.matchId) : startFree()) });
    buttons.push({ label: '対戦の一覧へ', run: showMatch });
    buttons.push({ label: 'ホームへ', run: showHome });
    resultModal(res.won, ctx.title, res.state.round, body, buttons);
  }

  /* ---------- ダンジョン（雑魚 → 中ボス → 大ボス を順に倒す） ---------- */
  function showDungeon() {
    B.stop();
    go('dungeon');
    const p = app.profile;
    $('#dungeon-team').textContent = P.teamError(p, p.team) ? 'チームが未完成です。先に6体を保存してください。'
      : '出撃チーム：' + p.team.map(id => `${E.getChar(id).name}(Lv${P.levelOf(p, id)})`).join('・');
    $('#dungeon-list').innerHTML = D.DUNGEONS.map(d => {
      const open = P.dungeonUnlocked(p, d.id);
      const req = d.requires ? P.getDungeon(d.requires) : null;
      const cleared = P.dungeonCleared(p, d.id);
      return `<div class="panel dungeon${open ? '' : ' locked'}">
        <div class="zone-head"><span class="zone-label">${esc(d.name)}</span><span class="zone-sub">${cleared ? '踏破済み' : open ? '推奨 ' + esc(d.recommend) : '未解放'}</span></div>
        <p class="muted">${esc(d.text)}${!open && req ? `（「${esc(req.name)}」を踏破すると解放）` : ''}</p>
        <div class="boss-path">${d.floors.map((f, i) => {
          const b = E.getChar(f.boss);
          return `<div class="boss-step">${emblem(b, null, i === 2 ? 'big' : '')}<span class="badge${i === 2 ? ' leader' : ''}">${i + 1}階・${esc(b.rank)}</span><b>${esc(b.name)}</b><span class="muted">Lv${f.level}・HP${E.levelMaxHp(b.maxHp, f.level)}</span></div>`;
        }).join('<span class="boss-arrow" aria-hidden="true">→</span>')}</div>
        <p class="muted small-note">3体を順番に倒します。HPと戦闘不能は次の階に引き継ぎ（階の間に生存キャラが最大HPの${D.DUNGEON_RULES.healBetweenFloorsPercent}%回復）。踏破報酬：石${cleared ? d.clearStones : d.firstClearStones + '（初回）'}</p>
        ${open ? `<button type="button" class="btn btn-primary btn-block" data-dungeon="${d.id}">${cleared ? 'もう一度挑む' : '挑む'}</button>` : ''}
      </div>`;
    }).join('');
  }
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
    const r = P.applyDungeonFloor(p, ctx.dungeonId, ctx.floor, ctx.team, res.won);
    save();
    const units = res.state.teams[B.me()];
    const buttons = [];
    let body = rewardHtml(r.exp, r.stones, r.levelUps, r.firstClear ? '初回踏破' : (r.cleared ? '踏破' : ''));
    if (res.won && !r.last) {
      const hp = P.carryOverHp(units);
      body += `<h4>次の階へ引き継ぐHP（生存キャラは最大HPの${D.DUNGEON_RULES.healBetweenFloorsPercent}%回復）</h4>
        <div class="levelups">${units.map(u => `<span class="team-chip">${esc(E.unitChar(u).name)} <b>${hp[u.charId] > 0 ? hp[u.charId] + '/' + u.maxHp : '戦闘不能'}</b></span>`).join('')}</div>`;
      const nb = E.getChar(d.floors[ctx.floor + 1].boss);
      buttons.push({ label: `${ctx.floor + 2}階へ進む（${nb.rank}：${nb.name}）`, primary: true, run: () => startDungeon(ctx.dungeonId, ctx.floor + 1, hp) });
      buttons.push({ label: 'ここで引き返す', run: showDungeon });
    } else {
      if (r.cleared) body = `<div class="big-reward">「${esc(d.name)}」踏破！</div>` + body;
      else body = `<p class="reason" style="text-align:center">${ctx.floor + 1}階で力尽きました。もう一度、1階から挑戦できます。</p>` + body;
      buttons.push({ label: r.cleared ? 'もう一度挑む' : '1階から挑み直す', primary: true, run: () => startDungeon(ctx.dungeonId, 0) });
      buttons.push({ label: 'ダンジョン一覧へ', run: showDungeon });
    }
    buttons.push({ label: 'ホームへ', run: showHome });
    resultModal(res.won, ctx.title, res.state.round, body, buttons);
  }

  /* ---------- ガチャ ---------- */
  function showGacha() {
    go('gacha');
    renderGacha();
  }
  function renderGacha() {
    const p = app.profile;
    $('#gacha-stones').textContent = p.stones;
    const b1 = $('#btn-gacha-1'), b10 = $('#btn-gacha-10');
    b1.textContent = `1回引く（石${P.gachaCost(1)}）`;
    b10.textContent = `10回引く（石${P.gachaCost(10)}）`;
    b1.disabled = p.stones < P.gachaCost(1);
    b10.disabled = p.stones < P.gachaCost(10);
    $('#gacha-pool').innerHTML = E.CHARACTERS.map(ch => `<div class="pool-item${P.owns(p, ch.id) ? '' : ' missing'}">${emblem(ch, P.owns(p, ch.id) ? null : { hp: 0 }, 'small')}<span>${esc(ch.name)}</span><span class="muted">${P.owns(p, ch.id) ? 'Lv' + P.levelOf(p, ch.id) : '未所持'}</span></div>`).join('');
  }
  let gachaBusy = false;
  function pullGacha(count) {
    if (gachaBusy) return;
    gachaBusy = true;
    const r = P.drawGacha(app.profile, count, rng);
    if (!r.ok) { gachaBusy = false; toast(r.error); return; }
    save();
    renderGacha();
    openModal(`<h3>ガチャの結果（${count}回）</h3>
      <div class="gacha-results">${r.results.map((x, i) => {
        const ch = E.getChar(x.id);
        return `<div class="gacha-card${x.isNew ? ' new' : ''}" style="animation-delay:${U.FAST ? 0 : i * 90}ms">${emblem(ch, null, 'big')}<b>${esc(ch.name)}</b>
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
      mode, state, code, backend: app.backend, foeName, title: `プレイヤー対戦（ルーム ${code}）`,
      onFinish: res => onPvpFinish(foeName, res),
      onExit: showLobby,
      onShowResult: () => app.lastResult && app.lastResult()
    });
    app.lobby = { code: null, unwatch: null, role: null, starting: false };
  }
  function onPvpFinish(foeName, res) {
    const r = P.applyPvpResult(app.profile, res.won, new Date());
    save();
    const show = () => openModal(`<div class="result-title ${res.won ? 'win' : 'lose'}">${res.won ? '勝利' : '敗北'}</div>
      <p style="text-align:center">${esc(foeName)} との対戦${res.surrendered ? `<br><span class="muted">${res.surrendered === B.me() ? 'あなたが降参しました' : '相手が降参しました'}</span>` : ''}</p>
      <div class="effect-box reward-box">${r.stones ? `<div class="big-reward">石 +${r.stones}</div>` : ''}<div class="muted">今日の対人戦報酬 ${r.rewardedToday} / ${r.limit} 回</div></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" id="btn-to-lobby">ロビーへ</button>
        <button type="button" class="btn btn-ghost btn-block" id="btn-to-home">ホームへ</button>
        <button type="button" class="btn btn-ghost btn-block" data-close="1">戦闘ログを見る</button>
      </div>`, {
      kind: 'result',
      bind: b => {
        b.querySelector('#btn-to-lobby').addEventListener('click', () => { closeModal(true); B.stop(); showLobby(); });
        b.querySelector('#btn-to-home').addEventListener('click', () => { closeModal(true); showHome(); });
      }
    });
    app.lastResult = show;
    show();
  }

  /* ---------- 遊び方 ---------- */
  function showHelp() {
    const E2 = D.ECONOMY;
    openModal(`<h3>遊び方</h3>
      <h4>戦い方</h4>
      <ol class="help-list">
        <li>持っているキャラから異なる6体でチームを作ります。戦闘前に前衛3体・後衛3体と<b>リーダー</b>を決めます。</li>
        <li><b>先攻・後攻はサイコロ</b>で決めます。大きい数を出した方が先攻、同じ数なら振り直しです。</li>
        <li>自分のターンは「数字を出す」→（必要なら交代1回）→（必要なら固有スキル1回）→ 前衛から1体の「出目に対応する技」を1つ使う、の順です。交代や選び直しで数字は変わりません（振り直しスキルだけ例外）。</li>
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
        <li><b>技のカスタム</b>：各キャラ9個の技から6個を選び、出目1〜6の順番を決められます（技力の上限あり）。</li>
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
      <p>水 → 火 → 自然 → 水、聖光 ⇄ 呪闇。それ以外は等倍です。</p>
      <h4>計算の順番</h4>
      <p class="muted">基礎ダメージ ×スキル倍率 ＋（スキル・リーダー・レベルの加算）→ 属性倍率 → 結界（半減）→ 最後に四捨五入。</p>
      <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close="1">閉じる</button></div>`, { kind: 'help' });
  }

  /* ---------- イベント登録 ---------- */
  function bindAll() {
    $('#btn-help').addEventListener('click', showHelp);
    $('#btn-home').addEventListener('click', () => { if (app.profile) showHome(); });
    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      const g = b.dataset.go;
      if (g === 'dungeon') showDungeon();
      else if (g === 'match') showMatch();
      else if (g === 'lobby') showLobby();
      else if (g === 'gacha') showGacha();
      else if (g === 'team') showTeam();
      else if (g === 'logout') { app.profile = null; app.backend.signOut(); }
    }));
    $('#team-grid').addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]');
      if (ed) { e.stopPropagation(); showLoadoutEditor(ed.dataset.edit); return; }
      const c = e.target.closest('[data-pick]');
      if (c) togglePick(c.dataset.pick);
    });
    $('#btn-team-back').addEventListener('click', showHome);
    $('#btn-team-ok').addEventListener('click', () => {
      const r = P.setTeam(app.profile, app.picked);
      if (!r.ok) { toast(r.error); return; }
      save();
      toast('チームを保存しました', 'ok');
      showHome();
    });
    $('#dungeon-list').addEventListener('click', e => {
      const b = e.target.closest('[data-dungeon]');
      if (b) startDungeon(b.dataset.dungeon, 0);
    });
    $('#match-list').addEventListener('click', e => {
      const b = e.target.closest('[data-match]');
      if (b) startMatch(b.dataset.match);
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
