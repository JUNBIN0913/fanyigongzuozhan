# 語文辨正（Firebase 版）

純靜態網站（`public/`），資料與登入由 Firebase 提供，可直接部署到 GitHub Pages。
設計與規則說明見 `DATA-MODEL.md`。

## 目前進度
- ✅ 資料結構、Firestore 安全規則（`firestore.rules`，**尚未在模擬器實測**）
- ✅ 前台（`public/index.html`、`js/app.js`）
- ✅ 後台：登入、儀表板、文章列表（發布／下架／刪除）、標籤管理（新增／改名／合併／刪除）、提問審核（回覆／封存／轉為文章）
- ✅ 後台 **Ribbon 編輯器**：灰底白紙頁面視圖、三個頁籤（文字格式／插入與標籤／版面設定）、每 30 秒自動暫存與還原、Ctrl+S、發布／下架、「檢視前台」連結、儲存時消毒

**編輯器的已知限制**
- 排版指令（粗體、段落樣式、清單…）使用瀏覽器的 `document.execCommand`。測試環境（jsdom）不支援它，只能驗證「按鈕送出了正確指令」，**實際排版效果請在真瀏覽器確認**。
- 自動暫存只保存標題與內文（不含摘要與標籤）；還原時只還原這兩項。
- 暫存的離開補存是「盡力而為」：分頁直接關閉時，Firestore 的寫入不一定來得及送出（會有離開確認提示）。
- 目前沒有文字對齊按鈕（前台 CSS 已支援 `ta-center`／`ta-right` 類別）。

## 第一次使用後台
1. Firebase Console → Authentication → 新增使用者（電子郵件／密碼）。
2. 複製該使用者的 UID，到 Firestore 手動建立文件 `admins/<UID>`（內容隨意）。
3. 開啟 `你的網址/admin/login.html` 登入。只有在白名單內的帳號能進後台；真正的權限由 `firestore.rules` 把關，登入頁的檢查只是使用者體驗。
4. 第一次發布文章時，系統會自動建立前台索引文件 `meta/index`。

## ⚠️ 資料夾裡有兩份前台實作，請二選一
- `public/`：本次建置的版本。Firebase SDK 以 esbuild 打包成自行託管的 `public.bundle.js`（約 520 KB，gzip 後約 130 KB），需要 `npm run build`。有 jsdom 介面測試（`tests/ui-public.test.js`）。GitHub Pages 工作流程發布的是這個資料夾。
- `site/`：**不是**本次建置產生的，是之後出現在此資料夾的另一份實作（檔案時間為 2026-10-08 18:39–18:42，含 `tests/data.test.js`）。Firebase SDK 直接從 Google CDN 載入，不需要打包工具；設定檔為 `site/js/firebase-config.js`。
兩者使用同一套資料結構與 `firestore.rules`。請擇一作為正式版並刪除另一份，以免日後維護兩份。

## 檔案
```
public/            ← 要部署的網站（含已打包的 js/public.bundle.js）
  admin/           ← 後台（js/admin.bundle.js 為已打包的資料層）
  js/config.js     ← 填入你的 Firebase 設定（前後台共用）
  js/app.js        ← 前台畫面邏輯（只依賴 window.YuwenData 介面）
  vendor/purify.min.js   ← DOMPurify（自行託管，用於文章內文消毒）
src/               ← Firebase 資料層原始碼（fb-core.js、public-adapter.js、admin-adapter.js）
tests/             ← admin-adapter（資料層）、ui-public、ui-admin、bundle，以及 rules（需模擬器）；tests/fakes 是假的 Firebase 模組
```

## 開始使用
1. 依 `DATA-MODEL.md` 的「Console 設定清單」建立 Firebase 專案、啟用 Auth 與 Firestore。
2. 編輯 `public/js/config.js`，填入網頁應用程式的 SDK 設定（這些是公開資訊）。
3. 部署規則：`npx firebase deploy --only firestore`（先 `npx firebase login`、`npx firebase use <專案ID>`）。
4. 本機預覽：`npm install && npm run serve` → http://localhost:8000
   （使用 App Check 時，localhost 會印出除錯權杖，需在 Console 登錄。）
5. 修改 `src/` 後重新打包：`npm run build`，並把更新後的 `public/js/public.bundle.js` 一併提交。

## 部署到 GitHub Pages
1. 把整個專案推到 GitHub（`main` 分支）。
2. Repo → Settings → Pages → Source 選 **GitHub Actions**。
3. 推送後 `.github/workflows/pages.yml` 會把 `public/` 發布到 `https://junbin0913.github.io/<repo>/`。
4. 把該網域加入 Firebase Authentication 的「授權網域」，並在 App Check／API 金鑰限制中允許它。

## 測試
```
npm test              # 資料層 + 前台介面 + 後台介面 + 打包檔冒煙（不需要網路或模擬器）
npm run test:rules    # Firestore 規則（需要 Java 與模擬器；請在本機執行）
```
- `admin-adapter` 與 `ui-admin` 用的是**真正的 `src/admin-adapter.js`**，搭配記憶體版假 Firestore（`tests/fakes/firestore.js`）。假實作內建一部分規則形狀檢查（文章欄位、伺服器時間、`drafts` 前綴、批次寫入 ≤ 20 次 `isAdmin()` 呼叫），所以寫入內容與規則不一致時會被抓到。
- 但它**不是**真正的 Firestore：索引、查詢細節、離線快取、Auth、App Check 與規則的完整語意都沒有驗證。請用你的專案實際走一遍（登入、發布、改標籤、合併、提問、冷卻）。
