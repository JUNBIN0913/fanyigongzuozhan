// 記憶體版的 Firestore 假實作（僅涵蓋後台資料層用到的 API），含一部分「規則形狀」檢查：
// 文章欄位驗證、updatedAt/createdAt 伺服器時間、drafts 文件 ID 前綴、批次寫入的 isAdmin() 呼叫上限。
// 這能抓出寫入內容與 firestore.rules 不一致的問題，但不能取代真正的模擬器測試。
const F = (self.__FAKE = self.__FAKE || {});
const S = (F.fs = { docs: new Map(), listeners: new Set(), last: 0, strictRules: true });
let idn = 0;

export class Timestamp { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
F.Timestamp = Timestamp;
export const serverTimestamp = () => ({ __s: 'ts' });
export const deleteField = () => ({ __s: 'del' });
export const increment = n => ({ __s: 'inc', n });
export const sum = field => ({ __agg: 'sum', field });
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const initializeFirestore = () => ({ fake: 'db' });
export const getFirestore = () => ({ fake: 'db' });

const isSent = v => v && typeof v === 'object' && typeof v.__s === 'string';
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !isSent(v);
const clone = v => v instanceof Timestamp ? new Timestamp(v.ms) : Array.isArray(v) ? v.map(clone)
  : isPlain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;
const DEL = Symbol('del');

function resolve(v, existing, now) {
  if (isSent(v)) {
    if (v.__s === 'ts') return new Timestamp(now);
    if (v.__s === 'inc') return (typeof existing === 'number' ? existing : 0) + v.n;
    if (v.__s === 'del') return DEL;
  }
  if (v instanceof Date) return new Timestamp(v.getTime());
  if (Array.isArray(v)) return v.map(x => resolve(x, undefined, now));
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, existing?.[k], now)]).filter(([, x]) => x !== DEL));
  return v;
}
function deepMerge(target, patch, now) {
  for (const [k, v] of Object.entries(patch)) {
    if (isSent(v) && v.__s === 'del') { delete target[k]; continue; }
    if (isPlain(v)) target[k] = deepMerge(isPlain(target[k]) ? target[k] : {}, v, now);
    else target[k] = resolve(v, target[k], now);
  }
  return target;
}
function setPath(obj, dotted, v, now) {
  const parts = dotted.split('.'); let o = obj;
  for (const p of parts.slice(0, -1)) o = (o[p] = isPlain(o[p]) ? o[p] : {});
  const last = parts.at(-1), r = resolve(v, o[last], now);
  if (r === DEL) delete o[last]; else o[last] = r;
}

let counter = 0;
export const collection = (db, ...segs) => ({ type: 'col', path: segs.join('/') });
export function doc(a, ...segs) {
  if (a.type === 'col') { const id = segs[0] || `auto${++counter}`; return { type: 'doc', path: `${a.path}/${id}`, id, col: a.path }; }
  const parts = segs.join('/').split('/');
  return { type: 'doc', path: parts.join('/'), id: parts.at(-1), col: parts.slice(0, -1).join('/') };
}
export const query = (c, ...cons) => ({ type: 'query', col: c.path, cons });
export const where = (f, op, v) => ({ k: 'where', f, op, v });
export const orderBy = (f, dir = 'asc') => ({ k: 'order', f, dir });
export const limit = n => ({ k: 'limit', n });

const inCol = (path, col) => path.startsWith(col + '/') && !path.slice(col.length + 1).includes('/');
const msOf = v => v instanceof Timestamp ? v.ms : v;
function runQuery(q) {
  const colPath = q.type === 'col' ? q.path : q.col;
  const cons = q.type === 'col' ? [] : q.cons;
  let rows = [...S.docs.entries()].filter(([p]) => inCol(p, colPath)).map(([p, d]) => ({ path: p, data: d }));
  for (const c of cons.filter(c => c.k === 'where')) {
    rows = rows.filter(({ data }) => {
      const x = data[c.f];
      if (c.op === '==') return x instanceof Timestamp ? x.ms === msOf(c.v) : JSON.stringify(x) === JSON.stringify(c.v);
      if (c.op === 'array-contains') return Array.isArray(x) && x.includes(c.v);
      throw new Error('fake: unsupported op ' + c.op);
    });
  }
  for (const c of cons.filter(c => c.k === 'order').reverse()) {
    rows.sort((a, b) => {
      const x = msOf(a.data[c.f]), y = msOf(b.data[c.f]);
      const r = x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0;
      return c.dir === 'desc' ? -r : r;
    });
  }
  const lim = cons.find(c => c.k === 'limit');
  return lim ? rows.slice(0, lim.n) : rows;
}
const refOf = path => { const parts = path.split('/'); return { type: 'doc', path, id: parts.at(-1), col: parts.slice(0, -1).join('/') }; };
const snapDoc = (path, data) => ({ id: path.split('/').pop(), ref: refOf(path), exists: () => data != null, data: () => (data == null ? undefined : clone(data)), metadata: { fromCache: false } });
const snapQuery = q => {
  const docs = runQuery(q).map(r => snapDoc(r.path, r.data));
  return { docs, empty: docs.length === 0, size: docs.length, metadata: { fromCache: false } };
};
const snapshotOf = t => t.type === 'doc' ? snapDoc(t.path, S.docs.get(t.path)) : snapQuery(t);

export const getDoc = async ref => snapshotOf(ref);
export const getDocs = async q => snapQuery(q);
export const getCountFromServer = async q => ({ data: () => ({ count: runQuery(q).length }) });
export const getAggregateFromServer = async (q, spec) => ({
  data: () => Object.fromEntries(Object.entries(spec).map(([k, a]) => [k, runQuery(q).reduce((s, r) => s + (r.data[a.field] || 0), 0)])),
});

