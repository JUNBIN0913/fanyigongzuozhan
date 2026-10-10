(() => {
  'use strict';
  const app = document.getElementById('app');
  const SITE = '語文辨正';
  const TZ = 'Asia/Taipei';
  const PAGE_SIZE = 10;
  const Data = window.YuwenData;

  /* ---------- 工具 ---------- */
  // 所有動態文字一律走 textContent；唯一例外是文章內文，會先經 DOMPurify 消毒
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 隱私模式等情況忽略 */ } },
  };
  const fmtDate = ms => ms ? new Date(ms).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }) : '';
  const dayKey = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ }).replace(/-/g, '');

  // 文章內文消毒（與編輯器允許的標籤一致）
  const ALLOWED_TAGS = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote', 'ul', 'ol', 'li', 'hr',
    'span', 'a', 'ruby', 'rt', 'rp', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'mark'];
  function sanitizeArticle(html) {
    if (!window.DOMPurify) return ''; // 消毒器載入失敗時寧可不顯示，也不輸出未消毒內容
    return window.DOMPurify.sanitize(String(html || ''), {
      ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'title', 'class', 'lang', 'target', 'rel'],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    });
  }
  if (window.DOMPurify) {
    window.DOMPurify.addHook('afterSanitizeAttributes', n => {
      if (n.tagName === 'A') { n.setAttribute('rel', 'noopener noreferrer'); n.setAttribute('target', '_blank'); }
    });
  }

  /* ---------- 字級縮放 ---------- */
  const SCALES = [0.875, 1, 1.125, 1.25, 1.5, 1.75];
  const saved = store.get('fontScaleIdx');
  let si = saved === null ? 1 : Number(saved); // 注意：Number(null) 為 0，必須先排除未儲存的情況
  if (!Number.isInteger(si) || si < 0 || si >= SCALES.length) si = 1;
  function applyScale() {
    document.documentElement.style.setProperty('--scale', SCALES[si]);
    document.getElementById('fs-reset').textContent = Math.round(SCALES[si] * 100) + '%';
    document.getElementById('fs-down').disabled = si === 0;
    document.getElementById('fs-up').disabled = si === SCALES.length - 1;
    store.set('fontScaleIdx', String(si));
  }
  document.getElementById('fs-down').addEventListener('click', () => { if (si > 0) { si--; applyScale(); } });
  document.getElementById('fs-up').addEventListener('click', () => { if (si < SCALES.length - 1) { si++; applyScale(); } });
  document.getElementById('fs-reset').addEventListener('click', () => { si = 1; applyScale(); });
  applyScale();

  if (!Data) {
    app.replaceChildren(el('div', { class: 'msg error' }, '網站尚未完成設定：' + (window.YuwenDataError?.message || '資料服務未載入')));
    return;
  }

  /* ---------- 索引（即時）：整站共用同一個訂閱 ---------- */
  let index = null;       // { tags: [{id,name,slug,count}], items: [...], tagById: Map } ；尚未載入時為 null
  let indexError = null;
  let onIndexChange = null;

  function buildIndex(raw) {
    const items = Object.entries(raw.items || {}).map(([id, it]) => ({ id, ...it, tagIds: it.tagIds || [] }))
      .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    const counts = new Map();
    for (const it of items) for (const t of it.tagIds) counts.set(t, (counts.get(t) || 0) + 1);
    const tags = Object.entries(raw.tags || {}).map(([id, t]) => ({ id, name: t.name, slug: t.slug, count: counts.get(id) || 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    return { items, tags, tagById: new Map(tags.map(t => [t.id, t])) };
  }
  Data.subscribeIndex(raw => { index = buildIndex(raw); indexError = null; onIndexChange && onIndexChange(); },
    err => { indexError = err; onIndexChange && onIndexChange(); });

  /* ---------- 路由 ---------- */
  let cleanup = null;
  let homeUI = null;

  function setNav(name) {
    document.querySelectorAll('.nav a').forEach(a => {
      const on = (name === 'home' && a.getAttribute('href') === '#/') || (name === 'ask' && a.getAttribute('href') === '#/ask');
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });
  }

  function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    onIndexChange = null;
    const h = location.hash.slice(1) || '/';
    const [path, qs] = h.split('?');
    const params = new URLSearchParams(qs || '');
    if (path.startsWith('/a/')) { homeUI = null; return showArticle(decodeURIComponent(path.slice(3))); }
    if (path === '/ask') { homeUI = null; return showAsk(); }
    return showHome(params);
  }

  function homeHash({ q, tag, page }) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (tag) p.set('tag', tag);
    if (page && page > 1) p.set('page', page);
    const s = p.toString();
    return '#/' + (s ? '?' + s : '');
  }

  /* ---------- 首頁 ---------- */
  function buildHome() {
    const input = el('input', { type: 'search', id: 'q', placeholder: '搜尋關鍵字，例如「再接再厲」', 'aria-label': '搜尋文章', maxlength: 60, autocomplete: 'off' });
    const form = el('form', { class: 'search', role: 'search' }, input, el('button', { class: 'btn', type: 'submit' }, '搜尋'));
    const chips = el('div', { class: 'chips', 'aria-label': '標籤' });
    const list = el('ul', { class: 'list' });
    const pager = el('div', { class: 'pager' });
    const status = el('div', { 'aria-live': 'polite' });
    app.replaceChildren(el('h1', { class: 'page-title' }, '最新文章'), form, chips, status, list, pager);
    let timer;
    const go = () => { location.hash = homeHash({ q: input.value.trim(), tag: homeUI.state.tag }); };
    form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); go(); });
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(go, 450); });
    return { input, chips, list, pager, status, state: { q: '', tag: '', page: 1 } };
  }

  function showHome(params) {
    setNav('home');
    document.title = SITE;
    if (!homeUI || !app.contains(homeUI.list)) homeUI = buildHome();
    const ui = homeUI;
    ui.state = { q: (params.get('q') || '').slice(0, 60), tag: params.get('tag') || '', page: Math.max(1, parseInt(params.get('page'), 10) || 1) };
    if (document.activeElement !== ui.input) ui.input.value = ui.state.q;
    const render = () => renderHome(ui);
    onIndexChange = render;
    render();
  }

  function filterItems(ix, { q, tag }) {
    let items = ix.items;
    if (tag) {
      const t = ix.tags.find(x => x.slug === tag);
      items = t ? items.filter(it => it.tagIds.includes(t.id)) : [];
    }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      items = items.filter(it => {
        const hay = [it.title, it.summary, it.excerpt, ...it.tagIds.map(id => ix.tagById.get(id)?.name || '')].join('\n').toLowerCase();
        return terms.every(t => hay.includes(t));
      });
    }
    return items;
  }

  function renderHome(ui) {
    const s = ui.state;
    if (!index) {
      ui.chips.replaceChildren(); ui.list.replaceChildren(); ui.pager.replaceChildren();
      ui.status.replaceChildren(indexError
        ? el('div', { class: 'msg error' }, '目前無法載入內容，請稍後再試。')
        : el('div', { class: 'empty' }, '載入中…'));
      return;
    }
    ui.status.replaceChildren();
    const mk = (label, slug, count) => el('a', { class: 'chip', href: homeHash({ q: s.q, tag: slug }), 'aria-pressed': String(s.tag === slug) },
      label, count != null ? el('small', {}, count) : null);
    ui.chips.replaceChildren(mk('全部', ''), ...index.tags.filter(t => t.count > 0).map(t => mk(t.name, t.slug, t.count)));

    const items = filterItems(index, s);
    if (!items.length) {
      ui.list.replaceChildren(el('li', { class: 'empty' }, s.q || s.tag ? '找不到符合的文章。' : '目前還沒有文章。'));
      ui.pager.replaceChildren();
      return;
    }
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.min(s.page, pages);
    ui.list.replaceChildren(...items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(a => el('li', { class: 'card' },
      el('h2', {}, el('a', { href: '#/a/' + encodeURIComponent(a.slug) }, a.title)),
      a.summary ? el('p', {}, a.summary) : null,
      el('div', { class: 'meta' },
        el('span', {}, fmtDate(a.publishedAt)),
        ...index.tags.filter(t => a.tagIds.includes(t.id)).map(t => el('a', { href: homeHash({ tag: t.slug }) }, '#' + t.name)),
      ))));
    ui.pager.replaceChildren(
      page > 1 ? el('a', { class: 'btn ghost', href: homeHash({ ...s, page: page - 1 }) }, '上一頁') : el('span'),
      el('span', { class: 'muted' }, `第 ${page} / ${pages} 頁，共 ${items.length} 篇`),
      page < pages ? el('a', { class: 'btn ghost', href: homeHash({ ...s, page: page + 1 }) }, '下一頁') : el('span'),
    );
  }

  /* ---------- 文章內頁 ---------- */
  function showArticle(slug) {
    setNav('');
    const holder = el('article');
    app.replaceChildren(el('a', { class: 'back', href: '#/' }, '← 回文章列表'), holder);
    window.scrollTo(0, 0);

    let art = null, loaded = false, loadError = null, views = null, tracked = false;

    function render() {
      if (loadError) { holder.replaceChildren(el('div', { class: 'notice' }, '目前無法載入這篇文章，請稍後再試。')); return; }
      if (!loaded) { holder.replaceChildren(el('div', { class: 'notice' }, '載入中…')); return; }
      if (!art) { document.title = SITE; holder.replaceChildren(el('div', { class: 'notice' }, '找不到這篇文章，可能已被移除。')); return; }
      document.title = `${art.title}｜${SITE}`;
      const body = el('div', { class: 'article-body' });
      body.innerHTML = sanitizeArticle(art.bodyHtml);
      const tags = index ? index.tags.filter(t => (art.tagIds || []).includes(t.id)) : []; // 與首頁相同的排序
      holder.replaceChildren(
        el('header', { class: 'article-head' },
          el('h1', {}, art.title),
          el('div', { class: 'meta' },
            el('span', {}, '發布：' + fmtDate(art.publishedAt)),
            el('span', {}, '更新：' + fmtDate(art.updatedAt)),
            views != null ? el('span', {}, `${views} 次閱讀`) : null,
            ...tags.map(t => el('a', { href: homeHash({ tag: t.slug }) }, '#' + t.name)))),
        body);
    }

    async function trackView(id) {
      try { views = await Data.getViews(id); render(); } catch { /* 瀏覽數取不到就不顯示 */ }
      const key = `view:${id}:${dayKey()}`; // 同一瀏覽器同一天同一篇只計一次（僅供參考的軟性去重）
      if (store.get(key)) return;
      store.set(key, '1');
      try { await Data.addView(id); views = (views || 0) + 1; render(); } catch { /* 忽略 */ }
    }

    const unsub = Data.subscribeArticle(slug, a => {
      loaded = true; loadError = null; art = a; render();
      if (a && !tracked) { tracked = true; trackView(a.id); }
    }, () => { loadError = true; render(); });
    cleanup = unsub;
    onIndexChange = render; // 標籤名稱來自索引，索引更新時一併重繪
    render();
  }

  /* ---------- 提問 ---------- */
  function showAsk() {
    setNav('ask');
    document.title = `我要提問｜${SITE}`;
    const msg = el('div', { 'aria-live': 'polite' });
    const content = el('textarea', { id: 'content', required: true, minlength: 5, maxlength: 1000, placeholder: '請描述你遇到的語文問題…' });
    const name = el('input', { id: 'name', maxlength: 40, autocomplete: 'nickname' });
    const contact = el('input', { id: 'contact', maxlength: 100, autocomplete: 'email', placeholder: '若希望收到回覆通知，可留 Email（選填）' });
    const hp = el('input', { type: 'text', name: 'website', tabindex: -1, autocomplete: 'off' }); // 蜜罐
    const btn = el('button', { class: 'btn', type: 'submit' }, '送出提問');
    const form = el('form', { class: 'form' },
      el('div', { class: 'field' }, el('label', { for: 'content' }, '你的問題'), content),
      el('div', { class: 'field' }, el('label', { for: 'name' }, '稱呼（選填）'), name),
      el('div', { class: 'field' }, el('label', { for: 'contact' }, '聯絡方式（選填）'), contact),
      el('div', { class: 'hp', 'aria-hidden': 'true' }, hp),
      btn, msg);
    const ok = () => msg.replaceChildren(el('div', { class: 'msg' }, '已收到你的提問，審核回覆後可能整理成公開文章，謝謝！'));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const text = content.value.trim();
      if (text.length < 5) return msg.replaceChildren(el('div', { class: 'msg error' }, '問題內容至少 5 個字。'));
      if (hp.value) { form.reset(); return ok(); } // 機器人：假裝成功，但不送出
      btn.disabled = true;
      try {
        await Data.submitQuestion({ content: text, askerName: name.value.trim().slice(0, 40), contact: contact.value.trim().slice(0, 100) });
        form.reset(); ok();
      } catch (err) {
        msg.replaceChildren(el('div', { class: 'msg error' }, err.code === 'cooldown'
          ? '提問太頻繁，或目前暫時無法送出，請約 10 分鐘後再試。'
          : '送出失敗，請稍後再試。'));
      } finally { btn.disabled = false; }
    });
    app.replaceChildren(
      el('h1', { class: 'page-title' }, '我要提問'),
      el('p', { class: 'muted' }, '提問會先由管理員審閱，不會直接公開。請勿填寫過於私人的資料。'),
      form);
  }

  /* ---------- 啟動 ---------- */
  window.addEventListener('hashchange', route);
  route();
  const today = dayKey();
  if (!store.get('visit:' + today)) { store.set('visit:' + today, '1'); Promise.resolve(Data.recordVisit(today)).catch(() => {}); }
})();
