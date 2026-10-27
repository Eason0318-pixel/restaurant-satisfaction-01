# 

# 家人餐廳評分簿（restaurant-satisfaction-01）

給 Claude Code 的專案說明。每次開始工作前先讀完這份檔案。請一律使用**繁體中文**與使用者溝通（程式碼、專有名詞、英文縮寫可保留原文）。

## 一、這個專案是什麼

一個給家人共用的「餐廳單點品項評分頁」。每個家人用手機或電腦打開同一個網址，替每間餐廳的每個品項選「超好吃／好吃／普通」，並可留下備註；資料存在 Google 試算表，所有人看到同一份。

* 線上網址：https://eason0318-pixel.github.io/restaurant-satisfaction-01/
* GitHub 倉庫：`Eason0318-pixel/restaurant-satisfaction-01`（公開倉庫，用 GitHub Pages 的 main 分支根目錄發佈）
* 前端：單一檔案 `index.html`（純 HTML＋原生 JS，沒有框架、沒有建置步驟）
* 後端（資料庫）：Google 試算表＋Google Apps Script 網頁應用程式（原始碼在 `backend/Code.gs`，要由使用者手動貼進 Apps Script）
* Apps Script 網址（`/exec`）：`https://script.google.com/macros/s/AKfycbzFvA2VTw\_35WXoQVMAmzImIGqduM93SeCfqy3CQKOUCB7ExuUNQ3rRqjsqTlqjGBjj/exec`

## 二、檔案結構

```
index.html        前端頁面（發佈到 GitHub Pages，檔名必須全小寫）
backend/Code.gs   Apps Script 後端原始碼（本機只是備份，不會自動部署）
CLAUDE.md         本檔
.gitignore
menus/            各餐廳菜單截圖（參考用，已列入 .gitignore，不上傳）
```

## 三、最重要的規則（務必遵守）

1. **`index.html` 裡的 `var API\_URL = "…/exec";` 絕對不能被改成空字串後推送。** 空字串會讓線上頁面變成「只存在單一裝置」的離線模式，家人就看不到共用資料。

   * 每次修改前先確認目前的值：`grep -n "var API\_URL" index.html`
   * 如果使用者給了一份新的 `index.html`（API\_URL 是空的），先從 `git show HEAD:index.html | grep "var API\_URL"` 取出舊網址，填回新檔再提交。
   * 推送前再檢查一次：`grep "var API\_URL" index.html` 必須是 `https://script.google.com/macros/s/…/exec`，且符合 `^https://script.google.com/macros/s/\[A-Za-z0-9\_-]+/exec$`。
2. **檔名必須是全小寫 `index.html`**，否則 GitHub Pages 會 404（曾經發生過）。
3. **不要改資料欄位與後端通訊格式**，除非使用者明確要求，因為線上已有家人輸入的資料。改了後端，要提醒使用者：先到 Apps Script「管理部署作業 → 編輯（鉛筆）→ 新版本」更新（網址不變），再推送前端。**不要選「新增部署作業」，那會產生新網址，舊網址就失效。**
4. **不要把任何密碼、token、金鑰寫進專案或提交紀錄。** `/exec` 網址本身本來就是公開的（在公開頁面裡），可以放。
5. 推送前先在本機驗證（見第七節）。推送後提醒使用者：GitHub Pages 最多約 10 分鐘才會更新，用 Ctrl+F5 強制重整。
6. 提交訊息用中文，簡短說明改了什麼（例如「新增大師兄風格」「修正享鴨對齊」）。

## 四、資料模型與同步機制

* 試算表分頁：`restaurants`（id,name,createdAt）、`items`（id,name,createdAt,restaurantId）、`votes`（itemId,member,rating,note,updatedAt）、`members`（name）。
* 舊資料（`restaurantId` 空白的品項）一律歸入預設餐廳「茶六」（id=`r\_chaliu`）。
* 後端：`doGet()` 回傳整份狀態 JSON；`doPost(e)` 以 `Content-Type: text/plain` 接收操作（避免 CORS 預檢），支援 addRestaurant / renameRestaurant / delRestaurant（拒絕刪最後一間）/ addItem / delItem / setVote / import。使用 LockService、輸入驗證、文字欄位格式 `@`（防公式注入），上限：餐廳 30、品項 500、成員 30、投票 8000。
* 前端：樂觀更新＋佇列送出；沒有待送資料時採用伺服器狀態；每 20 秒及頁面回到前景時重新整理；留言身分視窗開著時不刷新；`API\_URL` 為空時為「只存本機」模式。
* localStorage 鍵：`meat-rating-v2`（資料）、`meat-rating-uploaded`（舊資料是否已匯入）、`meat-rating-current`（目前餐廳）。
* 網址 hash（`#餐廳id`）決定目前顯示哪間餐廳。

## 五、版面與主題（風格）系統

