/*
 * 六耀の決闘 — オンライン設定（Firebase）
 * docs/firebase-config.js としてコピーし、Firebase コンソールの値を入れてください。
 * 手順は SETUP-FIREBASE.md を参照。enabled を false にすると、この端末だけに保存するモードで動きます。
 *
 * ここに書く apiKey などは「公開して問題ない識別子」です（Firebase の仕様）。
 * データの保護は Firestore のセキュリティルール（firestore.rules）で行います。
 */
window.RIKUYOU_FIREBASE = {
  enabled: false,
  config: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: ''
  },
  // 管理用アカウント（全キャラを所持）にするメールアドレス。メール確認が済んだアカウントだけ有効
  adminEmails: [],
  // テスト用：Firebase エミュレーターに接続する
  emulator: false,
  // この端末保存モード（enabled:false）で使う管理用コードの SHA-256（コードそのものは書かない）
  localAdminCodeHash: '6d7d5b18a7a652f62452e96fe13b8d976e1d4ae8a8d1dbd3e4a374d071eb9a86'
};
