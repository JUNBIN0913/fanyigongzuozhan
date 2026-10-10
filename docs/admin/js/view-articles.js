(() => {
  'use strict';
  const { el, data, toast, confirm, errMsg } = Admin;

  Admin.views.articles = {
    async mount(root) {
      let filter = '', rows = null, tags = {};
      const list = el('div', {}, el('div', { class: 'panel empty' }, '載入中…'));
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': '狀態篩選' });
      for (const [v, label] of [['', '全部'], ['published', '已發布'], ['draft', '草稿']]) {
        seg.append(el('button', { type: 'button', 'aria-pressed': String(v === filter), onclick: e => {
          filter = v;
          seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          render();
        } }, label));
      }
      root.replaceChildren(el('div', { class: 'page' },
        el('h1', {}, '文章', el('a', { class: 'btn primary', href: '#/editor/new' }, '＋ 新增文章'), seg), list));

      function render() {
        if (!rows) return;
        const shown = rows.filter(a => !filter || a.status === filter);
        if (!shown.length) return list.replaceChildren(el('div', { class: 'panel empty' }, '沒有文章'));
        list.replaceChildren(el('div', { class: 'panel tablewrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ...['標題', '狀態', '標籤'].map(h => el('th', {}, h)), el('th', {}, '更新'), el('th', {}, '操作'))),
          el('tbody', {}, ...shown.map(a => el('tr', { 'data-article': a.id },
            el('td', {}, el('a', { href: '#/editor/' + a.id }, a.title || '（未命名）')),
            el('td', {}, el('span', { class: 'pill ' + (a.status === 'published' ? 'pub' : 'draft') }, a.status === 'published' ? '已發布' : '草稿')),
            el('td', {}, ...a.tagIds.map(id => tags[id]).filter(Boolean).map(t => el('span', { class: 'pill' }, t.name))),
            el('td', {}, Admin.fmtTime(a.updatedAt)),
            el('td', { class: 'act' },
              el('a', { class: 'btn sm', href: '#/editor/' + a.id }, '編輯'), ' ',
              el('button', { class: 'btn sm', type: 'button', 'data-act': 'toggle', onclick: async () => {
                try { await data.publishArticle(a.id, a.status !== 'published'); toast(a.status === 'published' ? '已下架為草稿' : '已發布'); }
                catch (e) { toast(errMsg(e), true); }
              } }, a.status === 'published' ? '下架' : '發布'), ' ',
              el('button', { class: 'btn sm danger', type: 'button', 'data-act': 'delete', onclick: async () => {
                if (!(await confirm('刪除文章', `確定要刪除「${a.title}」？此動作無法復原。`, '刪除'))) return;
                try { await data.deleteArticle(a.id); toast('已刪除'); } catch (e) { toast(errMsg(e), true); }
              } }, '刪除'))))))));
      }

      const unsubs = [
        data.subscribeIndex(ix => { tags = ix.tags; render(); }, e => toast(errMsg(e), true)),
        data.subscribeArticles(r => { rows = r; render(); }, e => list.replaceChildren(el('div', { class: 'panel' }, '載入失敗：' + errMsg(e)))),
      ];
      return { destroy() { unsubs.forEach(u => u()); } };
    },
  };
})();
