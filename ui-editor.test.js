// Ribbon 編輯器介面測試：真正的 admin-adapter + 記憶體版假 Firestore + jsdom。
// jsdom 不支援 document.execCommand，因此以替身記錄指令；實際排版效果需在真瀏覽器確認。
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
  w.__FAKE = { users: [{ uid: 'admin1', email: 'a@x.com', password: 'pw12345678' }] };
  w.eval(purify); w.eval(bundle);
  const F = w.__FAKE, A = w.YuwenAdmin, TS = F.Timestamp;
  F.fs.docs.set('admins/admin1', { createdAt: new TS(1) });
  const calls = [];
  w.document.execCommand = (c, u, v) => { calls.push([c, v]); return true; };

  w.eval(fs.readFileSync(path.join(ADMIN, 'js', 'common.js'), 'utf8'));
  w.Admin.autosaveMs = 800; // 縮短自動暫存間隔以便測試
  w.Admin.goLogin = () => {};
  for (const f of ['view-dashboard', 'view-articles', 'view-tags', 'view-questions', 'view-editor', 'main']) w.eval(fs.readFileSync(path.join(ADMIN, 'js', f + '.js'), 'utf8'));

  const docs = F.fs.docs;
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const go = async (h, ms = 300) => { w.location.hash = h; await sleep(ms); };
  const input = (n, v) => { if (v !== undefined) { if (n.tagName === 'DIV') n.innerHTML = v; else n.value = v; } n.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const btn = t => $$('button,a.btn').find(b => b.textContent.trim() === t);
  const dlgBtn = t => $$('dialog button').find(b => b.textContent.trim() === t);
  const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); } return false; };
  const idx = () => docs.get('meta/index') || { tags: {}, items: {} };

  await A.signIn('a@x.com', 'pw12345678'); await sleep(300);
  const stamp = Date.now().toString(36);
  const tg = await A.addTag(`編輯測試${stamp}`);

  /* ---- 網址檢查與找不到 ---- */
  await go('#/editor/bad.id');
  ok('網址含不合法字元時顯示錯誤', /網址錯誤/.test($('#view').textContent));
  await go('#/editor/doesnotexist');
  ok('文章不存在時顯示找不到', /找不到這篇文章/.test($('#view').textContent));

  /* ---- 新文章：殘留暫存 → 捨棄 ---- */
  await A.saveDraft(null, { title: '殘留草稿', bodyHtml: '<p>殘留</p>' });
  await go('#/editor/new', 500);
  ok('新文章有殘留暫存時詢問是否還原', /找到自動暫存的草稿/.test($('dialog')?.textContent || ''));
  dlgBtn('捨棄暫存').click(); await sleep(300);
  ok('捨棄後暫存被清除', !docs.get('drafts/admin1_new'));
  await go('#/articles'); await go('#/editor/new', 400);

  /* ---- 版面結構 ---- */
  ok('Ribbon 三個頁籤（文字格式／插入與標籤／版面設定）', $$('.rtab').map(b => b.textContent).join('|') === '文字格式|插入與標籤|版面設定');
  ok('灰底工作區＋白色紙張＋可編輯內文', !!$('.paper-scroll .paper') && $('.paper .body').getAttribute('contenteditable') === 'true' && $('#view').className.includes('editor-ws'));
  ok('狀態列顯示字數與縮放', /字數：0/.test($('.statusbar').textContent) && !!$('.statusbar input[type=range]'));

  /* ---- 自動暫存 ---- */
  input($('.doc-title'), `「再接再厲」別寫成「再接再勵」${stamp}`);
  input($('.doc-sum'), '常見成語錯字');
  input($('.paper .body'), '<p>正確是<span class="right">再接再厲</span>。</p><p>另有 <b>粗體</b></p>');
  ok('輸入後字數更新、顯示尚未儲存', /字數：1[0-9]/.test($('.statusbar').textContent) && /尚未儲存|有尚未/.test($('.statusbar').textContent), $('.statusbar').textContent);
  ok('自動暫存：新文章草稿寫入（drafts/{uid}_new）', await until(() => docs.get('drafts/admin1_new')?.bodyHtml.includes('再接再厲')));
  ok('狀態列顯示已自動暫存', await until(() => /已自動暫存/.test($('.statusbar').textContent)));

  /* ---- 儲存 ---- */
  btn('儲存').click();
  ok('儲存後網址改為 #/editor/<id>，狀態列顯示已儲存', await until(() => /#\/editor\/\w+/.test(w.location.hash) && /已儲存/.test($('.statusbar').textContent)), w.location.hash);
  const id = w.location.hash.split('/').pop();
  const art = docs.get('articles/' + id);
  ok('文章寫入：草稿、摘要、內文、伺服器時間', art && art.status === 'draft' && art.summary === '常見成語錯字' && art.bodyHtml.includes('class="right"') && art.createdAt instanceof TS);
  ok('新文章暫存於儲存後被清除', !docs.get('drafts/admin1_new'));

  /* ---- 自動暫存與儲存同時發生：不應留下孤兒暫存 ---- */
  await go('#/articles'); await go('#/editor/new', 400);
  const origSave = A.saveDraft; let started = 0;
  A.saveDraft = async (...a) => { started++; await sleep(400); return origSave(...a); };
  input($('.doc-title'), `競態測試${stamp}`); input($('.paper .body'), '<p>競態內容</p>');
  ok('自動暫存開始傳送', await until(() => started >= 1));
  btn('儲存').click();
  await sleep(1500);
  A.saveDraft = origSave;
  const raceArt = [...docs.entries()].find(([p, d]) => p.startsWith('articles/') && d.title === `競態測試${stamp}`);
  ok('儲存成功', !!raceArt);
  ok('傳送中的暫存不會在文章建立後才落地，留下孤兒 drafts/{uid}_new', !docs.get('drafts/admin1_new'), JSON.stringify(docs.get('drafts/admin1_new')));

  /* ---- 重新開啟、標籤、插入標籤標記 ---- */
  await go('#/articles'); await go('#/editor/' + id, 400);
  ok('離開再進入：標題與內文載回', $('.doc-title').value.includes('再接再厲') && $('.paper .body').innerHTML.includes('class="right"'));
  $$('.rtab')[1].click();
  const chip = $$('.tchip').find(c => c.textContent === tg.name);
  ok('標籤頁籤列出標籤', !!chip);
  chip.click();
  ok('點選後標籤為已套用', chip.getAttribute('aria-pressed') === 'true');
  const ins = $('select[aria-label="插入標籤標記"]'); ins.value = tg.name; ins.dispatchEvent(new w.Event('change'));
  ok('插入標籤標記呼叫 insertHTML 且含 tag-chip', calls.some(c => c[0] === 'insertHTML' && /tag-chip/.test(c[1]) && c[1].includes(tg.name)));
  const ext = await A.addTag(`外部新增${stamp}`); await sleep(200);
  ok('其他頁面新增標籤：選項即時出現，不重載編輯內容', !!$$('.tchip').find(c => c.textContent === ext.name) && $('.doc-title').value.includes('再接再厲'));
  $('input[aria-label="新增標籤"]').value = `快速新增${stamp}`;
  btn('＋ 新增').click(); await sleep(400);
  const qn = Object.entries(idx().tags).find(([, t]) => t.name === `快速新增${stamp}`);
  ok('快速新增標籤：寫入索引並自動套用', !!qn && $$('.tchip').find(c => c.textContent === `快速新增${stamp}`)?.getAttribute('aria-pressed') === 'true');
  await A.deleteTag(ext.id); await sleep(200);
  ok('標籤被刪除後選項即時消失', !$$('.tchip').find(c => c.textContent === ext.name));

  /* ---- 儲存時消毒、Ctrl+S ---- */
  input($('.paper .body'), '<p>安全內容</p><img src=x onerror=alert(1)><script>alert(1)</script>');
  btn('儲存').click(); await sleep(500);
  const saved = docs.get('articles/' + id);
  ok('儲存時標籤寫入', saved.tagIds.includes(tg.id) && saved.tagIds.includes(qn[0]));
  ok('儲存時惡意內容被消毒', saved.bodyHtml.includes('安全內容') && !/script|onerror|<img/i.test(saved.bodyHtml), saved.bodyHtml);
  input($('.doc-sum'), '常見成語錯字（修訂）');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); await sleep(500);
  ok('Ctrl+S 可儲存', docs.get('articles/' + id).summary.includes('修訂'));

  /* ---- 發布／已發布時修改／下架 ---- */
  ok('草稿狀態不顯示「檢視前台」', $$('a.btn').find(b => b.textContent === '檢視前台')?.hidden === true);
  btn('發布').click(); await sleep(700);
  const slug = docs.get('articles/' + id).slug;
  ok('發布後徽章為已發布、按鈕變下架、前台索引有此文章', $('.state-pill').textContent === '已發布' && !!btn('下架') && !!idx().items[id]);
  const vl = $$('a.btn').find(b => b.textContent === '檢視前台');
  ok('已發布時顯示「檢視前台」連結（含 slug）', vl && !vl.hidden && vl.getAttribute('href') === '../index.html#/a/' + encodeURIComponent(slug), vl?.getAttribute('href'));
  input($('.doc-title'), '已發布後改過的標題'); btn('儲存').click(); await sleep(600);
  ok('已發布文章修改：網址不變、索引標題同步', docs.get('articles/' + id).slug === slug && idx().items[id].title === '已發布後改過的標題');
  btn('下架').click(); await sleep(700);
  ok('下架：回草稿、移出索引、按鈕變發布', $('.state-pill').textContent === '草稿' && !idx().items[id] && !!btn('發布'));

  /* ---- 草稿還原 ---- */
  await sleep(900);
  input($('.paper .body'), '<p>安全內容</p><p>未儲存的新段落</p>');
  ok('編輯後自動暫存到 drafts/{uid}_{id}', await until(() => docs.get('drafts/admin1_' + id)?.bodyHtml.includes('未儲存的新段落')));
  await go('#/articles'); await go('#/editor/' + id, 800);
  ok('離開再回來：出現還原對話框', /找到自動暫存的草稿/.test($('dialog')?.textContent || ''), $('dialog')?.textContent);
  dlgBtn('還原草稿').click(); await sleep(400);
  ok('還原後內文含暫存內容，並標示尚未儲存', $('.paper .body').textContent.includes('未儲存的新段落') && /尚未儲存|還原/.test($('.statusbar').textContent));
  await go('#/articles'); await go('#/editor/' + id, 800);
  dlgBtn('使用已儲存版本').click(); await sleep(400);
  ok('選擇「使用已儲存版本」會捨棄暫存', !docs.get('drafts/admin1_' + id) && !$('.paper .body').textContent.includes('未儲存的新段落'));

  /* ---- 快速離開：不應在其他頁面彈出對話框 ---- */
  await A.saveDraft(id, { title: '較新的暫存', bodyHtml: '<p>較新</p>' });
  const origGet = A.getDraft;
  A.getDraft = async (...a) => { await sleep(500); return origGet(...a); };
  await go('#/articles', 200); // 先離開，下一步才會真的重新掛載編輯器（網址相同不會觸發換頁）
  w.location.hash = '#/editor/' + id; await sleep(200);   // 編輯器已載入，草稿查詢還在途中
  w.location.hash = '#/articles'; await sleep(1200);      // 離開後，查詢才回來
  A.getDraft = origGet;
  ok('草稿查詢回來前就離開：不會在其他頁面彈出對話框', $$('dialog').length === 0, $$('dialog').map(d => d.textContent.slice(0, 20)).join('|'));
  await A.deleteDraft(id);

  /* ---- 離開時補存暫存 ---- */
  await go('#/editor/' + id, 500);
  input($('.paper .body'), '<p>離開前才輸入的內容</p>');
  await go('#/articles', 400);
  ok('離開編輯器時補存一次暫存', docs.get('drafts/admin1_' + id)?.bodyHtml.includes('離開前才輸入的內容'));
  await A.deleteDraft(id);

  /* ---- Ribbon 指令與版面 ---- */
  await go('#/editor/' + id, 500);
  calls.length = 0;
  $$('.rtab')[0].click();
  [...$$('.rb')].find(b => b.title.startsWith('粗體')).click();
  ok('B 按鈕 → execCommand("bold")', calls.some(c => c[0] === 'bold'));
  const bs = $('select[aria-label="段落樣式"]'); bs.value = 'h2'; bs.dispatchEvent(new w.Event('change'));
  ok('段落樣式 → formatBlock <h2>', calls.some(c => c[0] === 'formatBlock' && c[1] === '<h2>'));
  [...$$('.rb')].find(b => b.title.startsWith('復原')).click();
  ok('復原 → execCommand("undo")', calls.some(c => c[0] === 'undo'));
  $$('.rtab')[2].click();
  const wsel = $('select[aria-label="紙張寬度"]'); wsel.value = '26'; wsel.dispatchEvent(new w.Event('change'));
  ok('紙張寬度變更套用並寫入 localStorage', $('.paper').style.getPropertyValue('--paper-w') === '26' && JSON.parse(w.localStorage.getItem('editorLayout')).width === 26);
  const zr = $('.statusbar input[type=range]'); zr.value = '150'; zr.dispatchEvent(new w.Event('input'));
  ok('縮放滑桿顯示 150%', /150%/.test($('.statusbar').textContent));

  /* ---- 離開清理 ---- */
  await go('#/articles');
  ok('離開編輯器後 Ribbon／狀態列清除，工作區樣式還原', $('#ribbon-slot').children.length === 0 && $('#status-slot').children.length === 0 && $('#view').className === 'workspace');

  console.log(fails ? `\n${fails} 項失敗` : '\n編輯器全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
