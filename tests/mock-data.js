// 與 window.YuwenData 相同介面的記憶體模擬（測試 app.js 的 UI 邏輯用，不涉及 Firebase）
function createMock(opts = {}) {
  const st = { tags: {}, items: {}, articles: new Map(), views: new Map(), visits: [], questions: [], lastQuestionAt: 0 };
  const idxSubs = new Set(), artSubs = new Set();
  const clone = x => JSON.parse(JSON.stringify(x));
  const published = slug => { for (const a of st.articles.values()) if (a.slug === slug) return clone(a); return null; };
  const emitIndex = () => idxSubs.forEach(s => s.ok(clone({ tags: st.tags, items: st.items })));
  const emitArticles = () => artSubs.forEach(s => s.ok(published(s.slug)));

  const api = {
    calls: { addView: 0, getViews: 0 },
    subscribeIndex(ok, err) {
      const s = { ok, err }; idxSubs.add(s);
      setTimeout(() => opts.indexError ? err(new Error('boom')) : ok(clone({ tags: st.tags, items: st.items })), 0);
      return () => idxSubs.delete(s);
    },
    subscribeArticle(slug, ok, err) {
      const s = { slug, ok, err }; artSubs.add(s);
      setTimeout(() => opts.articleError ? err(new Error('boom')) : ok(published(slug)), 0);
      return () => artSubs.delete(s);
    },
    async getViews(id) { api.calls.getViews++; return st.views.get(id) || 0; },
    async addView(id) { api.calls.addView++; st.views.set(id, (st.views.get(id) || 0) + 1); },
    async recordVisit(day) { st.visits.push(day); },
    async submitQuestion(q) {
      if (Date.now() - st.lastQuestionAt < 600000) throw Object.assign(new Error('cooldown'), { code: 'cooldown' });
      st.lastQuestionAt = Date.now(); st.questions.push(q);
    },
    // ---- 測試輔助 ----
    state: st,
    setTags(tags) { st.tags = tags; emitIndex(); },
    publish(a) {
      st.articles.set(a.id, { id: a.id, title: a.title, slug: a.slug, summary: a.summary || '', bodyHtml: a.bodyHtml || '<p>內文</p>', tagIds: a.tagIds || [], publishedAt: a.publishedAt, updatedAt: a.publishedAt });
      st.items[a.id] = { title: a.title, slug: a.slug, summary: a.summary || '', excerpt: a.excerpt || '', tagIds: a.tagIds || [], publishedAt: a.publishedAt };
      emitIndex(); emitArticles();
    },
    update(id, patch) {
      Object.assign(st.articles.get(id), patch);
      if (patch.title) st.items[id].title = patch.title;
      emitIndex(); emitArticles();
    },
    unpublish(id) { st.articles.delete(id); delete st.items[id]; emitIndex(); emitArticles(); },
  };
  return api;
}
module.exports = { createMock };
