// 前台資料層：把 Firebase 包成 app.js 使用的簡單介面（window.YuwenData）
import { initFirebase } from './fb-core.js';
import {
  doc, collection, query, where, limit, onSnapshot, getDoc, setDoc,
  writeBatch, serverTimestamp, increment,
} from 'firebase/firestore';

const toMs = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : null);
const LIVE = { includeMetadataChanges: true }; // 讓「快取 → 伺服器確認」的狀態變化也會通知

function createPublicData(cfg) {
  const { db, ensureUser } = initFirebase(cfg);

  return {
    // 前台索引：已發布文章清單＋全部標籤（單一文件，首頁只讀這份）
    subscribeIndex(onData, onError) {
      return onSnapshot(doc(db, 'meta', 'index'), LIVE, snap => {
        if (!snap.exists() && snap.metadata.fromCache) return; // 等伺服器確認，避免誤顯示「沒有文章」
        const d = snap.exists() ? snap.data() : {};
        const items = {};
        for (const [id, it] of Object.entries(d.items || {})) items[id] = { ...it, publishedAt: toMs(it.publishedAt) };
        onData({ tags: d.tags || {}, items });
      }, err => onError && onError(err));
    },

    // 單篇文章（依 slug，僅已發布）；管理員修改時會即時推送
    subscribeArticle(slug, onData, onError) {
      const q = query(collection(db, 'articles'), where('slug', '==', slug), where('status', '==', 'published'), limit(1));
      return onSnapshot(q, LIVE, snap => {
        if (snap.empty) { if (!snap.metadata.fromCache) onData(null); return; }
        const d = snap.docs[0], x = d.data();
        onData({
          id: d.id, title: x.title, slug: x.slug, summary: x.summary, bodyHtml: x.bodyHtml,
          tagIds: x.tagIds || [], publishedAt: toMs(x.publishedAt), updatedAt: toMs(x.updatedAt),
        });
      }, err => onError && onError(err));
    },

    async getViews(articleId) {
      const s = await getDoc(doc(db, 'articleViews', articleId));
      return s.exists() ? (s.data().count || 0) : 0;
    },

    // 規則：不存在時 count 必須為 1；存在時只能 +1
    async addView(articleId) {
      await ensureUser();
      await setDoc(doc(db, 'articleViews', articleId), { count: increment(1) }, { merge: true });
    },

    // 每位訪客每日一份文件；重複寫入會被規則拒絕（視為已記錄）
    async recordVisit(day) {
      const user = await ensureUser();
      try {
        await setDoc(doc(db, 'visits', `${day}_${user.uid}`), { day, at: serverTimestamp() });
      } catch (e) {
        if (e && e.code === 'permission-denied') return;
        throw e;
      }
    },

    // 提問：與冷卻紀錄同一批次寫入，規則會檢查 10 分鐘間隔
    async submitQuestion({ content, askerName, contact }) {
      const user = await ensureUser();
      const data = { content, status: 'pending', createdAt: serverTimestamp() };
      if (askerName) data.askerName = askerName;
      if (contact) data.contact = contact;
      const batch = writeBatch(db);
      batch.set(doc(db, 'rateLimits', user.uid), { lastAt: serverTimestamp() });
      batch.set(doc(collection(db, 'questions')), data);
      try {
        await batch.commit();
      } catch (e) {
        if (e && e.code === 'permission-denied') throw Object.assign(new Error('cooldown'), { code: 'cooldown' });
        throw e;
      }
    },
  };
}

try {
  window.YuwenData = createPublicData(window.FIREBASE_CONFIG);
} catch (e) {
  window.YuwenDataError = e;
}
