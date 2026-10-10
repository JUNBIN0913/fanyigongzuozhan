// 請到 Firebase Console → 專案設定 → 您的應用程式（網頁）複製設定貼在這裡。
// 這份設定本來就是公開的（任何人打開網頁都看得到），真正的保護來自 Firestore 規則與 App Check。
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  appId: 'YOUR_APP_ID',
};

// App Check（reCAPTCHA v3）網站金鑰；先留空也能運作，正式上線前建議啟用。
export const recaptchaSiteKey = '';
