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
    owned.forEach(id => { chars[id] = { level: 1, exp: 0 }; });
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
      chars[id] = { level: Engine.clampLevel(c.level), exp: Math.max(0, Math.floor(Number(c.exp) || 0)) };
    });
    if (p.isAdmin) ALL_IDS.forEach(id => { if (!chars[id]) chars[id] = { level: 1, exp: 0 }; });
    if (!Object.keys(chars).length) Object.assign(chars, base.chars);
    p.chars = chars;
    const lo = {};
    Object.keys(raw.loadouts || {}).forEach(id => {
      if (Engine.getChar(id) && !Engine.loadoutError(id, raw.loadouts[id])) lo[id] = raw.loadouts[id].slice();
    });
    p.loadouts = lo;
    p.team = Array.isArray(raw.team) ? raw.team.filter((id, i, a) => chars[id] && a.indexOf(id) === i).slice(0, CONFIG.TEAM_SIZE) : [];
    p.dungeon = { cleared: Object.assign({}, raw.dungeon && raw.dungeon.cleared) };
    p.matches = { won: Object.assign({}, raw.matches && raw.matches.won) };
    p.login = Object.assign({ last: null, streak: 0, total: 0 }, raw.login);
    p.pvp = Object.assign({ day: null, rewarded: 0, wins: 0, losses: 0 }, raw.pvp);
    return p;
  }

  /* ---------- 所持・レベル ---------- */
  const owns = (p, id) => !!p.chars[id];
  const ownedIds = p => ALL_IDS.filter(id => owns(p, id));
  const levelOf = (p, id) => (p.chars[id] ? p.chars[id].level : 1);

  function expToNext(level) {
    return CONFIG.LEVEL.expBase + CONFIG.LEVEL.expStep * (level - 1);
  }

  // 経験値を加えてレベルアップ（最大レベルでは経験値は貯まらない）
  function addExp(p, id, amount) {
    const c = p.chars[id];
    if (!c || amount <= 0) return { id, from: c ? c.level : 1, to: c ? c.level : 1, gained: 0 };
    const from = c.level;
    c.exp += Math.floor(amount);
    while (c.level < CONFIG.LEVEL.max && c.exp >= expToNext(c.level)) {
      c.exp -= expToNext(c.level);
      c.level++;
    }
    if (c.level >= CONFIG.LEVEL.max) c.exp = 0;
    return { id, from, to: c.level, gained: Math.floor(amount) };
  }

  function levelsFor(p, ids) {
    const out = {};
    ids.forEach(id => { out[id] = levelOf(p, id); });
    return out;
  }
  function loadoutsFor(p, ids) {
    const out = {};
    ids.forEach(id => { out[id] = p.loadouts[id] || Engine.defaultLoadout(id); });
    return out;
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
    const err = Engine.loadoutError(id, loadout);
    if (err) return { ok: false, error: err };
    if (loadout.join() === Engine.defaultLoadout(id).join()) delete p.loadouts[id];
    else p.loadouts[id] = loadout.slice();
    return { ok: true };
  }

  /* ---------- ガチャ（全キャラ同じ確率。持っているキャラは経験値に変わる） ---------- */
  function gachaCost(count) {
    return count === 10 ? ECONOMY.gacha10Cost : ECONOMY.gachaCost * count;
  }
  function drawGacha(p, count, rng) {
    if (count !== 1 && count !== 10) return { ok: false, error: '1回か10回で引いてください' };
    const cost = gachaCost(count);
    if (p.stones < cost) return { ok: false, error: `石が足りません（必要 ${cost}／所持 ${p.stones}）` };
    p.stones -= cost;
    const results = [];
    for (let i = 0; i < count; i++) {
      const id = ALL_IDS[Math.min(ALL_IDS.length - 1, Math.floor((rng || Math.random)() * ALL_IDS.length))];
      if (!owns(p, id)) {
        p.chars[id] = { level: 1, exp: 0 };
        results.push({ id, isNew: true });
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
  function matchUnlocked(p, id) {
    const k = CPU_MATCHES.findIndex(m => m.id === id);
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
    p.stones += stones;
    if (won) p.matches.won[id] = true;
    return { ok: true, won, firstWin, exp, stones, levelUps };
  }

  /* ---------- ダンジョン（3階層：雑魚 → 中ボス → 大ボス。1体ずつ倒していく） ---------- */
  function getDungeon(id) { return DUNGEONS.find(d => d.id === id) || null; }
  function dungeonCleared(p, id) { return !!p.dungeon.cleared[id]; }
  function dungeonUnlocked(p, id) {
    const d = getDungeon(id);
    return !!d && (!d.requires || dungeonCleared(p, d.requires));
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
    p.stones += stones;
    if (cleared) p.dungeon.cleared[id] = true;
    return { ok: true, won, exp, levelUps, cleared, firstClear, stones, last };
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
    teamError, setTeam, setLoadout,
    gachaCost, drawGacha,
    loginStatus, claimLogin,
    getMatch, matchUnlocked, matchEnemy, applyMatchResult,
    getDungeon, dungeonCleared, dungeonUnlocked, floorEnemy, carryOverHp, applyDungeonFloor,
    applyPvpResult
  };

  if (typeof module === 'object' && module.exports) module.exports = Profile;
  else global.RikuyouProfile = Profile;
})(typeof globalThis !== 'undefined' ? globalThis : this);
