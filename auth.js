// 假的 Firebase Auth：可由測試設定使用者（self.__FAKE.users）
const F = (self.__FAKE = self.__FAKE || {});
F.users = F.users || [];
const auth = (F.auth = { currentUser: null, _l: new Set() });
const notify = () => auth._l.forEach(cb => setTimeout(() => cb(auth.currentUser), 0));
let anon = 0;

export const getAuth = () => auth;
export function onAuthStateChanged(a, cb) {
  a._l.add(cb); setTimeout(() => cb(a.currentUser), 0);
  return () => a._l.delete(cb);
}
export async function signInWithEmailAndPassword(a, email, password) {
  const u = F.users.find(x => x.email === email);
  if (!u || u.password !== password) throw Object.assign(new Error('bad credential'), { code: 'auth/invalid-credential' });
  a.currentUser = { uid: u.uid, email: u.email, isAnonymous: false }; notify();
  return { user: a.currentUser };
}
export async function signInAnonymously(a) {
  a.currentUser = { uid: 'anon' + (++anon), email: null, isAnonymous: true }; notify();
  return { user: a.currentUser };
}
export async function signOut(a) { a.currentUser = null; notify(); }
