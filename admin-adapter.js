// 後台資料層：把 Firebase 包成 window.YuwenAdmin。
// 重點：文章與「前台索引」meta/index 必須一起更新；標籤只存在 meta/index.tags。
import { initFirebase } from './fb-core.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  doc, collection, query, where, orderBy, limit, onSnapshot, getDoc, getDocs, deleteDoc,
  writeBatch, serverTimestamp, deleteField, getCountFromServer, getAggregateFromServer, sum,
} from 'firebase/firestore';

const TZ = 'Asia/Taipei';
// 規則限制：批次寫入中 exists()/get() 呼叫合計上限 20，每個寫入的 isAdmin() 算 1 次，
// 因此每批最多 15 篇文章 + 1 次索引寫入，保守地留有餘裕。
const CHUNK = 15;

const toMs = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : null);
const dayKey = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: TZ }).replace(/-/g, '');
const slugify = text => String(text).trim().toLowerCase().replace(/[\s_]+/g, '-')
  .replace(/[^\p{L}\p{N}-]+/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const plainText = html => {
  const d = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html'); // 不會執行腳本
  return d.body.textContent.replace(/\s+/g, ' ').trim();
};

// 與前台相同的白名單；後台存檔前先消毒一次（前台顯示時還會再消毒）
const RICH = {
  ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'blockquote', 'ul', 'ol', 'li', 'hr',
    'span', 'a', 'ruby', 'rt', 'rp', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 'mark'],
  ALLOWED_ATTR: ['href', 'title', 'class', 'lang', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
};
const cleanHtml = h => {
  if (!window.DOMPurify) throw new Error('消毒元件（DOMPurify）未載入，已中止儲存');
  return window.DOMPurify.sanitize(String(h || ''), RICH);
};

function createAdminData(cfg) {
  const { auth, db } = initFirebase(cfg);
  const col = n => collection(db, n);
  const idxRef = doc(db, 'meta', 'index');
  const adminUid = () => {
    const u = auth.currentUser;
    if (!u || u.isAnonymous) throw new Error('尚未登入');
    return u.uid;
  };

  async function readIndex() {
    const s = await getDoc(idxRef);
    const d = s.exists() ? s.data() : {};
    return { tags: d.tags || {}, items: d.items || {} };
  }

  // 索引項目：標題、網址、摘要(≤120)、內文摘錄(≤150)、標籤、發布時間
  const indexEntry = (a, publishedAt) => ({
    title: a.title, slug: a.slug, summary: (a.summary || '').slice(0, 120),
    excerpt: plainText(a.bodyHtml).slice(0, 150), tagIds: a.tagIds || [], publishedAt,
  });
  const idxSet = (batch, patch) => batch.set(idxRef, { ...patch, updatedAt: serverTimestamp() }, { merge: true });

  async function uniqueSlug(base, excludeId = null) {
    const root = base || ('post-' + Date.now().toString(36));
    for (let i = 1; i <= 50; i++) {
      const s = i === 1 ? root : `${root}-${i}`;
      const snap = await getDocs(query(col('articles'), where('slug', '==', s), limit(2)));
      if (snap.docs.every(d => d.id === excludeId)) return s;
    }
    throw new Error('無法產生不重複的網址代稱，請修改標題');
  }

  function uniqueTagSlug(tags, base, excludeId = null) {
    const root = base || ('tag-' + Date.now().toString(36));
    const used = new Set(Object.entries(tags).filter(([id]) => id !== excludeId).map(([, t]) => t.slug));
    let s = root, i = 2;
    while (used.has(s)) s = `${root}-${i++}`;
    return s;
  }

  const cleanTagName = n => {
    const name = String(n || '').trim().slice(0, 30);
    if (!name) throw new Error('請輸入標籤名稱');
    return name;
  };
  const nameTaken = (tags, name, exceptId) =>
    Object.entries(tags).some(([id, t]) => id !== exceptId && t.name.toLowerCase() === name.toLowerCase());

  // 將受影響的文章分批更新；索引寫入放在同一批，使文章與索引一致
  async function updateArticlesInChunks(docs, makeTagIds, { extraIndexPatch } = {}) {
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      const items = {};
      for (const d of docs.slice(i, i + CHUNK)) {
        const tagIds = makeTagIds(d.data().tagIds || []);
        batch.update(d.ref, { tagIds, updatedAt: serverTimestamp() });
        if (d.data().status === 'published') items[d.id] = { tagIds };
      }
      if (Object.keys(items).length) idxSet(batch, { items });
      await batch.commit();
    }
  }
  const articlesWithTag = tagId => getDocs(query(col('articles'), where('tagIds', 'array-contains', tagId)));

  const listItem = d => {
    const x = d.data();
    return { id: d.id, title: x.title, slug: x.slug, summary: x.summary, status: x.status, tagIds: x.tagIds || [],
      createdAt: toMs(x.createdAt), updatedAt: toMs(x.updatedAt), publishedAt: toMs(x.publishedAt), sourceQuestionId: x.sourceQuestionId || null };
  };
  const questionItem = d => {
    const x = d.data();
    return { id: d.id, content: x.content, askerName: x.askerName || '', contact: x.contact || '', status: x.status,
      answerHtml: x.answerHtml || '', publishedArticleId: x.publishedArticleId || null, createdAt: toMs(x.createdAt), answeredAt: toMs(x.answeredAt) };
  };

  return {
    /* ---------- 登入 ---------- */
    // cb(null) = 未登入；cb({uid,email,isAdmin})。匿名使用者視為未登入。
    onAuth(cb) {
      return onAuthStateChanged(auth, async user => {
        if (!user || user.isAnonymous) return cb(null);
        let isAdmin = false;
        try { isAdmin = (await getDoc(doc(db, 'admins', user.uid))).exists(); } catch { /* 讀取失敗視為非管理員 */ }
        cb({ uid: user.uid, email: user.email, isAdmin });
      });
    },
    async signIn(email, password) { await signInWithEmailAndPassword(auth, String(email).trim(), String(password)); },
    signOut() { return signOut(auth); },

    /* ---------- 索引與標籤 ---------- */
    subscribeIndex(cb, onError) {
      return onSnapshot(idxRef, snap => {
        const d = snap.exists() ? snap.data() : {};
        cb({ tags: d.tags || {}, items: d.items || {} });
      }, e => onError && onError(e));
    },

    async addTag(nameInput) {
      const name = cleanTagName(nameInput);
      const { tags } = await readIndex();
      if (nameTaken(tags, name)) throw new Error('標籤名稱已存在');
      const id = doc(col('tags')).id; // 只取自動產生的 ID，不會寫入 tags 集合
      const slug = uniqueTagSlug(tags, slugify(name));
      const batch = writeBatch(db);
      idxSet(batch, { tags: { [id]: { name, slug } } });
      await batch.commit();
      return { id, name, slug };
    },

    async renameTag(id, nameInput) {
      const name = cleanTagName(nameInput);
      const { tags } = await readIndex();
      if (!tags[id]) throw new Error('找不到標籤');
      if (nameTaken(tags, name, id)) throw new Error('標籤名稱已存在');
      const slug = uniqueTagSlug(tags, slugify(name), id);
      const batch = writeBatch(db);
      idxSet(batch, { tags: { [id]: { name, slug } } });
      await batch.commit();
      return { id, name, slug };
    },

    // 合併：來源標籤下的文章（含草稿）改掛目標標籤，最後才刪除來源標籤（可安全重試）
    async mergeTag(srcId, dstId) {
      if (!srcId || !dstId || srcId === dstId) throw new Error('請選擇不同的目標標籤');
      const { tags } = await readIndex();
      if (!tags[srcId] || !tags[dstId]) throw new Error('找不到標籤');
      const snap = await articlesWithTag(srcId);
      await updateArticlesInChunks(snap.docs, ids => [...new Set(ids.map(t => t === srcId ? dstId : t))]);
      const batch = writeBatch(db);
      idxSet(batch, { tags: { [srcId]: deleteField() } });
      await batch.commit();
      return { affected: snap.size };
    },

    async deleteTag(id) {
      const { tags } = await readIndex();
      if (!tags[id]) throw new Error('找不到標籤');
      const snap = await articlesWithTag(id);
      await updateArticlesInChunks(snap.docs, ids => ids.filter(t => t !== id));
      const batch = writeBatch(db);
      idxSet(batch, { tags: { [id]: deleteField() } });
      await batch.commit();
      return { affected: snap.size };
    },

    /* ---------- 文章 ---------- */
    subscribeArticles(cb, onError) {
      return onSnapshot(query(col('articles'), orderBy('updatedAt', 'desc')), snap => cb(snap.docs.map(listItem)), e => onError && onError(e));
    },

    async getArticle(id) {
      const s = await getDoc(doc(db, 'articles', id));
      if (!s.exists()) return null;
      return { ...listItem(s), bodyHtml: s.data().bodyHtml || '' };
    },

    // 新增（無 id）或更新。已發布文章同批更新索引；草稿則依標題更新網址代稱。
    async saveArticle({ id, title, summary, bodyHtml, tagIds }) {
      const uid = adminUid();
      title = String(title || '').trim().slice(0, 120);
      if (!title) throw new Error('請輸入標題');
      summary = String(summary || '').trim().slice(0, 300);
      bodyHtml = cleanHtml(bodyHtml);
      if (bodyHtml.length > 200000) throw new Error('內文過長（上限約 20 萬字元）');
      const { tags } = await readIndex();
      tagIds = [...new Set(tagIds || [])].filter(t => tags[t]).slice(0, 20);

      const batch = writeBatch(db);
      if (!id) {
        const ref = doc(col('articles'));
        const slug = await uniqueSlug(slugify(title));
        batch.set(ref, { title, slug, summary, bodyHtml, status: 'draft', tagIds, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), publishedAt: null });
        batch.delete(doc(db, 'drafts', `${uid}_new`));
        await batch.commit();
        return ref.id;
      }
      const ref = doc(db, 'articles', id);
      const cur = await getDoc(ref);
      if (!cur.exists()) throw new Error('找不到文章');
      const c = cur.data();
      const slug = c.status === 'draft' ? await uniqueSlug(slugify(title), id) : c.slug; // 已發布文章網址不變
      batch.update(ref, { title, slug, summary, bodyHtml, tagIds, updatedAt: serverTimestamp() });
      if (c.status === 'published') idxSet(batch, { items: { [id]: indexEntry({ title, slug, summary, bodyHtml, tagIds }, c.publishedAt) } });
      batch.delete(doc(db, 'drafts', `${uid}_${id}`));
      await batch.commit();
      return id;
    },

    async publishArticle(id, publish = true) {
      const ref = doc(db, 'articles', id);
      const cur = await getDoc(ref);
      if (!cur.exists()) throw new Error('找不到文章');
      const c = cur.data();
      const batch = writeBatch(db);
      if (publish) {
        if (!c.title || !plainText(c.bodyHtml)) throw new Error('標題與內文不可為空');
        const publishedAt = c.publishedAt || serverTimestamp();
        batch.update(ref, { status: 'published', publishedAt, updatedAt: serverTimestamp() });
        idxSet(batch, { items: { [id]: indexEntry(c, publishedAt) } });
      } else {
        batch.update(ref, { status: 'draft', updatedAt: serverTimestamp() });
        idxSet(batch, { items: { [id]: deleteField() } });
      }
      await batch.commit();
    },

    async deleteArticle(id) {
      const uid = adminUid();
      const batch = writeBatch(db);
      batch.delete(doc(db, 'articles', id));
      idxSet(batch, { items: { [id]: deleteField() } });
      batch.delete(doc(db, 'articleViews', id));
      batch.delete(doc(db, 'drafts', `${uid}_${id}`));
      await batch.commit();
    },

    /* ---------- 自動暫存（drafts/{uid}_{articleId|new}）---------- */
    async saveDraft(articleId, { title, bodyHtml }) {
      const uid = adminUid();
      const batch = writeBatch(db);
      batch.set(doc(db, 'drafts', `${uid}_${articleId || 'new'}`),
        { title: String(title || '').slice(0, 120), bodyHtml: cleanHtml(bodyHtml), savedAt: serverTimestamp() });
      await batch.commit();
    },
    async getDraft(articleId) {
      const uid = adminUid();
      const s = await getDoc(doc(db, 'drafts', `${uid}_${articleId || 'new'}`));
      return s.exists() ? { title: s.data().title || '', bodyHtml: s.data().bodyHtml || '', savedAt: toMs(s.data().savedAt) } : null;
    },
    async deleteDraft(articleId) {
      const uid = adminUid();
      await deleteDoc(doc(db, 'drafts', `${uid}_${articleId || 'new'}`));
    },

    /* ---------- 提問審核 ---------- */
    subscribeQuestions(status, cb, onError) {
      const q = query(col('questions'), where('status', '==', status), orderBy('createdAt', 'desc'), limit(200));
      return onSnapshot(q, snap => cb(snap.docs.map(questionItem)), e => onError && onError(e));
    },
    async answerQuestion(id, answerHtml) {
      const html = cleanHtml(answerHtml);
      if (!plainText(html)) throw new Error('請輸入回覆內容');
      const batch = writeBatch(db);
      batch.update(doc(db, 'questions', id), { answerHtml: html, status: 'answered', answeredAt: serverTimestamp() });
      await batch.commit();
    },
    async archiveQuestion(id) {
      const batch = writeBatch(db);
      batch.update(doc(db, 'questions', id), { status: 'archived' });
      await batch.commit();
    },
    deleteQuestion(id) { return deleteDoc(doc(db, 'questions', id)); },

    // 問答轉為文章（草稿或直接發布）
    async questionToArticle(qid, { title, tagIds, publish }) {
      adminUid();
      const qRef = doc(db, 'questions', qid);
      const qs = await getDoc(qRef);
      if (!qs.exists()) throw new Error('找不到提問');
      const q = qs.data();
      if (q.status !== 'answered' || !q.answerHtml) throw new Error('請先回覆此提問');
      if (q.publishedArticleId) throw new Error('此提問已轉為文章');
      const { tags } = await readIndex();
      tagIds = [...new Set(tagIds || [])].filter(t => tags[t]).slice(0, 20);
      title = String(title || q.content).trim().slice(0, 120) || '語文問答';
      const bodyHtml = cleanHtml(`<blockquote><p>${escapeHtml(q.content).replace(/\r?\n/g, '<br>')}</p></blockquote>\n${q.answerHtml}`);
      const slug = await uniqueSlug(slugify(title));
      const ref = doc(col('articles'));
      const summary = String(q.content).slice(0, 120);
      const publishedAt = publish ? serverTimestamp() : null;
      const batch = writeBatch(db);
      batch.set(ref, { title, slug, summary, bodyHtml, status: publish ? 'published' : 'draft', tagIds, sourceQuestionId: qid,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), publishedAt });
      batch.update(qRef, { publishedArticleId: ref.id });
      if (publish) idxSet(batch, { items: { [ref.id]: indexEntry({ title, slug, summary, bodyHtml, tagIds }, publishedAt) } });
      await batch.commit();
      return ref.id;
    },

    /* ---------- 儀表板 ---------- */
    async getStats() {
      const count = q => getCountFromServer(q).then(s => s.data().count);
      const today = dayKey();
      const days = Array.from({ length: 14 }, (_, i) => dayKey(new Date(Date.now() - i * 86400000)));
      const [index, drafts, pending, totalVisits, viewsSum, viewDocs, ...perDay] = await Promise.all([
        readIndex(),
        count(query(col('articles'), where('status', '==', 'draft'))),
        count(query(col('questions'), where('status', '==', 'pending'))),
        count(col('visits')),
        getAggregateFromServer(col('articleViews'), { total: sum('count') }).then(s => s.data().total || 0),
        getDocs(col('articleViews')),
        ...days.map(d => count(query(col('visits'), where('day', '==', d)))),
      ]);
      const views = new Map(viewDocs.docs.map(d => [d.id, d.data().count || 0]));
      const articleViews = Object.entries(index.items)
        .map(([id, it]) => ({ id, title: it.title, slug: it.slug, viewCount: views.get(id) || 0, publishedAt: toMs(it.publishedAt) }))
        .sort((a, b) => b.viewCount - a.viewCount || (b.publishedAt || 0) - (a.publishedAt || 0));
      return {
        publishedCount: Object.keys(index.items).length, draftCount: drafts, pendingQuestions: pending,
        totalVisits, todayVisits: perDay[days.indexOf(today)] || 0, totalViews: viewsSum,
        articleViews, visitsByDay: days.map((d, i) => ({ day: d, visits: perDay[i] })).reverse(),
      };
    },
  };
}

try {
  window.YuwenAdmin = createAdminData(window.FIREBASE_CONFIG);
} catch (e) {
  window.YuwenAdminError = e;
}
