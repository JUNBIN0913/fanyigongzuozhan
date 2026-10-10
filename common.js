(() => {
  'use strict';
  const Admin = (window.Admin = { views: {}, data: window.YuwenAdmin });

  // 動態文字一律以 textContent 寫入，避免 XSS
  Admin.el = function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const { el } = Admin;

  Admin.goLogin = reason => location.replace('login.html' + (reason ? '?e=' + reason : ''));

  // 毫秒時間戳 → 台北時間
  Admin.fmtTime = ms => ms ? new Date(ms).toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  Admin.toast = (msg, isError = false) => {
    const t = el('div', { class: 'toast' + (isError ? ' error' : '') }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), isError ? 6000 : 2800);
  };
  // 把錯誤轉成給人看的訊息（規則拒絕通常代表登入過期或權限不足）
  Admin.errMsg = e => e?.code === 'permission-denied' ? '沒有權限執行此操作（登入可能已過期，請重新登入）' : (e?.message || '操作失敗');

  // 對話框：onOk 丟出錯誤時對話框保持開啟並顯示訊息
  Admin.dialog = ({ title, body, okText = '確定', cancelText = '取消', danger = false, onOk }) =>
    new Promise(resolve => {
      const dlg = el('dialog', { class: 'dlg' });
      const err = el('div', { class: 'dlg-err', role: 'alert' });
      const ok = el('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), type: 'button' }, okText);
      const cancel = el('button', { class: 'btn', type: 'button' }, cancelText);
      dlg.append(el('h3', {}, title), body || '', err, el('div', { class: 'dlg-actions' }, cancel, ok));
      const close = v => { try { dlg.close ? dlg.close() : dlg.removeAttribute('open'); } catch { /* 已關閉 */ } dlg.remove(); resolve(v); };
      cancel.addEventListener('click', () => close(false));
      dlg.addEventListener('cancel', e => { e.preventDefault(); close(false); });
      ok.addEventListener('click', async () => {
        if (!onOk) return close(true);
        ok.disabled = true; err.textContent = '';
        try { await onOk(); close(true); } catch (e) { err.textContent = Admin.errMsg(e); ok.disabled = false; }
      });
      document.body.append(dlg);
      dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
    });

  Admin.confirm = (title, message, okText = '確定') =>
    Admin.dialog({ title, body: el('p', {}, message), okText, danger: true });

  // 載入文章／草稿進編輯器前先消毒（與前台相同的白名單）
  Admin.sanitize = html => window.DOMPurify.sanitize(String(html || ''), {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote', 'ul', 'ol', 'li', 'hr',
      'span', 'a', 'ruby', 'rt', 'rp', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'mark'],
    ALLOWED_ATTR: ['href', 'title', 'class', 'lang', 'target', 'rel'], ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });

  Admin.escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
})();
