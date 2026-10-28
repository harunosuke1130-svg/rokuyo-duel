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
  emulator: false
};
