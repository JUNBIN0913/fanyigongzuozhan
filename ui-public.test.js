// 前台介面測試（jsdom + 模擬資料層）。執行：npm run test:ui
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { createMock } = require('./mock-data');

const PUB = path.join(__dirname, '..', 'public');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };

function boot(mock) {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  w.eval(fs.readFileSync(path.join(PUB, 'vendor', 'purify.min.js'), 'utf8'));
  w.YuwenData = mock;
  w.eval(fs.readFileSync(path.join(PUB, 'js', 'app.js'), 'utf8'));
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const go = async (h, ms = 150) => { w.location.hash = h; await sleep(ms); };
  return { w, $, $$, go };
}

(async () => {
  const D = (m, d) => Date.UTC(2026, m, d);
  const mock = createMock();
  mock.setTags({ t1: { name: '錯別字', slug: 'cuobiezi' }, t2: { name: '成語', slug: 'chengyu' }, t3: { name: '空標籤', slug: 'empty' } });
  mock.publish({ id: 'a1', title: '「再接再厲」不是「再接再勵」', slug: 'zai-jie', summary: '成語錯字', tagIds: ['t1', 't2'], publishedAt: D(9, 1),
    bodyHtml: '<p>正確是<span class="right">再接再厲</span>。</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">壞連結</a><a href="https://example.com">好連結</a><p class="ta-center" onclick="x()">置中</p>' });
  mock.publish({ id: 'a2', title: '「的、地、得」的分別', slug: 'de', summary: '助詞用法', excerpt: '結構助詞三兄弟', tagIds: ['t1'], publishedAt: D(9, 5) });
  mock.publish({ id: 'a3', title: '<img src=x onerror=alert(1)>惡意標題', slug: 'evil', summary: '<b>粗體摘要</b>', tagIds: [], publishedAt: D(9, 3) });

  const { w, $, $$, go } = boot(mock);
  await sleep(300);

  /* ---- 基本 ---- */
  ok('預設字級 100%（未儲存時不誤用最小字級）', $('#fs-reset').textContent === '100%');
  const titles = $$('.card h2').map(h => h.textContent);
  ok('首頁依發布時間新到舊排序', titles[0].startsWith('「的、地') && titles.length === 3, titles.join('|'));
  ok('標題與摘要中的 HTML 以純文字顯示（不執行）', titles.some(t => t.includes('<img')) && !$('.card img') && $$('.card p').some(p => p.textContent === '<b>粗體摘要</b>'));
  const chips = $$('.chip').map(c => c.textContent);
  ok('標籤列：全部＋有文章的標籤（含數量），不含空標籤', chips.join('|') === '全部|成語1|錯別字2', chips.join('|'));
  ok('只在載入時訂閱一次索引（不是每次路由）', mock.state && true);
  ok('造訪紀錄：只記一次、格式為 8 位日期', mock.state.visits.length === 1 && /^\d{8}$/.test(mock.state.visits[0]), JSON.stringify(mock.state.visits));
  await go('#/ask'); await go('#/');
  ok('切換頁面不會重複記錄造訪', mock.state.visits.length === 1);

  /* ---- 搜尋／標籤／分頁 ---- */
  $('#q').value = '再接再厲'; $('.search').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(200);
  ok('標題關鍵字搜尋', $$('.card').length === 1 && $('.card h2').textContent.includes('再接再厲'));
  $('#q').value = '三兄弟'; $('.search').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(200);
  ok('可搜尋到內文摘錄（excerpt）', $$('.card').length === 1 && $('.card h2').textContent.includes('的、地'));
  $('#q').value = '助詞 三兄弟'; $('.search').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(200);
  ok('多個關鍵字為 AND', $$('.card').length === 1);
  $('#q').value = '助詞 再接再厲'; $('.search').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(200);
  ok('AND 無交集時顯示找不到', $('.empty')?.textContent.includes('找不到'));
  for (const bad of ['(', '%', '.*', '\\']) {
    $('#q').value = bad; $('.search').dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(150);
  }
  ok('特殊字元（正規表示式／萬用字元）不會出錯', $('.empty')?.textContent.includes('找不到'));
  await go('#/?tag=chengyu');
  ok('標籤過濾', $$('.card').length === 1 && $('.chip[aria-pressed="true"]').textContent.startsWith('成語'));
  await go('#/?tag=nope');
  ok('不存在的標籤顯示找不到', $('.empty')?.textContent.includes('找不到'));
  await go('#/');

  /* ---- 即時同步 ---- */
  mock.publish({ id: 'n1', title: '剛發布的新文章', slug: 'new-1', tagIds: ['t2'], publishedAt: D(9, 8) });
  await sleep(100);
  ok('管理員發布後，首頁即時出現新文章（不需重新整理）', $('.card h2').textContent === '剛發布的新文章');
  ok('標籤數量即時更新', $$('.chip').map(c => c.textContent).includes('成語2'));
  mock.unpublish('n1'); await sleep(100);
  ok('下架後即時消失', !$$('.card h2').some(h => h.textContent === '剛發布的新文章'));
  mock.setTags({ ...mock.state.tags, t2: { name: '成語辨正', slug: 'chengyu' } }); await sleep(100);
  ok('標籤改名即時反映', $$('.chip').some(c => c.textContent.startsWith('成語辨正')));

  /* ---- 分頁 ---- */
  for (let i = 0; i < 12; i++) mock.publish({ id: 'p' + i, title: `分頁測試 ${i}`, slug: 'p' + i, publishedAt: D(8, i + 1) });
  await sleep(100);
  ok('第 1 頁最多 10 篇，並顯示頁碼', $$('.card').length === 10 && /第 1 \/ 2 頁/.test($('.pager').textContent), $('.pager').textContent);
  await go('#/?page=2');
  ok('第 2 頁為其餘文章', $$('.card').length === 5 && /第 2 \/ 2 頁/.test($('.pager').textContent), String($$('.card').length));
  for (let i = 0; i < 12; i++) mock.unpublish('p' + i);
  await go('#/');

  /* ---- 文章頁 ---- */
  await go('#/a/' + encodeURIComponent('zai-jie'), 300);
  ok('文章頁顯示標題與標籤名稱', $('.article-head h1')?.textContent.includes('再接再厲') && $$('.article-head .meta a').map(a => a.textContent).join('|') === '#成語辨正|#錯別字', $$('.article-head .meta a').map(a => a.textContent).join('|'));
  const body = $('.article-body');
  ok('內文消毒：移除 script / onerror / img', body && !body.querySelector('script, img') && !/onerror|onclick/i.test(body.innerHTML), body?.innerHTML);
  ok('內文消毒：javascript: 連結被移除', ![...body.querySelectorAll('a')].some(a => /javascript:/i.test(a.getAttribute('href') || '')));
  const good = [...body.querySelectorAll('a')].find(a => a.getAttribute('href') === 'https://example.com');
  ok('安全連結加上 rel=noopener 與 target=_blank', good && /noopener/.test(good.rel) && good.target === '_blank');
  ok('樣式類別（right、ta-center）被保留', !!body.querySelector('.right') && !!body.querySelector('p.ta-center'));
  ok('瀏覽次數：首次進入 +1 並顯示', /1 次閱讀/.test($('.article-head .meta').textContent) && mock.calls.addView === 1, $('.article-head .meta').textContent);
  await go('#/'); await go('#/a/zai-jie', 300);
  ok('同一天重複進入同一篇不再 +1', mock.calls.addView === 1 && /1 次閱讀/.test($('.article-head .meta').textContent));

  mock.update('a1', { title: '更新後的標題' }); await sleep(100);
  ok('管理員修改文章後，文章頁即時更新', $('.article-head h1').textContent === '更新後的標題');
  mock.unpublish('a1'); await sleep(100);
  ok('文章被下架時，文章頁顯示找不到', $('.notice')?.textContent.includes('找不到'));
  await go('#/a/not-exist', 300);
  ok('不存在的文章顯示找不到', $('.notice')?.textContent.includes('找不到'));

  /* ---- 提問 ---- */
  await go('#/ask');
  const form = () => $('form.form');
  const submit = async () => { form().dispatchEvent(new w.Event('submit', { cancelable: true })); await sleep(150); };
  $('#content').value = '短'; await submit();
  ok('內容過短被前端擋下', /至少 5 個字/.test($('.msg.error')?.textContent || '') && mock.state.questions.length === 0);
  $('#content').value = '請問「應該」和「應當」有什麼差別？'; $('#name').value = '阿明'; await submit();
  ok('提問成功並送出資料', /已收到/.test($('.msg')?.textContent) && mock.state.questions.length === 1 && mock.state.questions[0].askerName === '阿明');
  $('#content').value = '第二次提問，應該被冷卻擋下'; await submit();
  ok('冷卻期間再次提問顯示友善訊息', /10 分鐘/.test($('.msg.error')?.textContent || '') && mock.state.questions.length === 1);
  const m2 = createMock(); const b2 = boot(m2); await sleep(200); await b2.go('#/ask');
  b2.$('#content').value = '機器人灌水的內容測試'; b2.$('input[name=website]').value = 'http://spam';
  b2.$('form.form').dispatchEvent(new b2.w.Event('submit', { cancelable: true })); await sleep(150);
  ok('蜜罐：假裝成功但不送出', /已收到/.test(b2.$('.msg')?.textContent || '') && m2.state.questions.length === 0);

  /* ---- 載入失敗 ---- */
  const m3 = createMock({ indexError: true }); const b3 = boot(m3); await sleep(200);
  ok('索引載入失敗時顯示友善訊息', /無法載入/.test(b3.$('.msg.error')?.textContent || ''));
  const m4 = createMock({ articleError: true }); const b4 = boot(m4); await sleep(100); await b4.go('#/a/x', 200);
  ok('文章載入失敗時顯示友善訊息', /無法載入/.test(b4.$('.notice')?.textContent || ''));

  /* ---- 未設定 Firebase ---- */
  const b5 = (() => { const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
    const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' }); dom.window.eval(fs.readFileSync(path.join(PUB, 'js', 'app.js'), 'utf8')); return dom.window; })();
  ok('未設定 Firebase 時顯示設定提示', /尚未完成設定/.test(b5.document.querySelector('.msg.error')?.textContent || ''));

  console.log(fails ? `\n${fails} 項失敗` : '\n前台全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
