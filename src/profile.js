/*
 * 六耀の決闘 — プレイヤーの成長（プロフィール・レベル・ガチャ・ログインボーナス・ダンジョン報酬）
 * 画面にも保存先にも依存しない純粋な処理。保存は backend.js が行う。
 * プロフィールはプレーンなオブジェクトで、各関数はそれを直接更新して結果を返す。
 */
(function (global) {
  'use strict';

  const Engine = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./engine.js')
    : global.RikuyouEngine;
  const Data = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('./data.js')
    : global.RikuyouData;

  const { CONFIG, CHARACTERS, ECONOMY, DUNGEONS, CPU_MATCHES, DUNGEON_RULES } = Data;
  const ALL_IDS = CHARACTERS.map(c => c.id);
  const PROFILE_VERSION = 1;

  /* ---------- 日付（ログインボーナスは日本時間の日付で判定） ---------- */
  function dayKey(date) {
    const t = (date instanceof Date ? date : new Date(date)).getTime() + 9 * 3600 * 1000;
    return new Date(t).toISOString().slice(0, 10);
  }
  function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  /* ---------- 生成・読み込み ---------- */
  function shuffle(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor((rng || Math.random)() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newProfile(opts, rng) {
    opts = opts || {};
    const owned = opts.isAdmin ? ALL_IDS.slice() : shuffle(ALL_IDS, rng).slice(0, ECONOMY.starterCount);
    const chars = {};
    owned.forEach(id => { chars[id] = { level: 1, exp: 0, cap: CONFIG.LEVEL.capStep }; });
    return {
      v: PROFILE_VERSION,
      uid: opts.uid || '',
      name: String(opts.name || 'プレイヤー').slice(0, 16),
      isAdmin: !!opts.isAdmin,
      stones: ECONOMY.startStones,
      chars,
      loadouts: {},
      team: owned.slice(0, CONFIG.TEAM_SIZE),
      dungeon: { cleared: {} },
      matches: { won: {} },
      login: { last: null, streak: 0, total: 0 },
      pvp: { day: null, rewarded: 0, wins: 0, losses: 0 },
      items: { crystal: 0, kakera: 0 },   // 結晶（限界突破に使う）・かけら（経験値にする）
      dupeMode: 'exp',                    // ガチャで持っているキャラが出たとき：'exp'＝そのキャラの経験値／'kakera'＝かけらとして残す
      createdAt: Date.now()
    };
  }

  // 保存データを読み込むときの整形（壊れた値は直す。管理用アカウントは全キャラを所持）
  function sanitize(raw, opts) {
    opts = opts || {};
    const base = newProfile({ uid: opts.uid, name: (raw && raw.name) || opts.name, isAdmin: opts.isAdmin }, () => 0);
    if (!raw || typeof raw !== 'object') return base;
    const p = Object.assign({}, base, raw);
    p.v = PROFILE_VERSION;
    p.uid = opts.uid || raw.uid || '';
    p.isAdmin = !!opts.isAdmin;
    p.name = String(p.name || 'プレイヤー').slice(0, 16);
    p.stones = Math.max(0, Math.floor(Number(p.stones) || 0));
    const chars = {};
    Object.keys(raw.chars || {}).forEach(id => {
      if (!Engine.getChar(id)) return;
      const c = raw.chars[id] || {};
      const level = Engine.clampLevel(c.level);
      chars[id] = { level, exp: Math.max(0, Math.floor(Number(c.exp) || 0)), cap: fixCap(c.cap, level) };
    });
    if (p.isAdmin) ALL_IDS.forEach(id => { if (!chars[id]) chars[id] = { level: 1, exp: 0, cap: CONFIG.LEVEL.capStep }; });
    if (!Object.keys(chars).length) Object.assign(chars, base.chars);
    p.chars = chars;
    const lo = {};
    Object.keys(raw.loadouts || {}).forEach(id => {
      const lv = chars[id] ? chars[id].level : 1;
      if (Engine.getChar(id) && !Engine.loadoutError(id, raw.loadouts[id], lv)) lo[id] = raw.loadouts[id].slice();
    });
    p.loadouts = lo;
    // 前回出撃した配置（準備画面の初期配置に使う）
    const fm = raw.formation;
    p.formation = fm && Array.isArray(fm.front)
      ? { front: fm.front.filter(id => typeof id === 'string' && Engine.getChar(id)).slice(0, CONFIG.FRONT_SIZE), leader: typeof fm.leader === 'string' && Engine.getChar(fm.leader) ? fm.leader : null }
      : null;
    p.team = Array.isArray(raw.team) ? raw.team.filter((id, i, a) => chars[id] && a.indexOf(id) === i).slice(0, CONFIG.TEAM_SIZE) : [];
    p.dungeon = { cleared: Object.assign({}, raw.dungeon && raw.dungeon.cleared) };
    p.matches = { won: Object.assign({}, raw.matches && raw.matches.won) };
    p.login = Object.assign({ last: null, streak: 0, total: 0 }, raw.login);
    p.pvp = Object.assign({ day: null, rewarded: 0, wins: 0, losses: 0 }, raw.pvp);
    const it = raw.items || {};
    p.items = { crystal: Math.max(0, Math.floor(Number(it.crystal) || 0)), kakera: Math.max(0, Math.floor(Number(it.kakera) || 0)) };
    p.dupeMode = raw.dupeMode === 'kakera' ? 'kakera' : 'exp';
    return p;
  }

  /* ---------- 所持・レベル ---------- */
  // レベルの上限（30・60・90…）。保存データに無いとき・おかしいときは、今のレベルが入る一番小さい上限
  function fixCap(cap, level) {
    const step = CONFIG.LEVEL.capStep, lv = Engine.clampLevel(level);
    const min = Math.max(step, Math.ceil(lv / step) * step);
    const n = Math.floor(Number(cap) || 0);
    return Math.min(CONFIG.LEVEL.max, n >= min && n % step === 0 ? n : min);
  }
  const owns = (p, id) => !!p.chars[id];
  const ownedIds = p => ALL_IDS.filter(id => owns(p, id));
  const levelOf = (p, id) => (p.chars[id] ? p.chars[id].level : 1);

  function expToNext(level) {
    return CONFIG.LEVEL.expBase + CONFIG.LEVEL.expStep * (level - 1);
  }

  const capOf = (p, id) => (p.chars[id] ? fixCap(p.chars[id].cap, p.chars[id].level) : CONFIG.LEVEL.capStep);
  // 上限で止まっている（限界突破が必要）
  const atCap = (p, id) => !!p.chars[id] && p.chars[id].level >= capOf(p, id);

  // 経験値を加えてレベルアップ（上限のレベルでは経験値は貯まらない。限界突破すると先へ進める）
  function addExp(p, id, amount) {
    const c = p.chars[id];
    if (!c || amount <= 0) return { id, from: c ? c.level : 1, to: c ? c.level : 1, gained: 0 };
    const from = c.level, cap = capOf(p, id);
    c.cap = cap;
    c.exp += Math.floor(amount);
    while (c.level < cap && c.exp >= expToNext(c.level)) {
      c.exp -= expToNext(c.level);
      c.level++;
    }
    if (c.level >= cap) c.exp = 0;
    return { id, from, to: c.level, gained: Math.floor(amount) };
  }

  /* ---------- 限界突破（結晶）・かけら ---------- */
  function limitBreakCost(cap) { return ECONOMY.limitBreakCrystals * Math.max(1, Math.round(cap / CONFIG.LEVEL.capStep)); }
  // 上限まで上がったキャラの上限を +30 する（結晶を使う）
  function limitBreak(p, id) {
    if (!owns(p, id)) return { ok: false, error: '持っていないキャラです' };
    const c = p.chars[id], cap = capOf(p, id);
    if (cap >= CONFIG.LEVEL.max) return { ok: false, error: 'これ以上は上げられません' };
    if (c.level < cap) return { ok: false, error: `Lv${cap}まで上げると限界突破できます` };
    const cost = limitBreakCost(cap);
    if (p.items.crystal < cost) return { ok: false, error: `結晶が足りません（必要 ${cost}／所持 ${p.items.crystal}）` };
    p.items.crystal -= cost;
    c.cap = Math.min(CONFIG.LEVEL.max, cap + CONFIG.LEVEL.capStep);
    return { ok: true, cost, from: cap, cap: c.cap };
  }
  // 上限までに必要なかけらの数（今の経験値から数える）
  function kakeraToCap(p, id) {
    const c = p.chars[id];
    if (!c) return 0;
    const cap = capOf(p, id);
    let need = -c.exp;
    for (let lv = c.level; lv < cap; lv++) need += expToNext(lv);
    return need > 0 ? Math.ceil(need / ECONOMY.kakeraExp) : 0;
  }
  // かけらを使って経験値にする（上限を超える分は使わない）
  function useKakera(p, id, count) {
    if (!owns(p, id)) return { ok: false, error: '持っていないキャラです' };
    const n = Math.min(Math.floor(Number(count) || 0), p.items.kakera, kakeraToCap(p, id));
    if (atCap(p, id)) return { ok: false, error: '上限のレベルです。限界突破すると、また使えます' };
    if (n < 1) return { ok: false, error: 'かけらがありません' };
    p.items.kakera -= n;
    const lv = addExp(p, id, n * ECONOMY.kakeraExp);
    return { ok: true, used: n, exp: n * ECONOMY.kakeraExp, from: lv.from, to: lv.to };
  }
  function setDupeMode(p, mode) { p.dupeMode = mode === 'kakera' ? 'kakera' : 'exp'; return p.dupeMode; }

  function levelsFor(p, ids) {
    const out = {};
    ids.forEach(id => { out[id] = levelOf(p, id); });
    return out;
  }
  function loadoutsFor(p, ids) {
    const out = {};
    ids.forEach(id => {
      const lo = p.loadouts[id];
      out[id] = lo && !Engine.loadoutError(id, lo, levelOf(p, id)) ? lo : Engine.defaultLoadout(id);
    });
    return out;
  }

  // 管理用アカウント：キャラのレベルを直接変える（経験値は0に）
  function setLevel(p, id, level) {
    if (!p.isAdmin) return { ok: false, error: '管理用アカウントだけが変更できます' };
    if (!owns(p, id)) return { ok: false, error: '持っていないキャラです' };
    p.chars[id].level = Engine.clampLevel(level);
    p.chars[id].exp = 0;
    p.chars[id].cap = fixCap(p.chars[id].cap, p.chars[id].level);
    return { ok: true, level: p.chars[id].level };
  }

  /* ---------- チーム・技構成 ---------- */
  function teamError(p, ids) {
    if (!Array.isArray(ids) || ids.length !== CONFIG.TEAM_SIZE) return `チームは${CONFIG.TEAM_SIZE}体で編成してください`;
    if (new Set(ids).size !== ids.length) return '同じキャラは2体入れられません';
    if (!ids.every(id => owns(p, id))) return '持っていないキャラは編成できません';
    return null;
  }
  function setTeam(p, ids) {
    const err = teamError(p, ids);
    if (err) return { ok: false, error: err };
    p.team = ids.slice();
    return { ok: true };
  }
  function setLoadout(p, id, loadout) {
    if (!owns(p, id)) return { ok: false, error: '持っていないキャラです' };
    const err = Engine.loadoutError(id, loadout, levelOf(p, id));
    if (err) return { ok: false, error: err };
    if (loadout.join() === Engine.defaultLoadout(id).join()) delete p.loadouts[id];
    else p.loadouts[id] = loadout.slice();
    return { ok: true };
  }

  /* ---------- ガチャ（全キャラ同じ確率。持っているキャラは経験値に変わる） ---------- */
  function gachaCost(count) {
    return count === 10 ? ECONOMY.gacha10Cost : ECONOMY.gachaCost * count;
  }
  // ガチャの種類ごとの出るキャラ（data.js の GACHAS。属性ガチャはその属性のキャラだけ）
  function getGacha(kind) { return (Data.GACHAS || []).find(g => g.id === (kind || 'all')) || null; }
  function gachaPool(kind) {
    const g = getGacha(kind);
    if (!g) return [];
    return g.element ? CHARACTERS.filter(c => c.element === g.element).map(c => c.id) : ALL_IDS.slice();
  }
  function drawGacha(p, count, rng, kind) {
    if (count !== 1 && count !== 10) return { ok: false, error: '1回か10回で引いてください' };
    const pool = gachaPool(kind);
    if (!pool.length) return { ok: false, error: 'このガチャは今は引けません' };
    const cost = gachaCost(count);
    if (p.stones < cost) return { ok: false, error: `石が足りません（必要 ${cost}／所持 ${p.stones}）` };
    p.stones -= cost;
    const results = [];
    for (let i = 0; i < count; i++) {
      const id = pool[Math.min(pool.length - 1, Math.floor((rng || Math.random)() * pool.length))];
      if (!owns(p, id)) {
        p.chars[id] = { level: 1, exp: 0, cap: CONFIG.LEVEL.capStep };
        results.push({ id, isNew: true });
      } else if (p.dupeMode === 'kakera' || atCap(p, id)) {
        // かけらとして残す（上限で止まっているキャラは、経験値が無駄にならないよう、いつもかけらに）
        p.items.kakera += 1;
        results.push({ id, isNew: false, kakera: 1, capped: p.dupeMode !== 'kakera' });
      } else {
        const lv = addExp(p, id, ECONOMY.duplicateExp);
        results.push({ id, isNew: false, exp: ECONOMY.duplicateExp, from: lv.from, to: lv.to });
      }
    }
    return { ok: true, cost, results };
  }

  /* ---------- ログインボーナス（1日1回・連続日数で増える・7日で一巡） ---------- */
  function loginStatus(p, now) {
    const today = dayKey(now || new Date());
    const claimed = p.login.last === today;
    const continues = p.login.last && dayDiff(p.login.last, today) === 1;
    const nextStreak = claimed ? p.login.streak : (continues ? p.login.streak + 1 : 1);
    const idx = (nextStreak - 1) % ECONOMY.loginBonus.length;
    return { today, claimed, streak: nextStreak, amount: ECONOMY.loginBonus[idx], dayInCycle: idx + 1 };
  }
  function claimLogin(p, now) {
    const st = loginStatus(p, now);
    if (st.claimed) return { ok: false, error: '今日のログインボーナスは受け取り済みです' };
    p.login.last = st.today;
    p.login.streak = st.streak;
    p.login.total = (p.login.total || 0) + 1;
    p.stones += st.amount;
    return { ok: true, amount: st.amount, streak: st.streak, dayInCycle: st.dayInCycle };
  }

  /* ---------- 対戦（CPUチームとの6対6・順番に解放） ---------- */
  function getMatch(id) { return CPU_MATCHES.find(m => m.id === id) || null; }
  // 管理用アカウントはすべての対戦・ダンジョンを最初から選べる
  function matchUnlocked(p, id) {
    const k = CPU_MATCHES.findIndex(m => m.id === id);
    if (k >= 0 && p.isAdmin) return true;
    return k === 0 || (k > 0 && !!p.matches.won[CPU_MATCHES[k - 1].id]);
  }
  function matchEnemy(id) {
    const m = getMatch(id);
    const levels = {};
    m.enemies.forEach(cid => { levels[cid] = m.level; });
    return { ids: m.enemies.slice(), levels, leader: m.leader };
  }
  // 勝利：チーム6体に経験値・石（初勝利は多め）。敗北：経験値の3割だけ
  function applyMatchResult(p, id, teamIds, won) {
    const m = getMatch(id);
    if (!m || !matchUnlocked(p, id)) return { ok: false, error: 'まだ挑戦できない相手です' };
    const firstWin = won && !p.matches.won[id];
    const exp = won ? m.exp : Math.floor(m.exp * 0.3);
    const levelUps = teamIds.filter(cid => owns(p, cid)).map(cid => addExp(p, cid, exp));
    const stones = won ? (firstWin ? m.firstStones : m.stones) : 0;
    const crystals = won ? (firstWin ? ECONOMY.crystal.matchFirstWin : ECONOMY.crystal.matchWin) : 0;
    p.stones += stones;
    p.items.crystal += crystals;
    if (won) p.matches.won[id] = true;
    return { ok: true, won, firstWin, exp, stones, crystals, levelUps };
  }

  /* ---------- ダンジョン（3階層：雑魚 → 中ボス → 大ボス。1体ずつ倒していく） ---------- */
  function getDungeon(id) { return DUNGEONS.find(d => d.id === id) || null; }
  function dungeonCleared(p, id) { return !!p.dungeon.cleared[id]; }
  // 解放の条件：requires は null（最初から）・ID・ID の配列（どれか1つを踏破すれば解放。分かれ道の合流）
  function dungeonRequires(d) { return !d || !d.requires ? [] : [].concat(d.requires); }
  function dungeonUnlocked(p, id) {
    const d = getDungeon(id), req = dungeonRequires(d);
    return !!d && (!!p.isAdmin || !req.length || req.some(r => dungeonCleared(p, r)));
  }
  // 分かれ道：同じ条件で解放される、ほかのダンジョン
  function dungeonSiblings(id) {
    const key = dungeonRequires(getDungeon(id)).slice().sort().join(',');
    return key ? DUNGEONS.filter(d => d.id !== id && dungeonRequires(d).slice().sort().join(',') === key) : [];
  }
  // 階層の敵（createBattle の cpu 側。enemyKind:'boss' で使う）
  function floorEnemy(id, floor) {
    const f = getDungeon(id).floors[floor];
    return { ids: [f.boss], levels: { [f.boss]: f.level }, leader: null };
  }
  // 次の階層に引き継ぐHP：生存キャラは最大HPの一部を回復、戦闘不能はそのまま
  function carryOverHp(units) {
    const hp = {};
    units.forEach(u => {
      hp[u.charId] = u.hp > 0 ? Math.min(u.maxHp, u.hp + Math.floor(u.maxHp * DUNGEON_RULES.healBetweenFloorsPercent / 100)) : 0;
    });
    return hp;
  }
  // 1階層ぶんの結果：勝利で経験値、敗北で3割。大ボスを倒したらクリア報酬の石
  function applyDungeonFloor(p, id, floor, teamIds, won) {
    const d = getDungeon(id);
    if (!d || !dungeonUnlocked(p, id) || floor < 0 || floor >= d.floors.length) return { ok: false, error: 'まだ挑戦できないダンジョンです' };
    const f = d.floors[floor];
    const exp = won ? f.exp : Math.floor(f.exp * DUNGEON_RULES.loseExpPercent / 100);
    const levelUps = teamIds.filter(cid => owns(p, cid)).map(cid => addExp(p, cid, exp));
    const last = floor === d.floors.length - 1;
    const cleared = won && last;
    const firstClear = cleared && !p.dungeon.cleared[id];
    const stones = cleared ? (firstClear ? d.firstClearStones : d.clearStones) : 0;
    const C = ECONOMY.crystal;
    const crystals = (won ? C.floorWin : 0) + (cleared ? (firstClear ? C.firstClear : C.clear) : 0);
    p.stones += stones;
    p.items.crystal += crystals;
    if (cleared) p.dungeon.cleared[id] = true;
    return { ok: true, won, exp, levelUps, cleared, firstClear, stones, crystals, last };
  }

  /* ---------- 対人戦の報酬（1日の回数制限あり） ---------- */
  function applyPvpResult(p, won, now) {
    const today = dayKey(now || new Date());
    if (p.pvp.day !== today) { p.pvp.day = today; p.pvp.rewarded = 0; }
    if (won) p.pvp.wins++; else p.pvp.losses++;
    let stones = 0;
    if (p.pvp.rewarded < ECONOMY.pvpRewardsPerDay) {
      stones = won ? ECONOMY.pvpWinStones : ECONOMY.pvpLoseStones;
      p.pvp.rewarded++;
      p.stones += stones;
    }
    return { stones, rewardedToday: p.pvp.rewarded, limit: ECONOMY.pvpRewardsPerDay };
  }

  const Profile = {
    PROFILE_VERSION, ALL_IDS,
    dayKey, dayDiff, newProfile, sanitize,
    owns, ownedIds, levelOf, expToNext, addExp, levelsFor, loadoutsFor,
    fixCap, capOf, atCap, limitBreakCost, limitBreak, kakeraToCap, useKakera, setDupeMode,
    teamError, setTeam, setLoadout, setLevel,
    gachaCost, drawGacha, getGacha, gachaPool,
    loginStatus, claimLogin,
    getMatch, matchUnlocked, matchEnemy, applyMatchResult,
    getDungeon, dungeonRequires, dungeonSiblings, dungeonCleared, dungeonUnlocked, floorEnemy, carryOverHp, applyDungeonFloor,
    applyPvpResult
  };

  if (typeof module === 'object' && module.exports) module.exports = Profile;
  else global.RikuyouProfile = Profile;
})(typeof globalThis !== 'undefined' ? globalThis : this);
