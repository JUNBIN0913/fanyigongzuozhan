// Firebase 網頁設定（公開資訊，可以放進 GitHub；保護來自安全規則與 App Check，不靠隱藏）
// 取得方式：Firebase Console → 專案設定 → 您的應用程式 → 網頁應用程式 → SDK 設定
window.FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  appId: 'YOUR_APP_ID',
  // reCAPTCHA v3 網站金鑰（App Check）。尚未設定時留空字串。
  appCheckSiteKey: '',
};
