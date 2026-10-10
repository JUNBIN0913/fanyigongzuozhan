// 資料層測試：以假的 fb 轉接物件驗證 data.js 的行為，並用「規則形狀檢查」確認寫入內容符合 firestore.rules 的要求。
// 這能抓出前端寫入與規則不一致的問題，但不能取代在 Firestore 模擬器上執行 tests/rules.test.js。
const fs = require('fs');
const path = require('path');
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const TS = { __ts: true };
function makeFb(over = {}) {
  const mem = new Map(), log = [];
  const fb = {
    log, mem,
    now: () => new Date('2026-10-08T10:00:00Z'),
    storage: { get: k => mem.get(k) ?? null, set: (k, v) => mem.set(k, v) },
    ensureUser: async () => 'u1',
    serverTimestamp: () => TS,
    increment: n => ({ __inc: n }),
    newId: () => 'q-new',
    isCode: (e, c) => !!e && e.code === c,
    onDoc: (col, id, cb) => { log.push(['onDoc', col, id]); fb._cb = cb; return () => {}; },
    getDoc: async (col, id) => { log.push(['getDoc', col, id]); return fb._doc ?? null; },
    queryOne: async (col, conds) => { log.push(['queryOne', col, conds]); return fb._hit ?? null; },
    setDoc: async (col, id, data) => { log.push(['setDoc', col, id, data]); if (fb._setErr) throw fb._setErr; },
    updateDoc: async (col, id, data) => { log.push(['updateDoc', col, id, data]); if (fb._updErr) throw fb._updErr; },
    commit: async ops => { log.push(['commit', ops]); if (fb._commitErr) throw fb._commitErr; },
    ...over,
  };
  return fb;
}

// 與 firestore.rules 對應的「形狀」檢查
const only = (o, keys) => Object.keys(o).every(k => keys.includes(k));
const rulesQuestion = d => only(d, ['content', 'askerName', 'contact', 'status', 'createdAt']) && ['content', 'status', 'createdAt'].every(k => k in d)
  && typeof d.content === 'string' && d.content.length >= 5 && d.content.length <= 1000
  && (!('askerName' in d) || (typeof d.askerName === 'string' && d.askerName.length <= 40))
  && (!('contact' in d) || (typeof d.contact === 'string' && d.contact.length <= 100))
  && d.status === 'pending' && d.createdAt === TS;
