// 打包檔冒煙測試：確認 public.bundle.js 可在瀏覽器環境載入，並在設定不完整時給出明確錯誤。
// 注意：不會連線 Firebase，也無法驗證真實的 Firestore 行為（那需要模擬器或真實專案）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const bundle = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'public.bundle.js'), 'utf8');
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

function load(config) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.FIREBASE_CONFIG = config;
  try { dom.window.eval(bundle); return { w: dom.window }; } catch (e) { return { w: dom.window, thrown: e }; }
}

(async () => {
  let r = load({ apiKey: 'YOUR_API_KEY', projectId: 'YOUR_PROJECT' });
  ok('預設（未設定）：不拋例外，記錄明確錯誤、不建立資料層', !r.thrown && /尚未設定 Firebase/.test(r.w.YuwenDataError?.message || '') && !r.w.YuwenData, String(r.thrown || r.w.YuwenDataError));

  r = load({ apiKey: 'AIzaFakeKeyForTest', authDomain: 'demo.firebaseapp.com', projectId: 'demo-test', appId: '1:1:web:1' });
  const methods = ['subscribeIndex', 'subscribeArticle', 'getViews', 'addView', 'recordVisit', 'submitQuestion'];
  ok('填入設定後建立資料層，且介面完整', !r.thrown && methods.every(m => typeof r.w.YuwenData?.[m] === 'function'),
    String(r.thrown || r.w.YuwenDataError || Object.keys(r.w.YuwenData || {})));
  setTimeout(() => { console.log(fails ? `\n${fails} 項失敗` : '\n打包檔冒煙測試通過'); process.exit(fails ? 1 : 0); }, 300);
})();
