(() => {
  'use strict';
  const { el, data, toast, dialog, escapeHtml, errMsg } = Admin;

  const KAI = '"LXGW WenKai TC","DFKai-SB","BiauKai","標楷體","Kaiti TC","楷體-繁","STKaiti","KaiTi","AR PL UKai TW","Noto Serif CJK TC",serif';
  const HEI = '"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC",sans-serif';
  const DEF = { width: 21, pad: 2.5, lh: 1.9, size: 17, zoom: 100, font: 'kai' };
  const clamp = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };

  function loadLayout() {
    let o = {};
    try { o = JSON.parse(localStorage.getItem('editorLayout') || '{}'); } catch { /* 忽略 */ }
    return { width: clamp(o.width, 12, 30, DEF.width), pad: clamp(o.pad, 1, 5, DEF.pad), lh: clamp(o.lh, 1.2, 3, DEF.lh),
      size: clamp(o.size, 12, 28, DEF.size), zoom: clamp(o.zoom, 50, 200, DEF.zoom), font: o.font === 'hei' ? 'hei' : 'kai' };
  }
  const saveLayout = L => { try { localStorage.setItem('editorLayout', JSON.stringify(L)); } catch { /* 忽略 */ } };
  const pad2 = n => String(n).padStart(2, '0');
  const clock = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

  Admin.views.editor = {
    async mount(root, arg) {
      const isNew = arg === 'new';
      const fail = (msg, withLink = true) => { root.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'panel' }, msg, withLink ? [' ', el('a', { href: '#/articles' }, '回文章列表')] : null))); return {}; };
      if (!isNew && !/^[A-Za-z0-9_-]{1,64}$/.test(arg || '')) return fail('網址錯誤');
      if (!window.DOMPurify) return fail('消毒元件（DOMPurify）未載入，為安全起見不開啟編輯器。', false);
      let art;
      try {
        art = isNew ? { title: '', summary: '', bodyHtml: '', status: 'draft', tagIds: [], updatedAt: null, slug: '' } : await data.getArticle(arg);
      } catch (e) { return fail(errMsg(e)); }
      if (!art) return fail('找不到這篇文章。');

      const state = {
        id: isNew ? null : arg, status: art.status, slug: art.slug, tagIds: new Set(art.tagIds),
        allTags: [], dirty: false, draftPending: false, saving: false, draftInFlight: null,
      };
      // 標籤清單即時訂閱（其他頁面改標籤時，這裡的選項會跟著更新，不動編輯中的內容）
      let tagUIReady = false;
      let unsubIdx = () => {};
      await new Promise(resolve => {
        unsubIdx = data.subscribeIndex(ix => {
          state.allTags = Object.entries(ix.tags).map(([id, t]) => ({ id, ...t })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
          for (const id of [...state.tagIds]) if (!ix.tags[id]) state.tagIds.delete(id);
          if (tagUIReady) renderTagUI();
          resolve();
        }, () => resolve());
      });
      const AUTOSAVE_MS = Admin.autosaveMs || 30000; // 半分鐘（測試時可覆寫）
      const L = loadLayout();

      /* ---------- 紙張 ---------- */
      const titleIn = el('input', { class: 'doc-title', type: 'text', maxlength: 120, placeholder: '文章標題', 'aria-label': '文章標題', value: art.title });
      const sumIn = el('textarea', { class: 'doc-sum', maxlength: 300, placeholder: '摘要（顯示在文章列表，最多 300 字）', 'aria-label': '摘要', rows: 2 });
      sumIn.value = art.summary || '';
      const bodyEl = el('div', { class: 'body', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '文章內文', 'data-placeholder': '在這裡開始撰寫…', spellcheck: 'false' });
      bodyEl.innerHTML = Admin.sanitize(art.bodyHtml); // 載入前一律先消毒
      const paper = el('div', { class: 'paper' }, titleIn, sumIn, bodyEl);
      root.className = 'workspace editor-ws';
      root.replaceChildren(el('div', { class: 'paper-scroll' }, paper));
      try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* 忽略 */ }

      /* ---------- 狀態列 ---------- */
      const sCount = el('span'); const sSave = el('span', { class: 'grow', 'aria-live': 'polite' }, '就緒');
      const zoomLbl = el('span');
      const zoomRange = el('input', { type: 'range', min: 50, max: 200, step: 10, 'aria-label': '縮放' });
      zoomRange.addEventListener('input', () => { L.zoom = Number(zoomRange.value); applyLayout(); });
      document.getElementById('status-slot').replaceChildren(el('div', { class: 'statusbar' }, sCount, sSave, zoomLbl, zoomRange));

      const isEmpty = () => !bodyEl.textContent.trim() && !bodyEl.querySelector('img,table,hr');
      function refreshMeta() {
        bodyEl.dataset.empty = isEmpty() ? '1' : '0';
        sCount.textContent = `字數：${bodyEl.textContent.replace(/\s/g, '').length}`;
      }
      const setStatus = t => { sSave.textContent = t; };
      function markDirty() {
        state.dirty = true; state.draftPending = true;
        refreshMeta(); setStatus('有尚未儲存的變更');
      }
      for (const n of [titleIn, sumIn, bodyEl]) n.addEventListener('input', markDirty);
      titleIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sumIn.focus(); } });
      bodyEl.addEventListener('paste', e => { // 一律以純文字貼上，避免 Word／網頁的雜亂格式
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
        document.execCommand('insertText', false, t);
      });
      bodyEl.addEventListener('drop', e => e.preventDefault());
      refreshMeta();

      /* ---------- 選取範圍保存（點工具列時編輯區會失焦） ---------- */
      let savedRange = null;
      const fmtBtns = [];
      let blockSel = null;
      function onSel() {
        const s = window.getSelection();
        if (!s || !s.rangeCount || !bodyEl.contains(s.anchorNode)) return;
        savedRange = s.getRangeAt(0).cloneRange();
        for (const [cmd, b] of fmtBtns) { let on = false; try { on = document.queryCommandState(cmd); } catch { /* 忽略 */ } b.setAttribute('aria-pressed', String(!!on)); }
        if (blockSel) { let v = ''; try { v = String(document.queryCommandValue('formatBlock') || '').replace(/[<>]/g, '').toLowerCase(); } catch { /* 忽略 */ }
          blockSel.value = [...blockSel.options].some(o => o.value === v) ? v : 'p'; }
      }
      document.addEventListener('selectionchange', onSel);
      function withBody(fn) {
        bodyEl.focus();
        if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
        fn(); markDirty(); onSel();
      }
      const exec = (c, v = null) => withBody(() => document.execCommand(c, false, v));

      function markSpan(cls) {
        withBody(() => {
          const sel = window.getSelection();
          if (!sel.rangeCount) return;
          const n = sel.anchorNode;
          const ex = (n.nodeType === 1 ? n : n.parentElement)?.closest('span.wrong, span.right');
          if (ex && bodyEl.contains(ex)) { ex.replaceWith(...ex.childNodes); return; } // 再按一次＝取消標註
          if (sel.isCollapsed) { toast('請先選取要標註的文字', true); return; }
          document.execCommand('insertHTML', false, `<span class="${cls}">${escapeHtml(sel.toString())}</span>`);
        });
      }
      async function insertLink() {
        const url = el('input', { type: 'text', placeholder: 'https://', 'aria-label': '連結網址' });
        await dialog({ title: '插入連結', body: el('div', { class: 'field' }, url), okText: '插入', onOk: async () => {
          const u = url.value.trim();
          if (!/^(https?:\/\/|mailto:)/i.test(u)) throw new Error('僅支援 http://、https:// 或 mailto: 連結');
          withBody(() => {
            const sel = window.getSelection();
            if (sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${escapeHtml(u)}">${escapeHtml(u)}</a>`);
            else document.execCommand('createLink', false, u);
          });
        } });
      }
      const insertTable = () => withBody(() => document.execCommand('insertHTML', false,
        '<table><thead><tr><th>錯誤寫法</th><th>正確寫法</th><th>說明</th></tr></thead><tbody>' +
        '<tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>'));

      /* ---------- Ribbon ---------- */
      const rb = (text, title, onClick, cls = '') => el('button', { class: 'rb ' + cls, type: 'button', title, 'aria-label': title, onclick: onClick }, text);
      const fmt = (cmd, text, title, cls) => { const b = rb(text, title, () => exec(cmd), cls); b.setAttribute('aria-pressed', 'false'); fmtBtns.push([cmd, b]); return b; };
      const group = (label, ...items) => el('div', { class: 'rgroup', role: 'group', 'aria-label': label }, el('div', { class: 'ritems' }, ...items), el('div', { class: 'glabel' }, label));
      const sel = (label, opts, cur, onChange) => {
        const s = el('select', { class: 'rsel', 'aria-label': label }, ...opts.map(([v, t]) => el('option', { value: v }, t)));
        s.value = String(cur); s.addEventListener('change', () => onChange(s.value)); return el('label', { class: 'rlabel' }, label, s);
      };

      blockSel = el('select', { class: 'rsel', 'aria-label': '段落樣式' },
        ...[['p', '內文'], ['h2', '標題 1'], ['h3', '標題 2'], ['h4', '標題 3'], ['blockquote', '引用']].map(([v, t]) => el('option', { value: v }, t)));
      blockSel.addEventListener('change', () => exec('formatBlock', '<' + blockSel.value + '>'));

      const panelText = el('div', { class: 'rpanel', role: 'tabpanel' },
        group('復原', rb('↶', '復原 (Ctrl+Z)', () => exec('undo')), rb('↷', '取消復原 (Ctrl+Y)', () => exec('redo'))),
        group('文字格式', fmt('bold', 'B', '粗體 (Ctrl+B)', 'b'), fmt('italic', 'I', '斜體 (Ctrl+I)', 'i'), fmt('underline', 'U', '底線 (Ctrl+U)', 'u'),
          fmt('strikeThrough', 'S', '刪除線', 's'), fmt('superscript', 'x²', '上標'), fmt('subscript', 'x₂', '下標')),
        group('語文標註', rb('錯', '標為錯誤寫法（紅色刪除線；再按一次取消）', () => markSpan('wrong'), 'wrongb'),
          rb('正', '標為正確寫法（綠色粗體；再按一次取消）', () => markSpan('right'), 'rightb')),
        group('段落', blockSel, fmt('insertUnorderedList', '• 清單', '項目符號清單'), fmt('insertOrderedList', '1. 清單', '編號清單'),
          rb('❝ 引用', '引用區塊', () => exec('formatBlock', '<blockquote>')), rb('清除格式', '清除所選文字格式', () => exec('removeFormat'))));

      const chipBox = el('div', { class: 'tagpick', 'aria-label': '此文章的標籤' });
      const newTag = el('input', { class: 'rin', type: 'text', maxlength: 30, placeholder: '新增標籤', 'aria-label': '新增標籤' });
      const insertSel = el('select', { class: 'rsel', 'aria-label': '插入標籤標記' });
      function renderTagUI() {
        chipBox.replaceChildren(...(state.allTags.length ? state.allTags.map(t => el('button', { class: 'tchip', type: 'button', 'data-tag': t.id,
          'aria-pressed': String(state.tagIds.has(t.id)), onclick: e => {
            state.tagIds.has(t.id) ? state.tagIds.delete(t.id) : state.tagIds.add(t.id);
            e.currentTarget.setAttribute('aria-pressed', String(state.tagIds.has(t.id))); markDirty();
          } }, t.name)) : [el('span', { class: 'muted' }, '尚無標籤，請於右側新增')]));
        insertSel.replaceChildren(el('option', { value: '' }, '插入標籤標記…'), ...state.allTags.map(t => el('option', { value: t.name }, t.name)));
      }
      insertSel.addEventListener('change', () => {
        const name = insertSel.value; insertSel.value = '';
        if (name) withBody(() => document.execCommand('insertHTML', false, `<span class="tag-chip">${escapeHtml(name)}</span>&nbsp;`));
      });
      async function quickAddTag() {
        const name = newTag.value.trim(); if (!name) return;
        try {
          const t = await data.addTag(name);
          if (!state.allTags.some(x => x.id === t.id)) state.allTags.push({ id: t.id, name: t.name, slug: t.slug });
          state.tagIds.add(t.id); newTag.value = ''; renderTagUI(); markDirty();
        } catch (e) { toast(errMsg(e), true); }
      }
      newTag.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quickAddTag(); } });

      const panelTags = el('div', { class: 'rpanel', role: 'tabpanel', hidden: true },
        group('文章標籤（點選套用）', chipBox),
        group('新增標籤', newTag, rb('＋ 新增', '新增標籤並套用', quickAddTag)),
        group('標籤標記', insertSel),
        group('插入', rb('🔗 連結', '插入連結', insertLink), rb('─ 分隔線', '插入分隔線', () => exec('insertHorizontalRule')), rb('▦ 對照表', '插入「錯誤／正確／說明」對照表', insertTable)));

      function applyLayout() {
        const s = paper.style;
        s.setProperty('--paper-w', L.width); s.setProperty('--paper-pad', L.pad); s.setProperty('--lh', L.lh); s.setProperty('--fs', L.size);
        s.setProperty('--font', L.font === 'hei' ? HEI : KAI); s.zoom = String(L.zoom / 100);
        zoomLbl.textContent = L.zoom + '%'; zoomRange.value = L.zoom; saveLayout(L);
      }
      const layoutSels = [];
      const mkSel = (label, opts, key, num = true) => { const w = sel(label, opts, L[key], v => { L[key] = num ? Number(v) : v; applyLayout(); }); layoutSels.push([key, w.querySelector('select')]); return w; };
      const panelLayout = el('div', { class: 'rpanel', role: 'tabpanel', hidden: true },
        group('紙張', mkSel('紙張寬度', [[16, '窄（16 cm）'], [21, 'A4（21 cm）'], [26, '寬（26 cm）']], 'width'),
          mkSel('邊界', [[1.5, '窄'], [2.5, '標準'], [3.5, '寬']], 'pad')),
        group('段落', mkSel('行距', [[1.5, '1.5'], [1.9, '1.9（預設）'], [2.2, '2.2'], [2.6, '2.6']], 'lh')),
        group('編輯區顯示', mkSel('預覽字級', [[14, '14'], [17, '17（預設）'], [20, '20'], [24, '24']], 'size'),
          mkSel('預覽字型', [['kai', '楷體'], ['hei', '黑體']], 'font', false)),
        group('重設', rb('還原預設版面', '還原預設版面', () => { Object.assign(L, DEF); layoutSels.forEach(([k, s]) => { s.value = String(L[k]); }); applyLayout(); })),
        el('div', { class: 'rgroup' }, el('div', { class: 'ritems muted' }, '版面設定只影響編輯畫面，不會改變文章內容。')));

      const tabs = [['文字格式', panelText], ['插入與標籤', panelTags], ['版面設定', panelLayout]];
      const tabBtns = tabs.map(([name, panel], i) => el('button', { class: 'rtab', type: 'button', role: 'tab', 'aria-selected': String(i === 0), onclick: () => {
        tabBtns.forEach((b, j) => b.setAttribute('aria-selected', String(i === j))); tabs.forEach(([, p], j) => { p.hidden = i !== j; });
      } }, name));

      const pill = el('span', { class: 'state-pill' });
      const pubBtn = el('button', { class: 'btn primary', type: 'button', onclick: togglePublish });
      const viewLink = el('a', { class: 'btn', target: '_blank', rel: 'noopener', hidden: true }, '檢視前台');
      function updateQat() {
        viewLink.hidden = !(state.status === 'published' && state.slug);
        if (state.slug) viewLink.href = '../index.html#/a/' + encodeURIComponent(state.slug);
        pill.textContent = state.status === 'published' ? '已發布' : '草稿';
        pill.className = 'state-pill' + (state.status === 'published' ? ' pub' : '');
        pubBtn.textContent = state.status === 'published' ? '下架' : '發布';
      }
      const qat = el('div', { class: 'qat' }, el('a', { class: 'btn', href: '#/articles' }, '← 文章列表'),
        el('button', { class: 'btn', type: 'button', title: '儲存 (Ctrl+S)', onclick: () => save() }, '儲存'), pubBtn, viewLink, pill);
      document.getElementById('ribbon-slot').replaceChildren(el('div', { class: 'ribbon', role: 'region', 'aria-label': '編輯工具列' },
        el('div', { class: 'rtabs', role: 'tablist' }, ...tabBtns, qat), panelText, panelTags, panelLayout));
      // 點工具列不奪走編輯區的選取範圍（下拉選單與輸入框除外）
      document.getElementById('ribbon-slot').addEventListener('mousedown', e => { if (!e.target.closest('input,select,textarea,option')) e.preventDefault(); });
      tagUIReady = true; renderTagUI(); applyLayout(); updateQat();

      /* ---------- 儲存／發布／草稿 ---------- */
      function getHtml() { // 整理成前台白名單允許的結構（div → p、strike → s、移除空段落）
        const c = bodyEl.cloneNode(true);
        c.querySelectorAll('div').forEach(d => { const p = document.createElement('p'); p.append(...d.childNodes); d.replaceWith(p); });
        c.querySelectorAll('strike').forEach(s => { const n = document.createElement('s'); n.append(...s.childNodes); s.replaceWith(n); });
        c.querySelectorAll('p').forEach(p => { if (!p.textContent.trim() && !p.querySelector('img,table,hr')) p.remove(); });
        return c.innerHTML.trim();
      }

      async function save() {
        if (state.saving) return false;
        if (!titleIn.value.trim()) { toast('請先輸入標題', true); titleIn.focus(); return false; }
        state.saving = true;
        try {
          // 若有「自動暫存」正在傳送，先等它完成，避免它在文章建立後才落地、留下孤兒草稿
          if (state.draftInFlight) await state.draftInFlight.catch(() => {});
          const id = await data.saveArticle({ id: state.id, title: titleIn.value, summary: sumIn.value, bodyHtml: getHtml(), tagIds: [...state.tagIds] });
          if (state.id == null) { state.id = id; history.replaceState(null, '', '#/editor/' + id); }
          const a = await data.getArticle(id);
          if (a) { state.slug = a.slug; state.status = a.status; }
          state.dirty = false; state.draftPending = false;
          setStatus(`已儲存 ${clock()}` + (state.status === 'published' ? '（文章已公開，內容已即時更新）' : ''));
          updateQat(); return true;
        } catch (e) { toast(errMsg(e), true); setStatus('儲存失敗'); return false; }
        finally { state.saving = false; }
      }

      async function togglePublish() {
        if (!(await save())) return;
        const publish = state.status !== 'published';
        try {
          await data.publishArticle(state.id, publish);
          state.status = publish ? 'published' : 'draft'; updateQat(); toast(publish ? '已發布' : '已下架為草稿');
          setStatus(publish ? `已發布 ${clock()}` : `已下架 ${clock()}`);
        } catch (e) { toast(errMsg(e), true); }
      }

      async function saveDraft(quiet = false) {
        state.draftPending = false;
        const p = data.saveDraft(state.id, { title: titleIn.value, bodyHtml: getHtml() });
        state.draftInFlight = p;
        try {
          await p;
          if (!quiet) setStatus(`已自動暫存草稿 ${clock()}` + (state.dirty ? '（尚未儲存為文章）' : ''));
        } catch { state.draftPending = true; if (!quiet) setStatus('自動暫存失敗，將於下次重試'); }
        finally { if (state.draftInFlight === p) state.draftInFlight = null; }
      }
      const timer = setInterval(() => { if (state.draftPending && !state.saving) saveDraft(); }, AUTOSAVE_MS);

      const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
      const onUnload = e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } };
      document.addEventListener('keydown', onKey);
      window.addEventListener('beforeunload', onUnload);

      // 還原較新的自動暫存草稿
      let gone = false; // 已離開編輯器（destroy 後）就不再彈出對話框
      (async () => {
        try {
          const d = await data.getDraft(isNew ? null : state.id);
          if (gone || !d || !(d.title || d.bodyHtml)) return;
          if (!isNew && ((d.savedAt && art.updatedAt && d.savedAt <= art.updatedAt) || (d.title === art.title && d.bodyHtml === art.bodyHtml))) return;
          const restore = await dialog({ title: '找到自動暫存的草稿',
            body: el('p', {}, `偵測到 ${Admin.fmtTime(d.savedAt)} 的自動暫存內容，要還原嗎？（選擇「${isNew ? '捨棄暫存' : '使用已儲存版本'}」會捨棄這份暫存。）`),
            okText: '還原草稿', cancelText: isNew ? '捨棄暫存' : '使用已儲存版本' });
          if (gone) return;
          if (restore) { titleIn.value = d.title; bodyEl.innerHTML = Admin.sanitize(d.bodyHtml); markDirty(); setStatus('已還原自動暫存草稿（尚未儲存）'); }
          else await data.deleteDraft(isNew ? null : state.id).catch(() => {});
        } catch { /* 無草稿或讀取失敗皆略過 */ }
      })();
      if (isNew) titleIn.focus();

      return {
        destroy() {
          gone = true;
          clearInterval(timer);
          unsubIdx();
          document.removeEventListener('selectionchange', onSel);
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('beforeunload', onUnload);
          if (state.draftPending && !state.saving) saveDraft(true); // 離開頁面前補存一次暫存
        },
      };
    },
  };
})();
