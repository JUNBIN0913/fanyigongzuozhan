(() => {
  'use strict';
  const { el, data } = Admin;
  const view = document.getElementById('view');
  const badge = document.getElementById('badge');

  if (!data) {
    view.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'panel' }, '後台尚未完成設定：' + (window.YuwenAdminError?.message || '資料服務未載入'))));
    return;
  }

  let current = null;   // { destroy }
  let seq = 0;          // 避免快速切換頁籤時舊的載入覆蓋新畫面
  let started = false, unsubBadge = null;

  async function route() {
    const [, name = 'dashboard', arg] = (location.hash.slice(1) || '/dashboard').split('/');
    const v = Admin.views[name] || Admin.views.dashboard;
    const tab = Admin.views[name] ? name : 'dashboard';
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === (tab === 'editor' ? 'articles' : tab)));
    const mine = ++seq;
    const prev = current;
    current = null;
    try { prev?.destroy?.(); } catch { /* 忽略 */ }
    view.className = 'workspace';
    document.getElementById('ribbon-slot').replaceChildren();
    document.getElementById('status-slot').replaceChildren();
    try {
      const inst = await v.mount(view, arg);
      if (mine === seq) current = inst; else inst?.destroy?.();
    } catch (e) {
      if (mine === seq) view.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'panel' }, '載入失敗：' + Admin.errMsg(e))));
    }
  }

  function start(user) {
    started = true;
    document.getElementById('who').textContent = user.email || '';
    // 待回覆提問數（即時）
    unsubBadge = data.subscribeQuestions('pending', rows => { badge.textContent = rows.length; badge.hidden = !rows.length; });
    window.addEventListener('hashchange', route);
    route();
  }

  // 登入閘門：未登入或不在白名單，一律導向登入頁。（真正的權限由 Firestore 規則把關，這裡只是使用者體驗。）
  data.onAuth(user => {
    if (user && user.isAdmin) { if (!started) start(user); return; }
    if (user && !user.isAdmin) data.signOut();
    unsubBadge && unsubBadge();
    current?.destroy?.();
    Admin.goLogin(user ? 'noadmin' : '');
  });

  document.getElementById('logout').addEventListener('click', async () => {
    try { await data.signOut(); } catch { /* 忽略 */ }
    Admin.goLogin();
  });
})();
