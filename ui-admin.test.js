// 後台介面測試：真正的 admin-adapter + 記憶體版假 Firestore + jsdom。涵蓋登入閘門、儀表板、文章、標籤、提問審核。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const buildFake = require('./helpers/build-fake');

const ADMIN = path.join(__dirname, '..', 'public', 'admin');
const bundle = buildFake('src/admin-adapter.js');
const purify = fs.readFileSync(path.join(__dirname, '..', 'public', 'vendor', 'purify.min.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

(async () => {
  const html = fs.readFileSync(path.join(ADMIN, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/admin/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.FIREBASE_CONFIG = { apiKey: 'k', authDomain: 'd', projectId: 'demo', appId: 'a' };
  w.__FAKE = { users: [{ uid: 'admin1', email: 'a@x.com', password: 'pw12345678' }, { uid: 'u2', email: 'b@x.com', password: 'pw12345678' }] };
  w.eval(purify); w.eval(bundle);
  const F = w.__FAKE, A = w.YuwenAdmin, TS = F.Timestamp;
  F.fs.docs.set('admins/admin1', { createdAt: new TS(1) });

  w.eval(fs.readFileSync(path.join(ADMIN, 'js', 'common.js'), 'utf8'));
  const redirects = [];
  w.Admin.goLogin = r => redirects.push(r || '');
  for (const f of ['view-dashboard', 'view-articles', 'view-tags', 'view-questions', 'view-editor', 'main']) w.eval(fs.readFileSync(path.join(ADMIN, 'js', f + '.js'), 'utf8'));

  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const go = async (h, ms = 150) => { w.location.hash = h; await sleep(ms); };
  const btnIn = (root, text) => [...root.querySelectorAll('button,a.btn')].find(b => b.textContent.trim() === text);
  const dlgBtn = t => [...$$('dialog button')].find(b => b.textContent.trim() === t);
  await sleep(150);

  /* ---- 登入閘門 ---- */
  ok('未登入：導向登入頁，畫面不載入任何內容', redirects.length >= 1 && $('#view').children.length === 0, JSON.stringify(redirects));
  await A.signIn('b@x.com', 'pw12345678'); await sleep(150);
  ok('已登入但不在白名單：被登出並以 noadmin 導向', redirects.includes('noadmin') && F.auth.currentUser === null, JSON.stringify(redirects));
  await A.signIn('a@x.com', 'pw12345678'); await sleep(250);
  ok('管理員登入後顯示帳號與儀表板', $('#who').textContent === 'a@x.com' && $$('.stat').length === 5, $('#view').textContent.slice(0, 80));
  ok('頁籤高亮：儀表板', $('#tabs a.active')?.dataset.tab === 'dashboard');

  /* ---- 準備資料 ---- */
  const t1 = await A.addTag('錯別字'), t2 = await A.addTag('成語');
  const a1 = await A.saveArticle({ title: '已發布的文章', summary: '摘要', bodyHtml: '<p>內文一</p>', tagIds: [t1.id] }); await A.publishArticle(a1);
  const a2 = await A.saveArticle({ title: '尚未發布的草稿', bodyHtml: '<p>內文二</p>', tagIds: [t1.id, t2.id] });
  F.fs.docs.set('questions/q1', { content: '請問「應該」和「應當」差在哪？', status: 'pending', createdAt: new TS(Date.now() - 5000), askerName: '阿明' });
  F.fs.docs.set('visits/' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, '') + '_u1', { day: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, ''), at: new TS(1) });
  F.fs.docs.set('articleViews/' + a1, { count: 12 });
  F.notify(); await sleep(150);
  ok('待回覆提問徽章即時出現', !$('#badge').hidden && $('#badge').textContent === '1');

  /* ---- 儀表板 ---- */
  await go('#/dashboard'); await go('#/dashboard', 300);
  btnIn($('#view'), '重新整理').click(); await sleep(300);
  const nums = $$('.stat .n').map(n => n.textContent);
  ok('儀表板：已發布 1、草稿 1、造訪 1、瀏覽 12、待回覆 1', nums.join() === '1,1,1,12,1', nums.join());
  ok('儀表板：各篇瀏覽表與近 14 日長條', $$('tbody tr').some(r => r.textContent.includes('已發布的文章') && r.textContent.includes('12')) && $$('.bar').length === 14);

  /* ---- 文章列表 ---- */
  await go('#/articles', 300);
  ok('文章列表：兩篇、狀態與標籤', $$('tbody tr').length === 2 && $('tr[data-article="' + a1 + '"]').textContent.includes('已發布') && $('tr[data-article="' + a2 + '"]').textContent.includes('成語'));
  btnIn($('.seg'), '草稿').click(); await sleep(50);
  ok('狀態篩選：只顯示草稿', $$('tbody tr').length === 1 && $('tbody tr').dataset.article === a2);
  btnIn($('.seg'), '全部').click(); await sleep(50);
  $('tr[data-article="' + a2 + '"] [data-act=toggle]').click(); await sleep(250);
  ok('發布草稿：列表即時變為已發布，前台索引同步', $('tr[data-article="' + a2 + '"]').textContent.includes('已發布') && !!F.fs.docs.get('meta/index').items[a2]);
  $('tr[data-article="' + a2 + '"] [data-act=toggle]').click(); await sleep(250);
  ok('下架：回到草稿並移出索引', $('tr[data-article="' + a2 + '"]').textContent.includes('草稿') && !F.fs.docs.get('meta/index').items[a2]);
  $('tr[data-article="' + a2 + '"] [data-act=delete]').click(); await sleep(100);
  ok('刪除前會先確認', /尚未發布的草稿/.test($('dialog')?.textContent || ''));
  dlgBtn('刪除').click(); await sleep(250);
  ok('刪除後列表即時移除', !$('tr[data-article="' + a2 + '"]') && !F.fs.docs.get('articles/' + a2));
  const a3 = await A.saveArticle({ title: '第三篇', bodyHtml: '<p>x</p>', tagIds: [t1.id, t2.id] }); await sleep(150);
  ok('其他來源新增文章：列表即時出現', !!$('tr[data-article="' + a3 + '"]'));

  /* ---- 標籤管理 ---- */
  await go('#/tags', 300);
  const row = n => $$('tr[data-tag]').find(r => r.children[0].textContent === n);
  ok('標籤列表含文章數（含草稿）', row('錯別字').children[2].textContent === '2' && row('成語').children[2].textContent === '1', $$('tr[data-tag]').map(r => r.textContent).join('|'));
  const inp = $('form.panel input'); inp.value = '臨時標籤';
  $('form.panel').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(250);
  ok('新增標籤：即時出現', !!row('臨時標籤'));
  inp.value = '臨時標籤';
  $('form.panel').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(250);
  ok('重複名稱顯示錯誤提示', $$('.toast.error').some(t => /已存在/.test(t.textContent)));
  row('臨時標籤').querySelector('[data-act=rename]').click(); await sleep(50);
  $('dialog input').value = '改名後的標籤'; dlgBtn('儲存').click(); await sleep(250);
  ok('改名：即時更新', !!row('改名後的標籤') && !row('臨時標籤'));
  row('成語').querySelector('[data-act=merge]').click(); await sleep(50);
  const sel = $('dialog select'); sel.value = [...sel.options].find(o => o.textContent.startsWith('錯別字')).value;
  dlgBtn('合併').click(); await sleep(350);
  ok('合併：來源標籤消失，文章數合計，文章改掛目標', !row('成語') && row('錯別字').children[2].textContent === '2' && F.fs.docs.get('articles/' + a3).tagIds.length === 1);
  row('改名後的標籤').querySelector('[data-act=delete]').click(); await sleep(50);
  dlgBtn('刪除').click(); await sleep(250);
  ok('刪除標籤', !row('改名後的標籤'));

  /* ---- 提問審核 ---- */
  await go('#/questions', 300);
  let card = $('.qcard[data-q="q1"]');
  ok('待回覆提問顯示內容與提問者', card && card.textContent.includes('應該') && card.textContent.includes('阿明'));
  const ta = card.querySelector('textarea'); ta.value = '「應該」表推測。\n\n「應當」較正式。'; ta.dispatchEvent(new w.Event('input'));
  F.fs.docs.set('questions/q2', { content: '另一則新提問', status: 'pending', createdAt: new TS(Date.now()) }); F.notify();
  ta.focus(); await sleep(150);
  ok('輸入中遇到新提問湧入：不重繪，輸入框與焦點都保留', $('.qcard[data-q="q1"] textarea') === ta && w.document.activeElement === ta && ta.value.includes('應當') && $$('.qcard').length === 1, `same=${$('.qcard[data-q="q1"] textarea') === ta} focus=${w.document.activeElement === ta} cards=${$$('.qcard').length}`);
  ta.blur(); F.notify(); await sleep(150);
  ok('離開輸入框後新提問出現，且保留先前輸入', $$('.qcard').length === 2 && $('.qcard[data-q="q1"] textarea').value.includes('應當'), String($$('.qcard').length));
  $('.qcard[data-q="q1"] [data-act=answer]').click(); await sleep(250);
  ok('送出回覆：離開待回覆、徽章減少', !$('.qcard[data-q="q1"]') && $('#badge').textContent === '1' && F.fs.docs.get('questions/q1').status === 'answered');
  btnIn($('.seg'), '已回覆').click(); await sleep(250);
  card = $('.qcard[data-q="q1"]');
  ok('已回覆分頁：回覆內容可回填且保留分段', card && card.querySelector('textarea').value.includes('\n\n'));
  card.querySelector('[data-act=to-article]').click(); await sleep(100);
  $('dialog input[type=checkbox]#pubnow').checked = true;
  dlgBtn('轉為文章').click(); await sleep(400);
  const newId = F.fs.docs.get('questions/q1').publishedArticleId;
  ok('轉為文章：已發布、進入索引、導向編輯器', !!newId && F.fs.docs.get('articles/' + newId).status === 'published' && !!F.fs.docs.get('meta/index').items[newId] && w.location.hash === '#/editor/' + newId, w.location.hash);
  await go('#/articles', 300);
  ok('文章列表出現轉出的文章', !!$('tr[data-article="' + newId + '"]'));

  /* ---- 登出 ---- */
  redirects.length = 0;
  $('#logout').click(); await sleep(200);
  ok('登出：清除登入並導向登入頁', F.auth.currentUser === null && redirects.length >= 1);

  console.log(fails ? `\n${fails} 項失敗` : '\n後台介面全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
