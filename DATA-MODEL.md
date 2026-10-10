# 語文辨正（Firebase 版）資料結構與安全設計

整站為純靜態 HTML（可放 GitHub Pages）。後端只有 Firebase：Authentication + Firestore（+ App Check）。不使用 Cloud Functions，維持免費 Spark 方案。

## 集合一覽

| 路徑 | 用途 | 誰能讀 | 誰能寫 |
|---|---|---|---|
| `admins/{uid}` | 管理員白名單（在 Console 手動建立） | 本人 | 無（僅 Console） |
| `meta/index` | **前台索引**：已發布文章清單＋全部標籤（單一文件） | 所有人 | 管理員 |
| `articles/{id}` | 文章本體（含草稿） | 已發布者所有人；全部為管理員 | 管理員（欄位驗證） |
| `articleViews/{articleId}` | 單篇瀏覽次數 `{count}` | 所有人 | 訪客只能 +1（已發布文章） |
| `visits/{YYYYMMDD_uid}` | 全站造訪，每位訪客每日一筆 | 管理員 | 訪客只能建立自己的當日文件 |
| `questions/{id}` | 訪客提問與管理員回覆 | 管理員 | 訪客只能「新增」（欄位驗證＋冷卻）；其餘管理員 |
| `rateLimits/{uid}` | 提問冷卻（10 分鐘） | 管理員 | 本人，且須超過冷卻 |
| `drafts/{adminUid_articleId}` | 編輯器每 30 秒自動暫存 | 該管理員 | 該管理員 |

### `meta/index`
```
{
  updatedAt: timestamp,
  tags:  { <tagId>: { name, slug } },
  items: { <articleId>: { title, slug, summary(≤120字), excerpt(≤150字內文), tagIds[], publishedAt } }
}
```
- 標籤的唯一資料來源就是 `tags` 這個欄位（沒有獨立的 tags 集合）。新增、改名：改此欄位；合併、刪除：同一個批次更新此欄位與所有受影響文章的 `tagIds`（含草稿）。
- 發布／下架／改標題或標籤時，管理員端以**同一個 writeBatch** 同時更新 `articles/{id}` 與 `meta/index.items.<id>`（用欄位路徑更新，下架用 `deleteField()`），不需先讀取。
- 前台首頁、搜尋、標籤過濾、標籤文章數**全部只讀這 1 份文件**（`onSnapshot` 即時同步），點進文章才讀 1 份 `articles`。

### `articles/{id}`
`title, slug, summary, bodyHtml, status('draft'|'published'), tagIds[], sourceQuestionId?, createdAt, updatedAt, publishedAt?`
- `createdAt`／`updatedAt` 必須是伺服器時間；`bodyHtml` 上限 20 萬字元（文件上限 1 MiB）。
- `slug` 唯一性由管理員端在寫入前查詢檢查（規則無法保證唯一）。已發布文章不改 slug。
- 前台以 `where('slug','==',x), where('status','==','published')` 取文章；**查詢必須帶 `status == 'published'`**，否則規則會拒絕。

### `questions/{id}`
新增時只允許 `content(5~1000字), askerName?(≤40), contact?(≤100), status:'pending', createdAt`。
回覆後管理員寫入 `answerHtml, status:'answered', answeredAt, publishedArticleId?`。

## 提問冷卻怎麼運作（軟性限流）
訪客以**匿名登入**取得 uid。送出提問時，前端用同一個 `writeBatch` 寫兩份文件：`rateLimits/{uid}.lastAt = serverTimestamp()` 與 `questions/{id}`。規則要求：兩者同批、`lastAt` 等於伺服器時間、且距上次超過 10 分鐘。再加上蜜罐欄位與 App Check。

## 防護能做到與做不到的
- 擋得住：直接打 API 的亂寫、改欄位／超長內容、同一匿名身分連續灌水、改別人的資料、冒充管理員。
- **擋不住**：有心人反覆建立新的匿名帳號。App Check（reCAPTCHA）會提高成本，但不是絕對。
- 瀏覽次數、造訪人次因同樣原因**僅供參考**。
- **免費額度是真正的天花板**：Spark 方案有每日讀寫次數上限（約數萬次級，數字以官方頁面為準）。被灌爆時網站會當日暫時無法寫入／讀取。設計上已盡量省讀取（首頁 1 次），建議在 Console 設定用量提醒。

## 已知限制
- 關鍵字搜尋範圍是「標題＋摘要＋內文前 150 字＋標籤名」，不含全文（Firestore 沒有全文搜尋；全文需額外服務）。
- `meta/index` 受單一文件 1 MiB 限制，粗估可容納約 1,500～2,000 篇；超過需分片。
- 前台文章列表不顯示瀏覽次數（避免每張卡片多讀 1 次）；僅在文章頁與後台顯示。

## Console 設定清單
1. 建立專案，啟用 Firestore（位置建議 `asia-east1`）。
2. Authentication → 登入方式：啟用「電子郵件/密碼」與「匿名」。
3. 建立管理員：Authentication 新增使用者 → 複製 UID → Firestore 手動建立 `admins/<UID>`（內容隨意，例如 `createdAt`）。
   - 即使有人自行註冊，沒在白名單內也沒有任何權限。**不建議**去關閉「允許建立新帳號」開關：我無法確認它是否會連匿名登入一起擋掉。
4. Authentication → 設定 → 授權網域：加入 `junbin0913.github.io`（及自訂網域）。
5. App Check：註冊網頁應用程式（reCAPTCHA），先以「監控」模式觀察，確認正常後再對 Firestore 與 Authentication 啟用強制。
6. Google Cloud Console → API 金鑰：為網頁金鑰加上 HTTP referrer 限制（只允許你的網域）。`firebaseConfig` 本來就是公開設定，保護來自規則與 App Check，不靠藏起來。
7. 部署規則與索引：`firebase deploy --only firestore`。
8. 本機測試規則：`npm install && npm run test:rules`（需 Java）。

## 目前驗證狀態
- `firestore.rules` 與 `tests/rules.test.js` **尚未在模擬器實際執行**：建置環境無法下載 Firestore 模擬器。請務必在本機跑過 `npm run test:rules`，並依結果調整，再部署。
