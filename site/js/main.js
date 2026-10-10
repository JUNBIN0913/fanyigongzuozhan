(async () => {
  try {
    const [{ fb }, { createApi }] = await Promise.all([import('./fb.js'), import('./data.js')]);
    window.YuwenApp.start(createApi(fb));
  } catch (e) {
    console.error(e);
    const app = document.getElementById('app');
    app.textContent = e && /尚未設定 Firebase/.test(e.message) ? e.message : '網站暫時無法載入，請稍後再試。';
  }
})();