* 左側選單列出餐廳（桌機 230px 固定側欄；≤820px 變成抽屜，按「☰ 餐廳」開啟）。
* 每間餐廳可有自己的風格。風格定義在 `index.html` 的 `THEMES` 物件：`THEMES = { "關鍵字": { vars:{CSS 變數}, css:"額外 CSS", fontUrl:"Google Fonts 網址" } }`。
* **比對規則：** 餐廳名稱「完全相同」或「包含」關鍵字就套用，所以「享鴨烤鴨店」也吃得到「享鴨」。餐廳若改名，要同步檢查關鍵字。沒有設定風格的餐廳使用預設（茶六的深綠）。
* `fontUrl` 只允許 `https://fonts.googleapis.com/`，其他網址不會載入。
* 可用 CSS 變數：`--bg --paper --field --add-bg --line --ink --muted --gold --danger --accent --accent-deep --accent-mid --neutral --hover --on-accent --band --on-band --band-sub --band-warn --sec-head --on-sec --side-bg --side-active --on-side-active --scrim --toast-bg --toast-fg --radius --font-body --font-display`。
* 新增風格的流程：使用者提供菜單圖 → 取色與字體氣質 → 新增 `THEMES` 項目 → 本機截圖（桌機 1200px、手機 390px）→ 確認與其他餐廳**對齊**（見下）→ 提交推送。

### 已完成的風格

* **茶六（預設）**：深綠＋奶油色，襯線體（Noto Serif TC）。`--accent:#2f5d4a`、`--accent-deep:#1f4434`、`--bg:#f5f2e9`。
* **享鴨（關鍵字「享鴨」）**：朱紅底、白色紙面、桃色（#f8b9a0）標題塊＋橘紅（#e9482b）標語塊、黑色粗明體、膠囊外框標籤、點線分隔。
* **大師兄銷魂麵鋪（關鍵字「大師兄」）**：酒紅玫瑰（#a24d5c）頁首、奶白紙面、細明體、細線框標題、點線分隔、方角。

### 對齊規則（曾踩過的坑）

* 頁首高度要一致（目前為 186px，已拿掉標語行），否則側欄與內容區位置在不同餐廳間會上下跳動。自訂標題塊時注意行高與內距。
* 頁面固定保留捲軸（`html{overflow-y:scroll}`），否則有無捲軸會讓版面左右跳動約 8px。
* 享鴨的橘紅標語塊已隨「標語行」一起拿掉；標題塊寬度為 260px。
* 新增風格後，用實際量測比對各餐廳的 `#side`、`main`、`.section-head` 位置是否相同。

## 六、目前進度（截至 2026-10-27）

已完成：

* 純 HTML 頁面＋Google 試算表共用資料庫（家人免登入）。
* 多餐廳＋左側選單＋手機抽屜。
* 每間餐廳獨立風格（茶六、享鴨、大師兄銷魂麵鋪）。
* 留言身分選擇（身分會保留重複使用）、各選項下方顯示人數與名字、備註。
* 版面對齊修正（頁首高度、捲軸、標題塊寬度）。

待辦／可選：

* 使用者之後會陸續新增餐廳，每次會附菜單圖，請依第五節流程做風格。
* Notion「美食地圖 → 茶六 → 茶六 肉類評分」資料庫裡還有 3 筆舊的套餐資料，使用者尚未決定是否刪除（先詢問，不要擅自刪）。
* 兩個舊的 Claude artifact（chaliu\_rating、menu\_rating 本機版）已作廢，使用者尚未決定是否刪除。
* 專案裡若還有 `menu\_rating.html`、`chaliu\_rating.html` 等舊檔，確認後可刪除，只保留 `index.html`。
* 建議：定期匯出或備份 Google 試算表（資料只存在那裡）。

## 七、本機驗證方式

* 語法：把 `<script>` 內容存成 `.js` 後 `node --check`。
* 功能：用 jsdom 載入 `index.html`，檢查新增餐廳、切換風格、新增品項、投票、離線模式等。
* 畫面：用 Playwright（chromium）對桌機 1200px 與手機 390px 截圖，並量測 `#side`、`main`、`.section-head`、`#restTitle`、`.tagline` 的位置，確認不同餐廳之間對齊、無橫向溢出。
* 線上驗證：推送後等待部署，再用瀏覽器開網址確認。

## 八、與使用者合作的方式

* 使用者不是工程師，說明請用白話、一步一步，並指出要點哪裡。
* 每次修改後說明：改了什麼、有沒有動到 `API\_URL`、有沒有需要使用者去 Apps Script 做事。
* 後端（Apps Script）不能由 Claude Code 直接部署，只能給程式碼並教使用者貼上與重新部署。
* 流程：修改 → 本機驗證 → `git add index.html` → `git commit`（中文訊息）→ `git push` → 提醒等待部署與強制重整。


## 九、近期功能備忘

* 評分選項共四個：超好吃(必點)／好吃／普通／有點雷(下次不會點)。存進試算表的值是「超好吃」「好吃」「普通」「有點雷」（括號字只是按鈕上的小字，不可寫進資料）。後端 `RATINGS` 白名單必須包含這四個。
* 備註列有「編輯備註」與「刪除備註」；編輯沿用 `setVote`（保留原評價，只改備註），不需要改後端。
* 手機版：從螢幕左側（約 30% 寬度內）往右滑開側邊欄，開著時往左滑關閉；加到主畫面（standalone）時頁首會多留頂端空間避開狀態列。
* 已做成 PWA（`manifest.webmanifest`＋三個圖示），刻意不加 Service Worker，避免家人看到舊版畫面。
