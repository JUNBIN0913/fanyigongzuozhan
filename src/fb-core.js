// 共用的 Firebase 初始化（前台與後台各自打包時都會引入）
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

export function initFirebase(cfg) {
  if (!cfg || !cfg.projectId || !cfg.apiKey || /YOUR_/.test(cfg.apiKey + cfg.projectId)) {
    throw new Error('尚未設定 Firebase：請編輯 js/config.js');
  }
  const { appCheckSiteKey, ...appConfig } = cfg;

  // 本機開發時使用 App Check 除錯權杖（會在主控台印出一組，需到 Console 登錄）
  if (appCheckSiteKey && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  const app = initializeApp(appConfig);
  if (appCheckSiteKey) {
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }

  // 啟用本機快取：回訪時索引文件從快取讀取，只為「有變更」的內容計費
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    db = getFirestore(app);
  }

  const auth = getAuth(app);

  // 確保已有使用者：沒有就匿名登入（訪客提問、造訪、瀏覽計數需要 uid）
  let userPromise = null;
  function ensureUser() {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    if (!userPromise) {
      userPromise = new Promise((resolve, reject) => {
        const off = onAuthStateChanged(auth, user => {
          if (user) { off(); resolve(user); }
          else signInAnonymously(auth).catch(err => { off(); userPromise = null; reject(err); });
        });
      });
    }
    return userPromise;
  }

  return { app, auth, db, ensureUser };
}
