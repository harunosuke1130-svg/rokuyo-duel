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

  // SHA-256（管理用コードの照合用。file:// でも動くように自前で計算する）
  function sha256(str) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const bytes = Array.from(unescape(encodeURIComponent(String(str))), c => c.charCodeAt(0));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

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
        user = p ? { uid: p.uid, name: p.name, isAdmin: !!opts.localAdmin || !!p.isAdmin, email: '' } : null;
        if (authCb) authCb(user);
      },
      onAuth(cb) { authCb = cb; cb(user); },
      currentUser: () => user,
      // ローカルでは名前だけで「プレイヤー」を作る（同じ端末で複数人を切り替えられる）
      localPlayers: () => players(),
      // 管理用コードが設定されているか（設定ファイルの localAdminCodeHash）
      adminCodeEnabled: () => !!opts.adminCodeHash,
      async signIn({ name, uid, adminCode }) {
        let list = players();
        let p = uid ? list.find(x => x.uid === uid) : null;
        let admin = false;
        if (adminCode !== undefined && adminCode !== null && adminCode !== '') {
          if (!opts.adminCodeHash || sha256(String(adminCode).trim()) !== String(opts.adminCodeHash).toLowerCase()) throw new Error('管理用コードが違います');
          admin = true;
        }
        if (!p) {
          const nm = String(name || '').trim().slice(0, 16);
          if (!nm) throw new Error('名前を入力してください');
          p = list.find(x => x.name === nm && !!x.isAdmin === admin);
          if (!p) { p = { uid: 'local-' + now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), name: nm, isAdmin: admin }; list = list.concat(p); write('players', list); }
        }
        ss.setItem(P + 'session', p.uid);
        user = { uid: p.uid, name: p.name, isAdmin: !!opts.localAdmin || !!p.isAdmin, email: '' };
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
    return LocalBackend({ localAdmin: !!(st && st.localAdmin), adminCodeHash: st && st.localAdminCodeHash });
  }

  const Backend = { LocalBackend, FirebaseBackend, createBackend, makeCode, normalizeCode, sha256 };
  if (typeof module === 'object' && module.exports) module.exports = Backend;
  else global.RikuyouBackend = Backend;
})(typeof globalThis !== 'undefined' ? globalThis : this);
