// Firestore 安全規則測試。需要本機有 Java 與 Firestore 模擬器：
//   npm install && npm run test:rules
// 注意：這份測試與 firestore.rules 是在無法啟動模擬器的環境撰寫的，尚未實際執行過，請先在本機跑過再信任它。
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, increment, writeBatch, serverTimestamp, deleteDoc } = require('firebase/firestore');

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const results = [];
const test = (name, fn) => results.push([name, fn]);

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'yuwen-rules-test',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host, port: Number(port) },
  });

  const PW = { firebase: { sign_in_provider: 'password' } };
  const ANON = { firebase: { sign_in_provider: 'anonymous' } };
  const admin = () => env.authenticatedContext('adminUid', PW).firestore();
  const adminSpoof = () => env.authenticatedContext('adminUid', ANON).firestore();       // 同 uid 但匿名登入
  const stranger = () => env.authenticatedContext('strangerUid', PW).firestore();         // 密碼登入但不在白名單
  const visitor = (uid = 'v1') => env.authenticatedContext(uid, ANON).firestore();
  const guest = () => env.unauthenticatedContext().firestore();

  const art = (over = {}) => ({ title: '標題', slug: 'a-1', summary: '摘要', bodyHtml: '<p>內文</p>', status: 'draft', tagIds: [],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });

  async function reset() {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'admins/adminUid'), { createdAt: new Date() });
      await setDoc(doc(db, 'articles/pub'), { ...art({ status: 'published', slug: 'pub' }), createdAt: new Date(), updatedAt: new Date() });
      await setDoc(doc(db, 'articles/draft1'), { ...art({ slug: 'draft1' }), createdAt: new Date(), updatedAt: new Date() });
      await setDoc(doc(db, 'meta/index'), { tags: {}, items: {} });
    });
  }

  test('公開可讀 meta/index，不可寫', async () => {
    await assertSucceeds(getDoc(doc(guest(), 'meta/index')));
    await assertFails(setDoc(doc(guest(), 'meta/index'), { x: 1 }));
    await assertFails(setDoc(doc(visitor(), 'meta/index'), { x: 1 }));
  });

  test('文章：公開只能讀已發布；不帶條件的列表被拒', async () => {
    await assertSucceeds(getDoc(doc(guest(), 'articles/pub')));
    await assertFails(getDoc(doc(guest(), 'articles/draft1')));
    await assertSucceeds(getDocs(query(collection(guest(), 'articles'), where('status', '==', 'published'))));
    await assertFails(getDocs(collection(guest(), 'articles')));
  });

  test('文章：管理員可新增，匿名／非白名單／偽裝者皆不可', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'articles/new1'), art({ slug: 'new1' })));
    await assertFails(setDoc(doc(visitor(), 'articles/x1'), art()));
    await assertFails(setDoc(doc(stranger(), 'articles/x2'), art()));
    await assertFails(setDoc(doc(adminSpoof(), 'articles/x3'), art()));
  });

  test('文章：欄位驗證（多餘欄位、標題過長、狀態錯誤）', async () => {
    await assertFails(setDoc(doc(admin(), 'articles/b1'), art({ evil: true })));
    await assertFails(setDoc(doc(admin(), 'articles/b2'), art({ title: 'x'.repeat(121) })));
    await assertFails(setDoc(doc(admin(), 'articles/b3'), art({ status: 'hacked' })));
  });

  test('提問：匿名＋同批次寫 rateLimits 可成功；缺 rateLimits、多餘欄位、太短皆失敗', async () => {
    const db = visitor('q1');
    const q = (over = {}) => ({ content: '請問「應該」和「應當」差在哪？', status: 'pending', createdAt: serverTimestamp(), ...over });
    const good = writeBatch(db); good.set(doc(db, 'rateLimits/q1'), { lastAt: serverTimestamp() }); good.set(doc(db, 'questions/a'), q());
    await assertSucceeds(good.commit());
    await assertFails(setDoc(doc(visitor('q2'), 'questions/b'), q()));
    for (const [id, over] of [['q3', { isAdmin: true }], ['q4', { content: '短' }], ['q5', { status: 'answered' }]]) {
      const d = visitor(id); const b = writeBatch(d); b.set(doc(d, `rateLimits/${id}`), { lastAt: serverTimestamp() }); b.set(doc(d, `questions/${id}`), q(over));
      await assertFails(b.commit());
    }
    await assertFails(setDoc(doc(guest(), 'questions/c'), q()));
  });

  test('提問：10 分鐘內第二次被擋；訪客不可讀提問', async () => {
    const db = visitor('q6');
    const q = () => ({ content: '第一則提問內容', status: 'pending', createdAt: serverTimestamp() });
    const b1 = writeBatch(db); b1.set(doc(db, 'rateLimits/q6'), { lastAt: serverTimestamp() }); b1.set(doc(db, 'questions/f1'), q());
    await assertSucceeds(b1.commit());
    const b2 = writeBatch(db); b2.set(doc(db, 'rateLimits/q6'), { lastAt: serverTimestamp() }); b2.set(doc(db, 'questions/f2'), q());
    await assertFails(b2.commit());
    await assertFails(getDoc(doc(db, 'questions/f1')));
    await assertSucceeds(getDoc(doc(admin(), 'questions/f1')));
  });

  test('造訪：文件 ID 必須為 日期_uid；同日重複寫入被擋', async () => {
    const db = visitor('v9');
    await assertSucceeds(setDoc(doc(db, 'visits/20261008_v9'), { day: '20261008', at: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'visits/20261008_v9'), { day: '20261008', at: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'visits/20261008_someoneElse'), { day: '20261008', at: serverTimestamp() }));
    await assertFails(getDoc(doc(db, 'visits/20261008_v9')));
  });

  test('瀏覽次數：已發布文章可 +1；草稿不可；不可 +2 或遞減', async () => {
    const db = visitor('w1');
    await assertSucceeds(setDoc(doc(db, 'articleViews/pub'), { count: 1 }));
    await assertSucceeds(updateDoc(doc(db, 'articleViews/pub'), { count: increment(1) }));
    await assertFails(updateDoc(doc(db, 'articleViews/pub'), { count: increment(2) }));
    await assertFails(updateDoc(doc(db, 'articleViews/pub'), { count: increment(-1) }));
    await assertFails(setDoc(doc(db, 'articleViews/draft1'), { count: 1 }));
  });

  test('草稿：管理員只能寫自己 uid 開頭的文件', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'drafts/adminUid_new'), { title: 't' }));
    await assertFails(setDoc(doc(admin(), 'drafts/otherUid_new'), { title: 't' }));
    await assertFails(setDoc(doc(visitor('adminUid'), 'drafts/adminUid_new'), { title: 't' }));
  });

  test('admins 不可從客戶端寫入；其他集合預設拒絕', async () => {
    await assertFails(setDoc(doc(admin(), 'admins/strangerUid'), { x: 1 }));
    await assertFails(setDoc(doc(admin(), 'anything/else'), { x: 1 }));
  });

  let failed = 0;
  for (const [name, fn] of results) {
    await reset();
    try { await fn(); console.log('PASS ', name); } catch (e) { failed++; console.log('FAIL ', name, '\n      ', e.message.split('\n')[0]); }
  }
  await env.cleanup();
  console.log(failed ? `\n${failed} 項失敗` : '\n規則測試全部通過');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