const rulesRateLimit = d => only(d, ['lastAt']) && d.lastAt === TS && Object.keys(d).length === 1;
const rulesVisit = (id, d, uid) => only(d, ['day', 'at']) && /^[0-9]{8}$/.test(d.day) && d.at === TS && id === `${d.day}_${uid}`;

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'data.js'), 'utf8');
  ok('data.js 沒有 import 語句（可獨立測試）', !/^\s*import\s/m.test(src));
  const { createApi } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

  // --- 索引 ---
  {
    const fb = makeFb(), api = createApi(fb); let got;
    api.subscribeIndex(d => (got = d), () => {});
    ok('訂閱 meta/index', eq(fb.log[0], ['onDoc', 'meta', 'index']));
    fb._cb(true, {
      updatedAt: { toDate: () => new Date('2026-10-01T00:00:00Z') },
      tags: { b: { name: '成語', slug: 'chengyu' }, a: { name: '錯別字', slug: 'cuobiezi' } },
      items: { x1: { title: 'T', slug: 's1', summary: '摘', excerpt: '節錄', tagIds: ['a'], publishedAt: { toDate: () => new Date('2026-09-30T00:00:00Z') } } },
    });
    ok('標籤與文章正規化、日期轉為 Date', got.tags.length === 2 && got.items[0].publishedAt instanceof Date && got.items[0].id === 'x1' && got.stamp === new Date('2026-10-01T00:00:00Z').getTime());
    fb._cb(false, undefined);
    ok('索引不存在時視為空', got.tags.length === 0 && got.items.length === 0);
  }

  // --- 取文章 ---
  {
    const fb = makeFb(), api = createApi(fb);
    ok('找不到文章回傳 null', (await api.getArticle('nope')) === null);
    const q = fb.log.find(l => l[0] === 'queryOne');
    ok('查詢條件含 slug 與 status==published（規則要求）', eq(q[2], [['slug', '==', 'nope'], ['status', '==', 'published']]));
    fb._hit = { id: 'art1', data: { title: 'A', slug: 'a', summary: '', bodyHtml: '<p>x</p>', tagIds: ['t'], publishedAt: { toDate: () => new Date(0) } } };
    const a = await api.getArticle('a');
    ok('文章正規化', a.id === 'art1' && a.bodyHtml === '<p>x</p>' && a.tagIds[0] === 't');
    fb._doc = { count: 5 }; ok('讀取瀏覽次數', (await api.getViews('art1')) === 5);
    fb._doc = null; ok('尚無瀏覽紀錄為 0', (await api.getViews('art1')) === 0);
    fb.getDoc = async () => { throw new Error('x'); }; ok('讀取失敗回傳 null（不影響頁面）', (await api.getViews('art1')) === null);
  }

  // --- 造訪 ---
  {
    const fb = makeFb(), api = createApi(fb);
    await api.trackVisit();
    const w = fb.log.find(l => l[0] === 'setDoc');
    ok('造訪寫入 visits/{日期_uid}', w && w[1] === 'visits' && rulesVisit(w[2], w[3], 'u1'), JSON.stringify(w));
    await api.trackVisit();
    ok('同日第二次不再寫入', fb.log.filter(l => l[0] === 'setDoc').length === 1);

    const fb2 = makeFb({ now: () => new Date('2026-10-08T17:30:00Z') });  // 台北時間已是 10/09
    await createApi(fb2).trackVisit();
    ok('「一天」以台北時間計（UTC 17:30 → 台北隔日）', fb2.log.find(l => l[0] === 'setDoc')[2] === '20261009_u1');

    const fb3 = makeFb(); fb3._setErr = { code: 'permission-denied' };
    await createApi(fb3).trackVisit();
    ok('重複造訪被規則擋下時靜默處理並標記', fb3.mem.size === 1);

    const fb4 = makeFb(); fb4._setErr = { code: 'unavailable' };
    let threw = false; try { await createApi(fb4).trackVisit(); } catch { threw = true; }
    ok('其他錯誤會往外拋且不標記已造訪', threw && fb4.mem.size === 0);
  }

  // --- 單篇瀏覽 ---
  {
    const fb = makeFb(), api = createApi(fb);
    await api.trackView('art1');
    const u = fb.log.find(l => l[0] === 'updateDoc');
    ok('瀏覽 +1 以 increment 寫入（規則：count == 原值 + 1）', u && u[1] === 'articleViews' && u[2] === 'art1' && eq(u[3], { count: { __inc: 1 } }));
    await api.trackView('art1');
    ok('同篇同日只送一次', fb.log.filter(l => l[0] === 'updateDoc').length === 1);

    const fb2 = makeFb(); fb2._updErr = { code: 'not-found' };
    await createApi(fb2).trackView('art2');
    const s = fb2.log.find(l => l[0] === 'setDoc');
    ok('尚無文件時以 count:1 建立（規則：create 需 count == 1）', s && s[1] === 'articleViews' && eq(s[3], { count: 1 }));

    const fb3 = makeFb(); fb3._updErr = { code: 'permission-denied' };
    await createApi(fb3).trackView('art3');
    ok('被規則擋下時靜默處理', true);
  }

  // --- 提問 ---
  {
    const fb = makeFb(), api = createApi(fb);
    await api.submitQuestion({ content: '  請問「應該」和「應當」差在哪？ ', askerName: ' 阿明 ', contact: '' });
    const c = fb.log.find(l => l[0] === 'commit')[1];
    ok('同一批次寫入 rateLimits 與 questions', c.length === 2 && c[0].col === 'rateLimits' && c[0].id === 'u1' && c[1].col === 'questions' && c[1].id === 'q-new');
    ok('rateLimits 內容符合規則（僅 lastAt = 伺服器時間）', rulesRateLimit(c[0].data));
    ok('提問內容符合規則（欄位、長度、status、createdAt）', rulesQuestion(c[1].data), JSON.stringify(c[1].data));
    ok('空的聯絡方式不送出、名稱已去空白', !('contact' in c[1].data) && c[1].data.askerName === '阿明' && c[1].data.content.startsWith('請問'));
    ok('成功後記錄 lastAskAt', fb.mem.get('lastAskAt') === String(fb.now().getTime()));

    const fb2 = makeFb(), api2 = createApi(fb2);
    for (const bad of ['', '短', 'x'.repeat(1001)]) {
      let err; try { await api2.submitQuestion({ content: bad }); } catch (e) { err = e; }
      ok(`內容長度不合法被擋（${bad.length} 字）`, err && err.code === 'invalid');
    }
    ok('不合法時完全不寫入、不呼叫 ensureUser 之後的動作', !fb2.log.some(l => l[0] === 'commit'));

    const long = makeFb(), apiL = createApi(long);
    await apiL.submitQuestion({ content: '合法的提問內容', askerName: 'n'.repeat(80), contact: 'c'.repeat(300) });
    const d = long.log.find(l => l[0] === 'commit')[1][1].data;
    ok('過長的名稱／聯絡方式被截到規則上限', d.askerName.length === 40 && d.contact.length === 100 && rulesQuestion(d));

    const fb3 = makeFb(); fb3._commitErr = { code: 'permission-denied' };
    let e3; try { await createApi(fb3).submitQuestion({ content: '合法的提問內容' }); } catch (e) { e3 = e; }
    ok('被規則擋下（冷卻）時錯誤碼原樣往外拋，且不記錄 lastAskAt', e3 && e3.code === 'permission-denied' && !fb3.mem.has('lastAskAt'));
  }

  console.log(fails ? `\n${fails} 項失敗` : '\n資料層全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
