(() => {
  'use strict';
  const { el, data, toast, errMsg } = Admin;

  const stat = (label, n, sub, href) =>
    el(href ? 'a' : 'div', { class: 'stat', href }, el('div', { class: 'n' }, n), el('div', { class: 'l' }, label), sub ? el('div', { class: 's' }, sub) : null);

  Admin.views.dashboard = {
    async mount(root) {
      const body = el('div');
      const btn = el('button', { class: 'btn sm', type: 'button', onclick: () => load() }, '重新整理');
      root.replaceChildren(el('div', { class: 'page' }, el('h1', {}, '儀表板', btn), body,
        el('p', { class: 'muted' }, '統計為手動重新整理（每次會讀取各篇瀏覽數與計數，以節省免費額度）。瀏覽與造訪由前端回報，僅供參考。')));

      let alive = true;
      async function load() {
        btn.disabled = true;
        try {
          const s = await data.getStats();
          if (!alive) return;
          const max = Math.max(1, ...s.visitsByDay.map(d => d.visits));
          const bars = s.visitsByDay.map(d => {
            const fill = el('div', { class: 'fill' });
            fill.style.width = (d.visits / max * 100) + '%';
            return el('div', { class: 'bar' }, el('span', {}, `${d.day.slice(4, 6)}-${d.day.slice(6)}`), el('div', { class: 'track' }, fill), el('span', { class: 'v' }, d.visits));
          });
          body.replaceChildren(
            el('div', { class: 'cards' },
              stat('已發布文章', s.publishedCount, null, '#/articles'),
              stat('草稿', s.draftCount),
              stat('全站造訪人次', s.totalVisits, `今日 ${s.todayVisits}`),
              stat('文章總閱讀次數', s.totalViews),
              stat('待回覆提問', s.pendingQuestions, null, '#/questions')),
            el('div', { class: 'panel' }, el('h2', {}, '各篇文章瀏覽次數'),
              s.articleViews.length
                ? el('div', { class: 'tablewrap' }, el('table', {},
                    el('thead', {}, el('tr', {}, el('th', {}, '標題'), el('th', {}, '發布時間'), el('th', { class: 'num' }, '瀏覽'))),
                    el('tbody', {}, ...s.articleViews.map(a => el('tr', {},
                      el('td', {}, el('a', { href: '#/editor/' + a.id }, a.title)),
                      el('td', {}, Admin.fmtTime(a.publishedAt)),
                      el('td', { class: 'num' }, a.viewCount))))))
                : el('div', { class: 'empty' }, '尚無已發布文章')),
            el('div', { class: 'panel' }, el('h2', {}, '近 14 日造訪人次（每位訪客每日計一次）'), el('div', { class: 'bars' }, ...bars)));
        } catch (e) {
          if (alive) body.replaceChildren(el('div', { class: 'panel' }, '載入失敗：' + errMsg(e)));
          toast(errMsg(e), true);
        } finally { btn.disabled = false; }
      }
      await load();
      return { destroy() { alive = false; } };
    },
  };
})();
