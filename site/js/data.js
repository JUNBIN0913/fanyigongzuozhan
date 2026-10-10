// 資料存取層：只描述「前台要什麼資料、寫入什麼內容」，不直接依賴 Firebase SDK，
// 由 fb.js 提供 fb 轉接物件（方便在沒有網路的環境以假物件測試）。
// 此檔不可有 import 語句。

const toDate = v => (v && typeof v.toDate === 'function' ? v.toDate() : v ? new Date(v) : null);
const taipeiDay = d => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(/-/g, ''); // YYYYMMDD

function normalizeIndex(d) {
  const tags = Object.entries(d.tags || {})
    .map(([id, t]) => ({ id, name: String(t.name || ''), slug: String(t.slug || '') }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const items = Object.entries(d.items || {}).map(([id, i]) => ({
    id, title: String(i.title || ''), slug: String(i.slug || ''), summary: String(i.summary || ''),
    excerpt: String(i.excerpt || ''), tagIds: Array.isArray(i.tagIds) ? i.tagIds : [], publishedAt: toDate(i.publishedAt),
  }));
  const updatedAt = toDate(d.updatedAt);
  return { tags, items, updatedAt, stamp: updatedAt ? updatedAt.getTime() : items.length };
}

function normalizeArticle(id, d) {
  return {
    id, title: String(d.title || ''), slug: String(d.slug || ''), summary: String(d.summary || ''),
    bodyHtml: String(d.bodyHtml || ''), tagIds: Array.isArray(d.tagIds) ? d.tagIds : [],
    publishedAt: toDate(d.publishedAt), updatedAt: toDate(d.updatedAt),
  };
}

export function createApi(fb) {
  const mem = fb.storage;
  const today = () => taipeiDay(fb.now());

  return {
    // 即時訂閱前台索引（meta/index，1 份文件）
    subscribeIndex(onData, onError) {
      return fb.onDoc('meta', 'index', (exists, data) => onData(normalizeIndex(exists ? data : {})), onError);
    },

    async getArticle(slug) {
      const hit = await fb.queryOne('articles', [['slug', '==', slug], ['status', '==', 'published']]);
      return hit ? normalizeArticle(hit.id, hit.data) : null;
    },

    async getViews(articleId) {
      try { const d = await fb.getDoc('articleViews', articleId); return d ? Number(d.count) || 0 : 0; } catch { return null; }
    },

    // 全站造訪：每位訪客每天最多一筆（文件 ID = 日期_uid，規則會擋重複）
    async trackVisit() {
      const day = today(), key = `visit:${day}`;
      if (mem.get(key)) return;
      const uid = await fb.ensureUser();
      try { await fb.setDoc('visits', `${day}_${uid}`, { day, at: fb.serverTimestamp() }); }
      catch (e) { if (!fb.isCode(e, 'permission-denied')) throw e; /* 當日已記錄 */ }
      mem.set(key, '1');
    },

    // 單篇瀏覽：同一瀏覽器同一天同一篇只送一次（僅供參考的數字）
    async trackView(articleId) {
      const key = `view:${today()}:${articleId}`;
      if (mem.get(key)) return;
      await fb.ensureUser();
      try { await fb.updateDoc('articleViews', articleId, { count: fb.increment(1) }); }
      catch (e) {
        if (fb.isCode(e, 'not-found')) {
          try { await fb.setDoc('articleViews', articleId, { count: 1 }); } catch (e2) { if (!fb.isCode(e2, 'permission-denied')) throw e2; }
        } else if (!fb.isCode(e, 'permission-denied')) throw e;
      }
      mem.set(key, '1');
    },

    // 提問：與 rateLimits/{uid} 同一批次寫入（規則要求，並強制 10 分鐘冷卻）
    async submitQuestion({ content, askerName, contact }) {
      content = String(content || '').trim();
      if (content.length < 5 || content.length > 1000) throw Object.assign(new Error('問題內容需為 5 到 1000 字'), { code: 'invalid' });
      const uid = await fb.ensureUser();
      const id = fb.newId('questions');
      const data = { content, status: 'pending', createdAt: fb.serverTimestamp() };
      const name = String(askerName || '').trim().slice(0, 40);
      const ct = String(contact || '').trim().slice(0, 100);
      if (name) data.askerName = name;
      if (ct) data.contact = ct;
      await fb.commit([
        { col: 'rateLimits', id: uid, data: { lastAt: fb.serverTimestamp() } },
        { col: 'questions', id, data },
      ]);
      mem.set('lastAskAt', String(fb.now().getTime()));
    },
  };
}
