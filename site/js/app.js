// 前台介面（classic script）。資料一律透過 YuwenApp.start(api) 注入，介面本身不認識 Firebase。
(() => {
  'use strict';
  const SITE = '語文辨正', PAGE_SIZE = 10, COOLDOWN_MIN = 10;
  const app = document.getElementById('app');

  /* ---------- 工具 ---------- */
  // 所有動態文字一律走 textContent；唯一例外是經 DOMPurify 消毒的文章 HTML
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
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
  };
  const fmtDate = d => {
    if (!(d instanceof Date) || isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const norm = s => String(s || '').normalize('NFKC').toLowerCase();

  /* ---------- 文章 HTML 消毒（DOMPurify；與後台編輯器的白名單一致） ---------- */
  const ALLOWED_CLASSES = new Set(['right', 'wrong', 'tag-chip', 'ta-center', 'ta-right']);
  const SANITIZE_CFG = {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'hr',
      'span', 'a', 'ruby', 'rt', 'rp', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'mark'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'lang'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  };
  let hooked = false;
  function cleanHtml(html) {
    const P = window.DOMPurify;
    if (!P) return ''; // 找不到消毒器就寧可不顯示內容
    if (!hooked) {
      hooked = true;
      P.addHook('afterSanitizeAttributes', node => {
        if (node.hasAttribute && node.hasAttribute('class')) {
          const keep = node.getAttribute('class').split(/\s+/).filter(c => ALLOWED_CLASSES.has(c));
          keep.length ? node.setAttribute('class', keep.join(' ')) : node.removeAttribute('class');
        }
        if (node.tagName === 'A') { node.setAttribute('rel', 'noopener noreferrer'); node.setAttribute('target', '_blank'); }
      });
    }
    return P.sanitize(String(html || ''), SANITIZE_CFG);
  }

  /* ---------- 字級縮放（常駐） ---------- */
  const SCALES = [0.875, 1, 1.125, 1.25, 1.5, 1.75];
  const saved = store.get('fontScaleIdx');
  let si = saved === null ? 1 : Number(saved); // Number(null) 為 0，必須先排除未儲存的情況
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

  /* ---------- 狀態 ---------- */
  let api = null;
  let idx = { ready: false, tags: [], items: [], stamp: null };
  let current = { name: '', repaint: null, reload: null };   // 目前頁面：索引變動時重繪／重新載入
  let homeUI = null;

  function setNav(name) {
    document.querySelectorAll('.nav a').forEach(a => {
      const on = (name === 'home' && a.getAttribute('href') === '#/') || (name === 'ask' && a.getAttribute('href') === '#/ask');
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });
  }
  function homeHash({ q, tag, page }) {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (tag) p.set('tag', tag);
    if (page && page > 1) p.set('page', page);
    const s = p.toString();
    return '#/' + (s ? '?' + s : '');
  }
  const tagById = () => new Map(idx.tags.map(t => [t.id, t]));

  /* ---------- 路由 ---------- */
  function route() {
    const h = location.hash.slice(1) || '/';
    const [path, qs] = h.split('?');
    const params = new URLSearchParams(qs || '');
    if (path.startsWith('/a/')) { homeUI = null; return showArticle(decodeURIComponent(path.slice(3))); }
    if (path === '/ask') { homeUI = null; return showAsk(); }
    return showHome(params);
  }

  /* ---------- 首頁：搜尋、標籤、分頁（全在瀏覽器端，資料來自 1 份索引文件） ---------- */
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
    current = { name: 'home', repaint: () => paintHome(ui), reload: null };
    paintHome(ui);
  }

  function paintHome(ui) {
    if (homeUI !== ui) return;
    if (!idx.ready) { ui.status.replaceChildren(el('div', { class: 'notice' }, '載入中…')); return; }
    ui.status.replaceChildren();
    const s = ui.state, tags = tagById();

    const counts = new Map();
    for (const it of idx.items) for (const t of it.tagIds) counts.set(t, (counts.get(t) || 0) + 1);
    const chip = (label, slug, count) => el('a', { class: 'chip', href: homeHash({ q: s.q, tag: slug }), 'aria-pressed': String(s.tag === slug) },
      label, count != null ? el('small', {}, count) : null);
    ui.chips.replaceChildren(chip('全部', ''), ...idx.tags.filter(t => counts.get(t.id)).map(t => chip(t.name, t.slug, counts.get(t.id))));

    const q = norm(s.q);
    const hit = idx.items.filter(it => {
      const names = it.tagIds.map(id => tags.get(id)?.name || '');
      if (s.tag && !it.tagIds.some(id => tags.get(id)?.slug === s.tag)) return false;
      return !q || norm([it.title, it.summary, it.excerpt, ...names].join(' ')).includes(q);
    }).sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0));

    const pages = Math.max(1, Math.ceil(hit.length / PAGE_SIZE));
    const page = Math.min(s.page, pages);
    const rows = hit.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!rows.length) {
      ui.list.replaceChildren(el('li', { class: 'empty' }, s.q || s.tag ? '找不到符合的文章。' : '目前還沒有文章。'));
      ui.pager.replaceChildren();
      return;
    }
    ui.list.replaceChildren(...rows.map(a => el('li', { class: 'card' },
      el('h2', {}, el('a', { href: '#/a/' + encodeURIComponent(a.slug) }, a.title)),
      a.summary ? el('p', {}, a.summary) : null,
      el('div', { class: 'meta' }, el('span', {}, fmtDate(a.publishedAt)),
        ...a.tagIds.map(id => tags.get(id)).filter(Boolean).map(t => el('a', { href: homeHash({ tag: t.slug }) }, '#' + t.name))))));
    ui.pager.replaceChildren(
      page > 1 ? el('a', { class: 'btn ghost', href: homeHash({ ...s, page: page - 1 }) }, '上一頁') : el('span'),
      el('span', { class: 'muted' }, `第 ${page} / ${pages} 頁，共 ${hit.length} 篇`),
      page < pages ? el('a', { class: 'btn ghost', href: homeHash({ ...s, page: page + 1 }) }, '下一頁') : el('span'));
  }

  /* ---------- 文章內頁 ---------- */
  async function showArticle(slug) {
    setNav('');
    homeUI = null;
    const holder = el('article');
    app.replaceChildren(el('a', { class: 'back', href: '#/' }, '← 回文章列表'), holder);
    window.scrollTo(0, 0);
    const mine = {};
    current = { name: 'article', token: mine, repaint: null, reload: null };
    let article = null, views = null, tracked = false;

    // 只負責把已取得的文章畫出來（索引到齊後標籤名稱才完整，因此可重複呼叫，不會再讀資料庫）
    const render = () => {
      if (current.token !== mine || !article) return;
      const a = article, tags = tagById();
      document.title = `${a.title}｜${SITE}`;
      const body = el('div', { class: 'article-body' });
      body.innerHTML = cleanHtml(a.bodyHtml); // 已經 DOMPurify 消毒
      holder.replaceChildren(
        el('header', { class: 'article-head' }, el('h1', {}, a.title),
          el('div', { class: 'meta' }, el('span', {}, '發布：' + fmtDate(a.publishedAt)),
            a.updatedAt ? el('span', {}, '更新：' + fmtDate(a.updatedAt)) : null,
            views != null ? el('span', { class: 'views' }, `${views} 次閱讀`) : null,
            ...a.tagIds.map(id => tags.get(id)).filter(Boolean).map(t => el('a', { href: homeHash({ tag: t.slug }) }, '#' + t.name)))),
        body);
    };

    const load = async () => {
      try {
        const a = await api.getArticle(slug);
        if (current.token !== mine) return; // 已離開這篇
        if (!a) { article = null; document.title = SITE; holder.replaceChildren(el('div', { class: 'notice' }, '找不到這篇文章，可能已被移除。')); return; }
        article = a;
        render();
        if (!tracked) { tracked = true; api.trackView(a.id).catch(() => {}); }
        api.getViews(a.id).then(n => { if (current.token === mine && n != null) { views = n; render(); } });
      } catch (e) {
        if (current.token === mine) holder.replaceChildren(el('div', { class: 'notice' }, '文章載入失敗，請稍後再試。'));
      }
    };
    current.repaint = render;
    current.reload = load;
    await load();
  }

  /* ---------- 提問 ---------- */
  function showAsk() {
    setNav('ask');
    document.title = `我要提問｜${SITE}`;
    current = { name: 'ask', repaint: null, reload: null };
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
      el('div', { class: 'hp', 'aria-hidden': 'true' }, hp), btn, msg);

    const show = (text, isErr) => msg.replaceChildren(el('div', { class: 'msg' + (isErr ? ' error' : '') }, text));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (hp.value) { show('已收到你的提問，謝謝！'); return; } // 機器人：靜默假裝成功，不送出
      const last = Number(store.get('lastAskAt')) || 0, wait = COOLDOWN_MIN * 60000 - (Date.now() - last);
      if (wait > 0) { show(`為避免洗版，每 ${COOLDOWN_MIN} 分鐘可提問一次，請約 ${Math.ceil(wait / 60000)} 分鐘後再試。`, true); return; }
      btn.disabled = true;
      try {
        await api.submitQuestion({ content: content.value, askerName: name.value, contact: contact.value });
        form.reset();
        show('已收到你的提問，審核回覆後可能整理成公開文章，謝謝！');
      } catch (err) {
        if (err && err.code === 'invalid') show(err.message, true);
        else if (err && err.code === 'permission-denied') show(`送出失敗：可能提問過於頻繁（每 ${COOLDOWN_MIN} 分鐘一次）或內容格式不符，請稍後再試。`, true);
        else show('送出失敗，請稍後再試。', true);
      } finally { btn.disabled = false; }
    });
    app.replaceChildren(el('h1', { class: 'page-title' }, '我要提問'),
      el('p', { class: 'muted' }, '提問會先由管理員審閱，不會直接公開。請勿填寫過於私人的資料。'), form);
  }

  /* ---------- 索引（即時）更新 ---------- */
  function onIndex(next) {
    const changed = idx.stamp !== next.stamp;
    const first = !idx.ready;
    idx = { ...next, ready: true };
    if (current.name === 'home') current.repaint?.();
    else if (current.name === 'article') (changed && !first ? current.reload : current.repaint)?.(); // 後台改了內容才重抓
  }
  function onIndexError() {
    if (homeUI) homeUI.status.replaceChildren(el('div', { class: 'msg error' }, '資料載入失敗，請檢查網路後重新整理。'));
  }

  window.YuwenApp = {
    start(a) {
      api = a;
      window.addEventListener('hashchange', route);
      route();
      api.subscribeIndex(onIndex, onIndexError);
      api.trackVisit().catch(() => {});
    },
  };
})();
