(() => {
  'use strict';
  const { el, data, toast, dialog, confirm, escapeHtml, errMsg } = Admin;

  // 純文字 ⇄ 簡單段落 HTML（回覆以純文字撰寫，空行分段）
  const textToHtml = t => t.trim().split(/\n{2,}/).filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const htmlToText = h => {
    if (!h) return '';
    const doc = new DOMParser().parseFromString(h, 'text/html'); // 不會執行腳本
    return [...doc.body.querySelectorAll('p')].map(p => { p.querySelectorAll('br').forEach(b => b.replaceWith('\n')); return p.textContent; }).join('\n\n') || doc.body.textContent;
  };

  Admin.views.questions = {
    async mount(root) {
      let status = 'pending', rows = null, tags = {}, unsubQ = null;
      const drafts = new Map(); // 尚未送出的回覆草稿，避免即時更新時被覆蓋
      const list = el('div', {}, el('div', { class: 'panel empty' }, '載入中…'));
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': '提問狀態' });
      for (const [v, label] of [['pending', '待回覆'], ['answered', '已回覆'], ['archived', '已封存']]) {
        seg.append(el('button', { type: 'button', 'aria-pressed': String(v === status), onclick: e => {
          status = v;
          seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          subscribe();
        } }, label));
      }
      root.replaceChildren(el('div', { class: 'page' }, el('h1', {}, '提問審核', seg), list));

      async function toArticle(q) {
        const tagList = Object.entries(tags).map(([id, t]) => ({ id, ...t }));
        const title = el('input', { type: 'text', maxlength: 120, value: q.content.slice(0, 40) });
        const pub = el('input', { type: 'checkbox', id: 'pubnow' });
        const boxes = tagList.map(t => ({ t, cb: el('input', { type: 'checkbox', value: t.id }) }));
        await dialog({ title: '將問答轉為文章', okText: '轉為文章',
          body: el('div', {},
            el('div', { class: 'field' }, el('label', {}, '文章標題'), title),
            el('div', { class: 'field' }, el('label', {}, '標籤'), tagList.length
              ? el('div', { class: 'checks' }, ...boxes.map(({ t, cb }) => el('label', {}, cb, ' ', t.name)))
              : el('span', { class: 'muted' }, '尚無標籤，可稍後在編輯器補上')),
            el('div', { class: 'field' }, el('label', { for: 'pubnow' }, pub, ' 直接公開發布（未勾選則存為草稿）'))),
          onOk: async () => {
            const articleId = await data.questionToArticle(q.id, { title: title.value, publish: pub.checked, tagIds: boxes.filter(b => b.cb.checked).map(b => b.cb.value) });
            toast(pub.checked ? '已轉為公開文章' : '已轉為草稿文章');
            location.hash = '#/editor/' + articleId;
          } });
      }

      function card(q) {
        const ta = el('textarea', { 'aria-label': '回覆內容', placeholder: '輸入回覆（空一行分段）…' });
        ta.value = drafts.has(q.id) ? drafts.get(q.id) : htmlToText(q.answerHtml);
        ta.addEventListener('input', () => drafts.set(q.id, ta.value));
        const send = el('button', { class: 'btn primary', type: 'button', 'data-act': 'answer', onclick: async () => {
          const html = textToHtml(ta.value);
          if (!html) return toast('請輸入回覆內容', true);
          try { await data.answerQuestion(q.id, html); drafts.delete(q.id); toast('已送出回覆'); }
          catch (e) { toast(errMsg(e), true); }
        } }, q.status === 'answered' ? '更新回覆' : '送出回覆');
        const acts = [send];
        if (q.status === 'answered') {
          acts.push(q.publishedArticleId
            ? el('a', { class: 'btn', href: '#/editor/' + q.publishedArticleId }, '已轉為文章 → 開啟')
            : el('button', { class: 'btn', type: 'button', 'data-act': 'to-article', onclick: () => toArticle(q) }, '轉為文章…'));
        }
        acts.push(el('button', { class: 'btn', type: 'button', 'data-act': 'archive', onclick: async () => {
          try { await data.archiveQuestion(q.id); toast('已封存'); } catch (e) { toast(errMsg(e), true); }
        } }, '封存'));
        acts.push(el('button', { class: 'btn danger', type: 'button', 'data-act': 'delete', onclick: async () => {
          if (!(await confirm('刪除提問', '確定要刪除這則提問？此動作無法復原。', '刪除'))) return;
          try { await data.deleteQuestion(q.id); toast('已刪除'); } catch (e) { toast(errMsg(e), true); }
        } }, '刪除'));
        return el('div', { class: 'qcard ' + q.status, 'data-q': q.id },
          el('div', { class: 'qmeta' }, el('span', {}, '#' + q.id.slice(0, 6)), el('span', {}, q.askerName || '匿名'),
            q.contact ? el('span', {}, '聯絡：' + q.contact) : null, el('span', {}, Admin.fmtTime(q.createdAt))),
          el('div', { class: 'qbody' }, q.content),
          q.status === 'archived' ? null : ta,
          el('div', { class: 'row', style: 'margin-top:.6rem' }, ...(q.status === 'archived' ? acts.slice(-1) : acts)));
      }

      function render() {
        if (!rows) return;
        // 正在輸入回覆時，即時更新不重繪，避免打斷輸入
        if (list.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
        list.replaceChildren(...(rows.length ? rows.map(card) : [el('div', { class: 'panel empty' }, '沒有提問')]));
      }
      function subscribe() {
        unsubQ && unsubQ();
        rows = null;
        list.replaceChildren(el('div', { class: 'panel empty' }, '載入中…'));
        unsubQ = data.subscribeQuestions(status, r => { rows = r; render(); },
          e => list.replaceChildren(el('div', { class: 'panel' }, '載入失敗：' + errMsg(e))));
      }

      const unsubIdx = data.subscribeIndex(ix => { tags = ix.tags; });
      subscribe();
      return { destroy() { unsubQ && unsubQ(); unsubIdx(); } };
    },
  };
})();