export function onSnapshot(target, ...args) {
  const next = args.find(a => typeof a === 'function');
  const l = { target, next };
  S.listeners.add(l);
  setTimeout(() => S.listeners.has(l) && next(snapshotOf(target)), 0);
  return () => S.listeners.delete(l);
}
const notifyAll = () => setTimeout(() => S.listeners.forEach(l => l.next(snapshotOf(l.target))), 0);
F.notify = notifyAll;

/* ---------- 規則形狀檢查（對應 firestore.rules 的 articles / drafts 與批次上限）---------- */
const deny = msg => Object.assign(new Error('Missing or insufficient permissions. (fake rules: ' + msg + ')'), { code: 'permission-denied' });
function validArticle(d) {
  const allowed = ['title', 'slug', 'summary', 'bodyHtml', 'status', 'tagIds', 'sourceQuestionId', 'createdAt', 'updatedAt', 'publishedAt'];
  const required = ['title', 'slug', 'summary', 'bodyHtml', 'status', 'tagIds', 'createdAt', 'updatedAt'];
  const keys = Object.keys(d);
  if (!keys.every(k => allowed.includes(k))) throw deny('articles: 多餘欄位 ' + keys.filter(k => !allowed.includes(k)));
  if (!required.every(k => keys.includes(k))) throw deny('articles: 缺少欄位 ' + required.filter(k => !keys.includes(k)));
  if (typeof d.title !== 'string' || !d.title || d.title.length > 120) throw deny('articles.title');
  if (typeof d.slug !== 'string' || !d.slug || d.slug.length > 120) throw deny('articles.slug');
  if (typeof d.summary !== 'string' || d.summary.length > 300) throw deny('articles.summary');
  if (typeof d.bodyHtml !== 'string' || d.bodyHtml.length > 200000) throw deny('articles.bodyHtml');
  if (!['draft', 'published'].includes(d.status)) throw deny('articles.status');
  if (!Array.isArray(d.tagIds) || d.tagIds.length > 20) throw deny('articles.tagIds');
  if ('sourceQuestionId' in d && d.sourceQuestionId != null && typeof d.sourceQuestionId !== 'string') throw deny('articles.sourceQuestionId');
  if ('publishedAt' in d && d.publishedAt != null && !(d.publishedAt instanceof Timestamp)) throw deny('articles.publishedAt');
}
function checkRules(ops, now) {
  if (!S.strictRules) return;
  if (ops.length > 500) throw deny('批次超過 500 筆');
  const u = F.auth?.currentUser;
  const admin = u && !u.isAnonymous;
  if (ops.length > 20) throw deny(`批次 ${ops.length} 筆寫入，isAdmin() 的 exists() 呼叫會超過 20 次上限`);
  for (const op of ops) {
    const [c, id] = op.path.split('/');
    if (!admin) throw deny('需要管理員登入');
    if (c === 'articles' && op.type !== 'delete') {
      validArticle(op.after);
      if (op.type === 'create') {
        if (msOf(op.after.createdAt) !== now || msOf(op.after.updatedAt) !== now) throw deny('articles: createdAt/updatedAt 必須為伺服器時間');
      } else {
        if (msOf(op.after.createdAt) !== msOf(op.before.createdAt)) throw deny('articles: createdAt 不可變更');
        if (msOf(op.after.updatedAt) !== now) throw deny('articles: updatedAt 必須為伺服器時間');
      }
    }
    if (c === 'drafts' && !id.startsWith(u.uid + '_')) throw deny('drafts: 文件 ID 必須以自己的 uid 開頭');
  }
}

/* ---------- 寫入（單筆與批次共用同一條路徑，確保原子性）---------- */
function commitOps(rawOps) {
  const now = (S.last = Math.max(Date.now(), S.last + 1));
  const draft = new Map();
  const cur = p => (draft.has(p) ? draft.get(p) : S.docs.get(p));
  const applied = [];
  for (const o of rawOps) {
    const before = cur(o.ref.path);
    let after;
    if (o.t === 'delete') after = null;
    else if (o.t === 'set') after = o.merge ? deepMerge(clone(before || {}), o.data, now) : resolve(o.data, undefined, now);
    else if (o.t === 'update') {
      if (!before) throw Object.assign(new Error('No document to update: ' + o.ref.path), { code: 'not-found' });
      after = clone(before);
      for (const [k, v] of Object.entries(o.data)) setPath(after, k, v, now);
    }
    draft.set(o.ref.path, after);
    applied.push({ type: o.t === 'delete' ? 'delete' : before ? 'update' : 'create', path: o.ref.path, before, after });
  }
  checkRules(applied, now);
  for (const [p, d] of draft) d == null ? S.docs.delete(p) : S.docs.set(p, d);
  F.writes = (F.writes || []).concat([applied.map(a => `${a.type}:${a.path}`)]);
  notifyAll();
}
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push({ t: 'set', ref, data, merge: !!opts?.merge }); return this; },
    update(ref, data) { ops.push({ t: 'update', ref, data }); return this; },
    delete(ref) { ops.push({ t: 'delete', ref }); return this; },
    commit: async () => commitOps(ops),
  };
}
export const setDoc = async (ref, data, opts) => commitOps([{ t: 'set', ref, data, merge: !!opts?.merge }]);
export const updateDoc = async (ref, data) => commitOps([{ t: 'update', ref, data }]);
export const deleteDoc = async ref => commitOps([{ t: 'delete', ref }]);
