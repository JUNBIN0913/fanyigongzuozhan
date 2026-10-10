(() => {
  'use strict';
  const data = window.YuwenAdmin;
  const form = document.getElementById('login');
  const err = document.getElementById('err');
  if (!data) { err.textContent = '後台尚未完成設定：' + (window.YuwenAdminError?.message || '資料服務未載入'); form.querySelector('button').disabled = true; return; }

  const reason = new URLSearchParams(location.search).get('e');
  if (reason === 'noadmin') err.textContent = '此帳號沒有後台管理權限。';

  const MESSAGES = {
    'auth/invalid-credential': '帳號或密碼錯誤', 'auth/wrong-password': '帳號或密碼錯誤', 'auth/user-not-found': '帳號或密碼錯誤',
    'auth/invalid-email': '電子郵件格式不正確', 'auth/too-many-requests': '嘗試次數過多，請稍後再試',
    'auth/network-request-failed': '網路連線失敗，請檢查網路後再試', 'auth/user-disabled': '此帳號已被停用',
  };

  // 已登入且具管理員身分就直接進後台；登入但不在白名單則登出並提示
  data.onAuth(user => {
    if (!user) return;
    if (user.isAdmin) location.replace('index.html');
    else { err.textContent = '此帳號沒有後台管理權限。'; data.signOut(); form.querySelector('button').disabled = false; }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await data.signIn(form.email.value, form.password.value);
    } catch (ex) {
      err.textContent = MESSAGES[ex.code] || '登入失敗，請稍後再試';
      form.password.value = '';
      btn.disabled = false;
    }
  });
})();
