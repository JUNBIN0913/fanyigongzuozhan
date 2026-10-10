// 以假的 Firebase 模組（tests/fakes）打包真正的資料層原始碼，供測試使用
const path = require('path');
const esbuild = require('esbuild');
const fakes = path.join(__dirname, '..', 'fakes');
module.exports = function buildFake(entry) {
  const r = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', '..', entry)], bundle: true, format: 'iife', target: 'es2020', write: false, logLevel: 'error',
    alias: { 'firebase/app': `${fakes}/app.js`, 'firebase/app-check': `${fakes}/app-check.js`, 'firebase/auth': `${fakes}/auth.js`, 'firebase/firestore': `${fakes}/firestore.js` },
  });
  return r.outputFiles[0].text;
};
