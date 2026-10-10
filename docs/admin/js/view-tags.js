(() => {
  'use strict';
  const { el, data, toast, dialog, confirm, errMsg } = Admin;

  Admin.views.tags = {
    async mount(root) {
      let tags = null, articles = [];
      const list = el('div', {}, el('div', { class: 'panel empty' }, '載入中…'));
      const input = el('input', { type: 'text', maxlength: 30, placeholder: '新標籤名稱', 'aria-label': '新標籤名稱' });
      const add = async e => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        try { await data.addTag(name); input.value = ''; toast('已新增標籤'); } catch (ex) { toast(errMsg(ex), true); }
      };
      root.replaceChildren(el('div', { class: 'page' }, el('h1', {}, '標籤管理'),
        el('form', { class: 'panel row', onsubmit: add }, input, el('button', { class: 'btn primary', type: 'submit' }, '新增標籤')),
        list));

      const rowsOf = () => Object.entries(tags).map(([id, t]) => ({ id, ...t, count: articles.filter(a => a.tagIds.includes(id)).length }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

      async function rename(t) {
        const f = el('input', { type: 'text', maxlength: 30, value: t.name, 'aria-label': '新名稱' });
        await dialog({ title: `重新命名「${t.name}」`, body: el('div', { class: 'field' }, f), okText: '儲存',
          onOk: async () => { await data.renameTag(t.id, f.value); toast('已更名'); } });
      }
      async function merge(t, all) {
        const others = all.filter(x => x.id !== t.id);
        if (!others.length) return toast('沒有其他標籤可合併', true);
        const sel = el('select', { 'aria-label': '合併到' }, ...others.map(o => el('option', { value: o.id }, `${o.name}（${o.count} 篇）`)));
        await dialog({ title: `合併「${t.name}」`, okText: '合併',
          body: el('div', { class: 'field' }, el('p', {}, `「${t.name}」下的所有文章（含草稿）會改掛到目標標籤，之後「${t.name}」會被刪除。`), el('label', {}, '合併到'), sel),
          onOk: async () => { const r = await data.mergeTag(t.id, sel.value); toast(`已合併（影響 ${r.affected} 篇文章）`); } });
      }
      async function remove(t) {
        if (!(await confirm('刪除標籤', `刪除「${t.name}」後，${t.count} 篇文章會失去此標籤（文章本身不會被刪除）。`, '刪除'))) return;
        try { await data.deleteTag(t.id); toast('已刪除'); } catch (e) { toast(errMsg(e), true); }
      }

      function render() {
        if (!tags) return;
        const all = rowsOf();
        if (!all.length) return list.replaceChildren(el('div', { class: 'panel empty' }, '尚未建立標籤'));
        list.replaceChildren(el('div', { class: 'panel tablewrap' }, el('table', {},
          el('thead', {}, el('tr', {}, el('th', {}, '名稱'), el('th', {}, '網址代稱'), el('th', { class: 'num' }, '文章數（含草稿）'), el('th', {}, '操作'))),
          el('tbody', {}, ...all.map(t => el('tr', { 'data-tag': t.id },
            el('td', {}, t.name), el('td', { class: 'muted' }, t.slug), el('td', { class: 'num' }, t.count),
            el('td', { class: 'act' },
              el('button', { class: 'btn sm', type: 'button', 'data-act': 'rename', onclick: () => rename(t) }, '改名'), ' ',
              el('button', { class: 'btn sm', type: 'button', 'data-act': 'merge', onclick: () => merge(t, all) }, '合併'), ' ',
              el('button', { class: 'btn sm danger', type: 'button', 'data-act': 'delete', onclick: () => remove(t) }, '刪除'))))))));
      }

      const unsubs = [
        data.subscribeIndex(ix => { tags = ix.tags; render(); }, e => list.replaceChildren(el('div', { class: 'panel' }, '載入失敗：' + errMsg(e)))),
        data.subscribeArticles(r => { articles = r; render(); }),
      ];
      return { destroy() { unsubs.forEach(u => u()); } };
    },
  };
})();
