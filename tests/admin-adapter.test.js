// 後台資料層測試：用「真正的 src/admin-adapter.js」搭配記憶體版假 Firestore（tests/fakes），
// 並在假實作中檢查一部分規則形狀（文章欄位、伺服器時間、drafts 前綴、批次上限）。
// 這不能取代 Firestore 模擬器測試（npm run test:rules）與真實專案實測。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const buildFake = require('./helpers/build-fake');

const bundle = buildFake('src/admin-adapter.js');
const purify = fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', 'purify.min.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const rejects = async (p, re) => { try { await p; return false; } catch (e) { return re.test(String(e.message) + ' ' + (e.code || '')); } };

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  w.FIREBASE_CONFIG = { apiKey: 'k', authDomain: 'd', projectId: 'demo', appId: 'a' };
  w.__FAKE = { users: [{ uid: 'admin1', email: 'a@x.com', password: 'pw12345678' }, { uid: 'u2', email: 'b@x.com', password: 'pw12345678' }] };
  w.eval(purify); w.eval(bundle);
  return { w, A: w.YuwenAdmin, F: w.__FAKE };
}
const day = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, '');

(async () => {
  const { w, A, F } = boot();
  const docs = F.fs.docs, TS = F.Timestamp;
  const get = p => docs.get(p);
  const idx = () => get('meta/index') || { tags: {}, items: {} };
  F.fs.docs.set('admins/admin1', { createdAt: new TS(1) });
  const seen = [];
  A.onAuth(u => seen.push(u && { uid: u.uid, isAdmin: u.isAdmin }));
  await sleep(30);

  /* ---- 登入 ---- */
  ok('未登入時 onAuth 回傳 null', seen.at(-1) === null);
  ok('錯誤密碼被拒', await rejects(A.signIn('a@x.com', 'wrong'), /invalid-credential/));
  ok('未登入無法寫入（規則：需要管理員）', await rejects(A.addTag('甲'), /permission-denied|尚未登入|需要管理員/));
  ok('未登入無法儲存文章', await rejects(A.saveArticle({ title: 'x', bodyHtml: '<p>x</p>' }), /尚未登入/));
  await A.signIn('b@x.com', 'pw12345678'); await sleep(30);
  ok('已登入但不在白名單：isAdmin 為 false', seen.at(-1)?.uid === 'u2' && seen.at(-1)?.isAdmin === false, JSON.stringify(seen.at(-1)));
  await A.signOut(); await sleep(30);
  await A.signIn('a@x.com', 'pw12345678'); await sleep(30);
  ok('管理員登入：isAdmin 為 true', seen.at(-1)?.isAdmin === true);
  F.auth.currentUser = { uid: 'anon', isAnonymous: true }; F.auth._l.forEach(cb => cb(F.auth.currentUser)); await sleep(30);
  ok('匿名使用者視為未登入', seen.at(-1) === null);
  F.auth.currentUser = null; await A.signIn('a@x.com', 'pw12345678'); await sleep(30);

  /* ---- 標籤 ---- */
  const t1 = await A.addTag('錯別字'), t2 = await A.addTag('成語'), t3 = await A.addTag('Idiom');
  ok('新增標籤：寫入索引，slug 保留中文', idx().tags[t1.id]?.name === '錯別字' && t1.slug === '錯別字' && t3.slug === 'idiom');
  ok('重複名稱（不分大小寫）被拒', await rejects(A.addTag('idiom'), /已存在/));
  ok('空白名稱被拒', await rejects(A.addTag('   '), /請輸入/));
  const r1 = await A.renameTag(t1.id, '錯別字辨正');
  ok('改名同步更新 slug', idx().tags[t1.id].name === '錯別字辨正' && r1.slug === '錯別字辨正');
  ok('改成已存在名稱被拒', await rejects(A.renameTag(t1.id, '成語'), /已存在/));
  ok('不存在的標籤無法改名', await rejects(A.renameTag('nope', 'x'), /找不到/));

  /* ---- 文章 ---- */
  const body = '<p>' + '再接再厲'.repeat(80) + '</p><script>alert(1)</script><img src=x onerror=alert(1)>';
  const a1 = await A.saveArticle({ title: '「再接再厲」別寫錯', summary: '摘要'.repeat(200), bodyHtml: body, tagIds: [t1.id, t2.id, 'bogus'] });
  const d1 = get('articles/' + a1);
  ok('新增文章：草稿、slug 去除標點、無效標籤被濾除', d1.status === 'draft' && d1.slug === '再接再厲別寫錯' && JSON.stringify(d1.tagIds) === JSON.stringify([t1.id, t2.id]), JSON.stringify(d1.tagIds) + d1.slug);
  ok('內文消毒：script / onerror / img 被移除', !/script|onerror|<img/i.test(d1.bodyHtml), d1.bodyHtml.slice(0, 80));
  ok('摘要截至 300 字；時間為伺服器時間；publishedAt 為 null', d1.summary.length === 300 && d1.createdAt instanceof TS && d1.updatedAt instanceof TS && d1.publishedAt === null);
  const a1b = await A.saveArticle({ title: '「再接再厲」別寫錯', bodyHtml: '<p>另一篇</p>', tagIds: [] });
  ok('重複標題的 slug 自動加後綴', get('articles/' + a1b).slug === '再接再厲別寫錯-2');
  await A.saveArticle({ id: a1b, title: '完全不同的標題', bodyHtml: '<p>改過</p>', tagIds: [] });
  ok('草稿改標題時 slug 跟著更新', get('articles/' + a1b).slug === '完全不同的標題');

  ok('標題或內文為空時不可發布', await rejects(A.publishArticle(await A.saveArticle({ title: '空文', bodyHtml: '', tagIds: [] })), /不可為空/));
  await A.publishArticle(a1);
  const p1 = get('articles/' + a1), it1 = idx().items[a1];
  ok('發布：狀態、publishedAt 與索引項目', p1.status === 'published' && p1.publishedAt instanceof TS && it1 && it1.slug === p1.slug && it1.publishedAt.ms === p1.publishedAt.ms);
  ok('索引摘要 ≤120 字、內文摘錄 ≤150 字（純文字）', it1.summary.length === 120 && it1.excerpt.length === 150 && !/</.test(it1.excerpt));
  ok('索引含標籤', JSON.stringify(it1.tagIds) === JSON.stringify([t1.id, t2.id]));
  const pubAt = p1.publishedAt.ms, oldSlug = p1.slug;
  await A.saveArticle({ id: a1, title: '改過標題的已發布文章', summary: '新摘要', bodyHtml: '<p>新內文</p>', tagIds: [t2.id] });
  ok('已發布文章修改：網址與發布時間不變，索引同步更新', get('articles/' + a1).slug === oldSlug && idx().items[a1].title === '改過標題的已發布文章' && idx().items[a1].publishedAt.ms === pubAt && idx().items[a1].excerpt === '新內文');
  await A.publishArticle(a1, false);
  ok('下架：回草稿、移出索引、保留 publishedAt', get('articles/' + a1).status === 'draft' && !idx().items[a1] && get('articles/' + a1).publishedAt.ms === pubAt);
  await A.publishArticle(a1);
  ok('重新發布沿用原本的發布時間', idx().items[a1].publishedAt.ms === pubAt);

  const list = await new Promise(r => { const un = A.subscribeArticles(x => { un(); r(x); }); });
  ok('文章列表依更新時間新到舊，且不含內文', list.length >= 3 && list.every((x, i) => i === 0 || x.updatedAt <= list[i - 1].updatedAt) && !('bodyHtml' in list[0]));
  ok('getArticle 回傳完整內文', (await A.getArticle(a1)).bodyHtml.includes('新內文'));
  ok('getArticle 找不到時回傳 null', (await A.getArticle('nope')) === null);

  /* ---- 草稿（自動暫存）---- */
  await A.saveDraft(null, { title: '新稿', bodyHtml: '<p>暫存</p><script>x</script>' });
  ok('新文章暫存寫入 drafts/{uid}_new，且已消毒', get('drafts/admin1_new')?.title === '新稿' && !/script/.test(get('drafts/admin1_new').bodyHtml));
  ok('getDraft 讀回暫存', (await A.getDraft(null)).bodyHtml === '<p>暫存</p>');
  const a3 = await A.saveArticle({ title: '存檔會清掉暫存', bodyHtml: '<p>x</p>', tagIds: [] });
  ok('新增文章成功後清除「新文章」暫存', !get('drafts/admin1_new') && (await A.getDraft(null)) === null);
  await A.saveDraft(a3, { title: '改', bodyHtml: '<p>改</p>' });
  ok('既有文章暫存寫入 drafts/{uid}_{id}', !!get(`drafts/admin1_${a3}`));
  await A.saveArticle({ id: a3, title: '存檔會清掉暫存', bodyHtml: '<p>y</p>', tagIds: [] });
  ok('儲存文章後清除該文章暫存', !get(`drafts/admin1_${a3}`));
  await A.saveDraft(a3, { title: '再暫存', bodyHtml: '<p>z</p>' }); await A.deleteDraft(a3);
  ok('deleteDraft 刪除暫存', !get(`drafts/admin1_${a3}`));

  /* ---- 標籤合併／刪除（影響文章與索引）---- */
  const x1 = await A.saveArticle({ title: '草稿甲', bodyHtml: '<p>a</p>', tagIds: [t1.id, t3.id] });
  const x2 = await A.saveArticle({ title: '已發布乙', bodyHtml: '<p>b</p>', tagIds: [t1.id] }); await A.publishArticle(x2);
  const m = await A.mergeTag(t1.id, t3.id);
  ok('合併：草稿與已發布文章都改掛目標標籤並去重', m.affected >= 2 && JSON.stringify(get('articles/' + x1).tagIds) === JSON.stringify([t3.id]) && JSON.stringify(get('articles/' + x2).tagIds) === JSON.stringify([t3.id]));
  ok('合併：索引項目同步、來源標籤被移除', JSON.stringify(idx().items[x2].tagIds) === JSON.stringify([t3.id]) && !idx().tags[t1.id] && !!idx().tags[t3.id]);
  ok('合併給自己或不存在的標籤被拒', await rejects(A.mergeTag(t3.id, t3.id), /不同/) && await rejects(A.mergeTag('nope', t3.id), /找不到/));
  const t4 = await A.addTag('大量測試');
  for (let i = 0; i < 40; i++) docs.set('articles/bulk' + i, { title: 'b' + i, slug: 'bulk' + i, summary: '', bodyHtml: '<p>x</p>', status: i % 2 ? 'published' : 'draft', tagIds: [t4.id], createdAt: new TS(1), updatedAt: new TS(1), publishedAt: i % 2 ? new TS(5) : null });
  const t5 = await A.addTag('大量目標');
  F.writes = [];
  const mm = await A.mergeTag(t4.id, t5.id);
  const sizes = F.writes.map(x => x.length);
  ok('大量合併：40 篇全部更新，且每批寫入 ≤ 16 筆（符合規則呼叫上限）', mm.affected === 40 && sizes.every(n => n <= 16) && [...Array(40).keys()].every(i => get('articles/bulk' + i).tagIds[0] === t5.id), sizes.join(','));
  ok('大量合併：來源標籤最後才刪除', F.writes.at(-1).length === 1 && !idx().tags[t4.id]);
  const dl = await A.deleteTag(t5.id);
  ok('刪除標籤：文章移除該標籤，索引同步', dl.affected === 40 && get('articles/bulk1').tagIds.length === 0 && idx().items.bulk1.tagIds.length === 0 && !idx().tags[t5.id]);

  /* ---- 刪除文章 ---- */
  docs.set('articleViews/' + x2, { count: 7 });
  await A.deleteArticle(x2);
  ok('刪除文章：同批移除索引項目與瀏覽計數', !get('articles/' + x2) && !idx().items[x2] && !get('articleViews/' + x2));

  /* ---- 提問審核 ---- */
  docs.set('questions/q1', { content: '請問<b>的地得</b>\n怎麼分？', status: 'pending', createdAt: new TS(1000) });
  docs.set('questions/q2', { content: '第二個問題內容', status: 'pending', createdAt: new TS(2000), askerName: '阿明' });
  const qs = await new Promise(r => { const un = A.subscribeQuestions('pending', x => { un(); r(x); }); });
  ok('待回覆提問依時間新到舊', qs.map(q => q.id).join() === 'q2,q1' && qs[0].askerName === '阿明');
  ok('未回覆不可轉文章', await rejects(A.questionToArticle('q1', { title: 't' }), /請先回覆/));
  ok('空白回覆被拒', await rejects(A.answerQuestion('q1', '<p>  </p>'), /請輸入/));
  await A.answerQuestion('q1', '<p>「的」接名詞。</p><script>x</script>');
  ok('回覆：狀態改為已回覆、回覆內容已消毒', get('questions/q1').status === 'answered' && !/script/.test(get('questions/q1').answerHtml) && get('questions/q1').answeredAt instanceof TS);
  const ga = await A.questionToArticle('q1', { title: '', tagIds: [t3.id, 'bogus'], publish: false });
  const qa = get('articles/' + ga);
  ok('問答轉草稿文章：引文逸出 HTML、保留換行、帶 sourceQuestionId', qa.status === 'draft' && qa.bodyHtml.startsWith('<blockquote>') && qa.bodyHtml.includes('&lt;b&gt;') && qa.bodyHtml.includes('<br>') && qa.sourceQuestionId === 'q1' && JSON.stringify(qa.tagIds) === JSON.stringify([t3.id]), qa.bodyHtml.slice(0, 120));
  ok('提問記錄轉出的文章 ID；不可重複轉換', get('questions/q1').publishedArticleId === ga && await rejects(A.questionToArticle('q1', { title: 'x' }), /已轉為文章/));
  await A.answerQuestion('q2', '<p>第二個答覆</p>');
  const gb = await A.questionToArticle('q2', { title: '直接發布的問答', tagIds: [], publish: true });
  ok('問答直接發布：狀態、索引項目與發布時間', get('articles/' + gb).status === 'published' && idx().items[gb]?.title === '直接發布的問答' && idx().items[gb].publishedAt.ms === get('articles/' + gb).publishedAt.ms);
  await A.archiveQuestion('q1');
  ok('封存提問', get('questions/q1').status === 'archived');
  await A.deleteQuestion('q1');
  ok('刪除提問', !get('questions/q1'));

  /* ---- 儀表板 ---- */
  const today = day(), yest = day(new Date(Date.now() - 86400000));
  docs.set(`visits/${today}_u1`, { day: today, at: new TS(1) }); docs.set(`visits/${today}_u2`, { day: today, at: new TS(1) }); docs.set(`visits/${yest}_u1`, { day: yest, at: new TS(1) });
  docs.set('articleViews/' + a1, { count: 5 }); docs.set('articleViews/' + gb, { count: 9 });
  docs.set('questions/q9', { content: '待回覆的問題', status: 'pending', createdAt: new TS(3000) });
  const st = await A.getStats();
  ok('統計：發布數／草稿數／待回覆提問', st.publishedCount === Object.keys(idx().items).length && st.publishedCount >= 2 && st.draftCount >= 1 && st.pendingQuestions === 1, JSON.stringify([st.publishedCount, st.draftCount, st.pendingQuestions]));
  ok('統計：造訪人次（總計、今日）與總瀏覽', st.totalVisits === 3 && st.todayVisits === 2 && st.totalViews === 14);
  ok('統計：各篇瀏覽依次數排序並含標題', st.articleViews[0].id === gb && st.articleViews[0].viewCount === 9 && st.articleViews[0].title === '直接發布的問答');
  ok('統計：近 14 日造訪（由舊到新，最後一天為今天）', st.visitsByDay.length === 14 && st.visitsByDay.at(-1).day === today && st.visitsByDay.at(-1).visits === 2 && st.visitsByDay.at(-2).visits === 1);

  console.log(fails ? `\n${fails} 項失敗` : '\n後台資料層全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
