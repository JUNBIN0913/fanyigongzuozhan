// Firebase SDK 轉接層。SDK 版本固定為 10.14.1，直接從 Google 的 CDN 載入（不需要打包工具）。
import { firebaseConfig, recaptchaSiteKey } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, query, where, limit, getDoc, getDocs, onSnapshot, setDoc, updateDoc,
  writeBatch, increment, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('YOUR_')) {
  throw new Error('尚未設定 Firebase：請編輯 js/firebase-config.js');
}

const app = initializeApp(firebaseConfig);

if (recaptchaSiteKey) {
  // 本機開發時使用除錯權杖（請把主控台印出的權杖加到 Console → App Check → 管理除錯權杖）
  if (['localhost', '127.0.0.1'].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
}

const auth = getAuth(app);
let db;
try {
  // 本機持久快取：回訪時只需讀取有變動的部分，節省免費讀取額度
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = getFirestore(app); // 無痕模式等不支援 IndexedDB 的環境
}

const authReady = new Promise(res => { const un = onAuthStateChanged(auth, u => { un(); res(u); }); });
let userPromise = null;
const ensureUser = () => (userPromise ||= (async () => {
  const u = await authReady;
  if (u) return u.uid;
  return (await signInAnonymously(auth)).user.uid;
})().catch(e => { userPromise = null; throw e; }));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
};

export const fb = {
  now: () => new Date(),
  storage: store,
  ensureUser,
  serverTimestamp: () => serverTimestamp(),
  increment: n => increment(n),
  newId: col => doc(collection(db, col)).id,
  isCode: (err, code) => !!err && err.code === code,

  onDoc(col, id, cb, errCb) {
    return onSnapshot(doc(db, col, id), s => cb(s.exists(), s.data()), errCb);
  },
  async getDoc(col, id) {
    const s = await getDoc(doc(db, col, id));
    return s.exists() ? s.data() : null;
  },
  async queryOne(col, conds) {
    const s = await getDocs(query(collection(db, col), ...conds.map(c => where(...c)), limit(1)));
    return s.empty ? null : { id: s.docs[0].id, data: s.docs[0].data() };
  },
  setDoc: (col, id, data) => setDoc(doc(db, col, id), data),
  updateDoc: (col, id, data) => updateDoc(doc(db, col, id), data),
  async commit(ops) {
    const b = writeBatch(db);
    for (const o of ops) b.set(doc(db, o.col, o.id), o.data);
    await b.commit();
  },
};
