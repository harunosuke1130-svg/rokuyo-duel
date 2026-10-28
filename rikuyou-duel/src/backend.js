/*
 * 六耀の決闘 — 保存先と通信（バックエンド）
 *
 * 2種類を同じ使い方で切り替える：
 *   LocalBackend    … この端末のブラウザだけに保存（オフライン・単一HTML・テスト用）。
 *                     対人戦は同じブラウザの別タブ同士（BroadcastChannel）。
 *   FirebaseBackend … Firebase Authentication（メール＋パスワード）と Cloud Firestore。
 *                     公開URLで、離れたプレイヤー同士がリアルタイムに対戦できる。
 *
 * 対戦ルーム（rooms/{code}）は「ホストが戦闘を計算する」方式：
 *   ホスト … 戦闘状態（stateJson）と直前の演出（lastJson）を書き込む
 *   ゲスト … 行動の依頼（intent）だけを書き込み、ホストが Engine で検証して反映する
 */
(function (global) {
  'use strict';

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字（I O 0 1）を除く
  function makeCode(rng) {
    let s = '';
    for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor((rng || Math.random)() * CODE_CHARS.length)];
    return s;
  }
  const normalizeCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const now = () => Date.now();

  /* ======================================================================
   * LocalBackend（この端末だけ）
   * ==================================================================== */
  function LocalBackend(opts) {
    opts = opts || {};
    const ls = opts.storage || safeStorage('localStorage');
    const ss = opts.session || safeStorage('sessionStorage');
    const P = 'rikuyou.v4.';
    const listeners = {};      // code → Set<cb>
    let authCb = null;
    let user = null;
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('rikuyou-rooms') : null;
    if (channel) channel.onmessage = e => { if (e.data && e.data.code) notify(e.data.code, false); };
    // localStorage の変更は他のタブにも届く（BroadcastChannel が無い環境の予備）
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', e => {
        if (e.key && e.key.indexOf(P + 'room.') === 0) notify(e.key.slice((P + 'room.').length), false);
      });
    }

    const read = k => { try { return JSON.parse(ls.getItem(P + k)); } catch (e) { return null; } };
    const write = (k, v) => { try { ls.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; } };

    function notify(code, broadcast) {
      const data = read('room.' + code);
      (listeners[code] || new Set()).forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });
      if (broadcast && channel) channel.postMessage({ code });
    }
    function players() { return read('players') || []; }

    const api = {
      mode: 'local',
      label: 'この端末に保存（オフライン）',
      async init() {
        const uid = ss.getItem(P + 'session');
        const p = players().find(x => x.uid === uid);
        user = p ? { uid: p.uid, name: p.name, isAdmin: !!opts.localAdmin, email: '' } : null;
        if (authCb) authCb(user);
      },
      onAuth(cb) { authCb = cb; cb(user); },
      currentUser: () => user,
      // ローカルでは名前だけで「プレイヤー」を作る（同じ端末で複数人を切り替えられる）
      localPlayers: () => players(),
      async signIn({ name, uid }) {
        let list = players();
        let p = uid ? list.find(x => x.uid === uid) : null;
        if (!p) {
          const nm = String(name || '').trim().slice(0, 16);
          if (!nm) throw new Error('名前を入力してください');
          p = list.find(x => x.name === nm);
          if (!p) { p = { uid: 'local-' + now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), name: nm }; list = list.concat(p); write('players', list); }
        }
        ss.setItem(P + 'session', p.uid);
        user = { uid: p.uid, name: p.name, isAdmin: !!opts.localAdmin, email: '' };
        if (authCb) authCb(user);
        return user;
      },
      async signUp(args) { return api.signIn(args); },
      async signOut() { ss.removeItem(P + 'session'); user = null; if (authCb) authCb(null); },
      async loadProfile() { return user ? read('profile.' + user.uid) : null; },
      async saveProfile(profile) { if (!user) throw new Error('ログインしていません'); write('profile.' + user.uid, profile); },

      /* ----- 対戦ルーム ----- */
      async createRoom(host) {
        if (!user) throw new Error('ログインしていません');
        let code;
        do { code = makeCode(); } while (read('room.' + code));
        write('room.' + code, Object.assign({
          code, status: 'waiting', hostUid: user.uid, hostName: host.name, guestUid: null, guestName: null,
          host: host.setup, guest: null, stateJson: null, lastJson: null, seq: 0, intent: null, reject: null,
          createdAt: now(), updatedAt: now(), hostSeen: now(), guestSeen: null
        }));
        notify(code, true);
        return code;
      },
      async joinRoom(code, guest) {
        code = normalizeCode(code);
        const r = read('room.' + code);
        if (!r) throw new Error('ルームが見つかりません（コードを確認してください）');
        if (r.hostUid === user.uid) throw new Error('自分のルームには参加できません');
        if (r.status !== 'waiting' || r.guestUid) throw new Error('このルームはすでに対戦が始まっています');
        Object.assign(r, { guestUid: user.uid, guestName: guest.name, guest: guest.setup, status: 'ready', updatedAt: now(), guestSeen: now() });
        write('room.' + code, r);
        notify(code, true);
        return code;
      },
      watchRoom(code, cb) {
        (listeners[code] = listeners[code] || new Set()).add(cb);
        setTimeout(() => cb(read('room.' + code)), 0);
        return () => listeners[code] && listeners[code].delete(cb);
      },
      async updateRoom(code, patch) {
        const r = read('room.' + code);
        if (!r) throw new Error('ルームが見つかりません');
        write('room.' + code, Object.assign(r, patch, { updatedAt: now() }));
        notify(code, true);
      },
      async listOpenRooms() {
        const out = [];
        try {
          for (let i = 0; i < ls.length; i++) {
            const k = ls.key(i);
            if (k && k.indexOf(P + 'room.') === 0) {
              const r = read(k.slice(P.length));
              if (r && r.status === 'waiting' && now() - r.updatedAt < 30 * 60 * 1000) out.push({ code: r.code, hostName: r.hostName, createdAt: r.createdAt, mine: user && r.hostUid === user.uid });
            }
          }
        } catch (e) { /* 読めない環境 */ }
        return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
      },
      async deleteRoom(code) { try { ls.removeItem(P + 'room.' + code); } catch (e) { /* noop */ } notify(code, true); }
    };
    return api;
  }

  function safeStorage(name) {
    try {
      const s = global[name];
      const k = '__rikuyou_test__';
      s.setItem(k, '1'); s.removeItem(k);
      return s;
    } catch (e) {
      const m = {};
      return {
        getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; },
        key: i => Object.keys(m)[i] || null, get length() { return Object.keys(m).length; }
      };
    }
  }

  /* ======================================================================
   * FirebaseBackend（公開URL・アカウント・リアルタイム対戦）
   * ==================================================================== */
  function FirebaseBackend(settings) {
    const fb = global.firebase;
    if (!fb) throw new Error('Firebase SDK が読み込まれていません');
    const app = fb.apps.length ? fb.app() : fb.initializeApp(settings.config);
    const auth = fb.auth();
    const db = fb.firestore();
    if (settings.emulator) {
      const host = settings.emulatorHost || '127.0.0.1';
      auth.useEmulator('http://' + host + ':' + (settings.authPort || 9099), { disableWarnings: true });
      db.useEmulator(host, settings.firestorePort || 8080);
    }
    void app;
    const admins = (settings.adminEmails || []).map(e => String(e).toLowerCase());
    let user = null;
    let pendingName = null;
    const toUser = u => (u ? {
      uid: u.uid, email: u.email || '', name: u.displayName || pendingName || (u.email || '').split('@')[0] || 'プレイヤー',
      // 管理用アカウント：設定のメールアドレスと一致し、メール確認済み（誰でも同じアドレスで登録できてしまうのを防ぐ）
      isAdmin: !!u.email && admins.indexOf(u.email.toLowerCase()) >= 0 && (!!u.emailVerified || !!settings.emulator),
      emailVerified: !!u.emailVerified
    } : null);

    const rooms = db.collection('rooms');
    const ERR = {
      'auth/invalid-email': 'メールアドレスの形式が正しくありません',
      'auth/missing-password': 'パスワードを入力してください',
      'auth/weak-password': 'パスワードは6文字以上にしてください',
      'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。ログインしてください',
      'auth/invalid-credential': 'メールアドレスかパスワードが違います',
      'auth/wrong-password': 'メールアドレスかパスワードが違います',
      'auth/user-not-found': 'このメールアドレスのアカウントはありません',
      'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってからお試しください',
      'auth/network-request-failed': '通信できませんでした。接続を確認してください',
      'permission-denied': '権限がありません（ルールで拒否されました）'
    };
    const jp = e => new Error(ERR[e && e.code] || (e && e.message) || '不明なエラー');

    const api = {
      mode: 'firebase',
      label: 'オンライン（アカウントに保存）',
      async init() { await new Promise(res => { const off = auth.onAuthStateChanged(() => { off(); res(); }); }); },
      onAuth(cb) { auth.onAuthStateChanged(u => { user = toUser(u); cb(user); }); },
      currentUser: () => user,
      async signUp({ email, password, name }) {
        const nm = String(name || '').trim().slice(0, 16);
        if (!nm) throw new Error('プレイヤー名を入力してください');
        pendingName = nm;
        try {
          const cred = await auth.createUserWithEmailAndPassword(String(email || '').trim(), password || '');
          await cred.user.updateProfile({ displayName: nm });
          try { await cred.user.sendEmailVerification(); } catch (e) { /* 送れなくても登録は続ける */ }
          user = toUser(cred.user);
          return user;
        } catch (e) { throw jp(e); }
      },
      async signIn({ email, password }) {
        try {
          const cred = await auth.signInWithEmailAndPassword(String(email || '').trim(), password || '');
          user = toUser(cred.user);
          return user;
        } catch (e) { throw jp(e); }
      },
      async signOut() { await auth.signOut(); user = null; },
      async sendVerification() { if (auth.currentUser) await auth.currentUser.sendEmailVerification(); },
      async reloadUser() { if (auth.currentUser) { await auth.currentUser.reload(); user = toUser(auth.currentUser); } return user; },
      async loadProfile() {
        if (!user) return null;
        try {
          const snap = await db.collection('profiles').doc(user.uid).get();
          return snap.exists ? snap.data() : null;
        } catch (e) { throw jp(e); }
      },
      async saveProfile(profile) {
        if (!user) throw new Error('ログインしていません');
        try { await db.collection('profiles').doc(user.uid).set(JSON.parse(JSON.stringify(Object.assign({}, profile, { uid: user.uid, updatedAt: Date.now() })))); }
        catch (e) { throw jp(e); }
      },

      /* ----- 対戦ルーム ----- */
      async createRoom(host) {
        for (let tries = 0; tries < 5; tries++) {
          const code = makeCode();
          const ref = rooms.doc(code);
          try {
            const created = await db.runTransaction(async tx => {
              const snap = await tx.get(ref);
              if (snap.exists) return false;
              tx.set(ref, {
                code, status: 'waiting', hostUid: user.uid, hostName: host.name, guestUid: null, guestName: null,
                host: JSON.stringify(host.setup), guest: null, stateJson: null, lastJson: null, seq: 0, intent: null, reject: null,
                createdAt: now(), updatedAt: now(), hostSeen: now(), guestSeen: null
              });
              return true;
            });
            if (created) return code;
          } catch (e) { throw jp(e); }
        }
        throw new Error('ルームを作れませんでした。もう一度お試しください');
      },
      async joinRoom(code, guest) {
        code = normalizeCode(code);
        const ref = rooms.doc(code);
        try {
          await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new Error('ルームが見つかりません（コードを確認してください）');
            const r = snap.data();
            if (r.hostUid === user.uid) throw new Error('自分のルームには参加できません');
            if (r.status !== 'waiting' || r.guestUid) throw new Error('このルームはすでに対戦が始まっています');
            tx.update(ref, { guestUid: user.uid, guestName: guest.name, guest: JSON.stringify(guest.setup), status: 'ready', updatedAt: now(), guestSeen: now() });
          });
          return code;
        } catch (e) { throw e.code ? jp(e) : e; }
      },
      watchRoom(code, cb) {
        return rooms.doc(code).onSnapshot(snap => {
          if (!snap.exists) { cb(null); return; }
          const r = snap.data();
          // Firestore には入れ子の配列を保存できないため、チーム設定は JSON 文字列で保存している
          cb(Object.assign({}, r, {
            host: typeof r.host === 'string' ? JSON.parse(r.host) : r.host,
            guest: typeof r.guest === 'string' ? JSON.parse(r.guest) : r.guest
          }));
        }, err => { console.error('ルームの監視エラー', err); cb(null); });
      },
      async updateRoom(code, patch) {
        try { await rooms.doc(code).update(Object.assign({}, patch, { updatedAt: now() })); }
        catch (e) { throw jp(e); }
      },
      async listOpenRooms() {
        try {
          const snap = await rooms.where('status', '==', 'waiting').limit(20).get();
          return snap.docs.map(d => d.data())
            .filter(r => now() - r.updatedAt < 30 * 60 * 1000)
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(r => ({ code: r.code, hostName: r.hostName, createdAt: r.createdAt, mine: user && r.hostUid === user.uid }));
        } catch (e) { throw jp(e); }
      },
      async deleteRoom(code) { try { await rooms.doc(code).delete(); } catch (e) { /* 権限なし等は無視 */ } }
    };
    return api;
  }

  // 設定（firebase-config.js）があれば Firebase を、なければ端末保存を使う
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error(src + ' を読み込めませんでした'));
      document.head.appendChild(s);
    });
  }
  async function createBackend() {
    const st = global.RIKUYOU_FIREBASE;
    if (st && st.enabled && st.config && st.config.projectId) {
      const base = st.sdkPath || 'vendor/firebase/';
      for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) {
        if (!(global.firebase && (f.indexOf('app') > 0 ? global.firebase.apps : f.indexOf('auth') > 0 ? global.firebase.auth : global.firebase.firestore))) await loadScript(base + f);
      }
      return FirebaseBackend(st);
    }
    return LocalBackend({ localAdmin: !!(st && st.localAdmin) });
  }

  const Backend = { LocalBackend, FirebaseBackend, createBackend, makeCode, normalizeCode };
  if (typeof module === 'object' && module.exports) module.exports = Backend;
  else global.RikuyouBackend = Backend;
})(typeof globalThis !== 'undefined' ? globalThis : this);
