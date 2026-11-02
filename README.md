# 臺灣律師懲戒案件資料庫

民間司法改革基金會（司改會，JRF）維護的律師懲戒案件資料庫。彙整歷年律師懲戒決議，逐案標註違失條文、懲戒結果與法規依據，並提供決議書全文、違失態樣分類、懲戒法規對照、統計分析與申訴管道說明。

- 網址：<https://discipline.jrf.org.tw/>
- 聯絡：contact@jrf.org.tw

本站是純靜態網站，沒有後端與資料庫伺服器，也沒有建置流程。案件檢索、篩選、統計圖表都由瀏覽器端的 JavaScript 讀取 `data/` 內的 JSON 後即時運算，直接以 GitHub Pages 部署。

## 目錄結構

```
.
├── index.html             頁面骨架、SEO 標籤（meta、Open Graph、JSON-LD 結構化資料）與各頁籤的靜態內容
├── 404.html               找不到頁面時顯示
├── favicon.svg
├── robots.txt
├── sitemap.xml
├── CNAME                  GitHub Pages 自訂網域（discipline.jrf.org.tw）
├── .nojekyll              告訴 GitHub Pages 不要跑 Jekyll，檔案原樣發布
├── assets/
│   ├── css/main.css       全站樣式
│   └── js/
│       ├── load-data.js   先下載 data/ 三份 JSON，再載入主程式
│       └── app.js         主程式：資料整理、各頁籤畫面、檢索、統計、網址錨點路由
└── data/
    ├── cases.json         主資料：懲戒案件（含決議書全文）、違失態樣、法規條文
    ├── pattern-meta.json  違失態樣的分類與說明
    └── content-meta.json  倫理規範沿革、統計數字、各地律師公會申訴方式等內容資料
```

`app.js` 與 `main.css` 內的區塊都標有 `[SECTION-ID]` 註解（例如 `[JS-LIST]`、`[CSS-HOME]`），找程式碼時直接搜尋這些標記。

## 本機預覽

頁面用 `fetch()` 讀取 `data/*.json`，直接雙擊開啟 `index.html`（`file://`）會讀不到資料，需要開一個本機網頁伺服器：

```bash
python3 -m http.server 8000
# 瀏覽器開啟 http://localhost:8000/
```

## 部署（GitHub Pages）

在 GitHub 的 repo 設定一次即可，之後推上 `main` 就會自動更新網站。

1. **Settings → Pages → Build and deployment**
   - Source：`Deploy from a branch`
   - Branch：`main`，資料夾：`/ (root)`
2. **Custom domain** 填 `discipline.jrf.org.tw`，DNS 檢查通過後勾選 **Enforce HTTPS**。
3. **DNS**：在 `jrf.org.tw` 的 DNS 新增一筆
   `discipline  CNAME  jrf-tw.github.io.`
4. 本 repo 目前是**私有**。私有 repo 要開 GitHub Pages 需要組織為付費方案（Team／Enterprise）；免費方案須將 repo 改為公開。

## 更新資料

- **新增或修正案件**：編輯 `data/cases.json`。
- **違失態樣分類與說明**：編輯 `data/pattern-meta.json`。
- **資料庫更新日期**：在 `assets/js/app.js` 搜尋 `資料庫更新日期`，手動修改。首頁的「資料更新於」會自動沿用這個日期。
- 更新資料後，把 `sitemap.xml` 的 `<lastmod>` 改成當天日期。
- 改完先依「本機預覽」開起來確認，再 commit、push。

### 編輯 JSON 的注意事項

- 三份 JSON 的排版是刻意的，**不要用程式整份讀入再重新輸出**（會改動排版與鍵的順序，也無法逐筆核對差異）。請用文字編輯器做局部修改。
  - `mapRows`／`patterns` 一筆一行；`laws` 的 `articles` 一條一行。
  - 案件的結構欄位一筆一行（方便 `grep` 找到單一案件）。
  - 只有 `ft`／`ftRev`（決議書全文）分行縮排，一行一段。
- 鍵的順序：`patterns → mapRows → sources → extraSources → laws → cases`，量最大的 `cases` 放最後。
- `schemaVersion` 必須與 `app.js` 內的 `DB_SCHEMA_VERSION`、`CONTENT_META_SCHEMA_VERSION` 一致，否則頁面會拒絕載入。
- 改完可用下列指令確認 JSON 格式正確：

  ```bash
  python3 -c "import json,glob;[json.load(open(f)) for f in glob.glob('data/*.json')];print('ok')"
  ```

### `cases[]` 欄位說明

唯一鍵是 `caseNo` + `name`（`caseNo` 不唯一，一案最多 10 人）。

| 欄位 | 說明 |
|---|---|
| `caseNo` | 原決議案號；併案以「、」相連 |
| `name` | 被付懲戒人 |
| `date` | 原決議日期 `YYYY-MM-DD` |
| `unit` | 移送機關（多個以「、」相連） |
| `decision` | 決議結果；覆審有變更寫成「原結果（覆審：新結果）」 |
| `h` | 懲戒輕重的排序權重，人工編碼，對照表見 `app.js` 的 `HC_OF` |
| `norm` | `[[顯示文字, 法典鍵, 條號], …]`，每項固定 3 個元素。歷史條文（收錄版本前已刪除者）條號加後綴「-原」 |
| `full`／`revFull` | 全文來源網址，或「無全文」（只有這兩種值） |
| `revNo`／`revDate`／`revText` | 覆審案號／日期／結果；沒有覆審則四個 rev 欄位都是空字串 |
| `note` | 備註 |
| `ft`／`ftRev` | 決議書全文（段落字串陣列），取用時以換行接回原文 |
| `dOrig`／`revDOrig` | 作成決議原本日期（畫面不顯示） |
| `subcat`／`patternInclude`／`patternExclude`／`noteNoLaw`／`who` | 人工補正欄位，各見 `app.js` 註解 |

法典鍵：`j` 舊律師法、`k` 新律師法、`l` 舊律師倫理規範、`m` 新律師倫理規範、`n` 舊法律扶助法、`o` 新法律扶助法、`x` 上述以外的規範（`sources` 中以大寫 `J`～`O` 表示）。

補充：

- 併案（一份決議書含多名律師）只在該案號**第一次出現**的那一筆存放全文，其他筆於載入時以案號取得同一份。所以「這一筆沒有 `ft`」不代表「這個案子沒有全文」。
- 畫面上的編號 `no` 不存在 JSON 裡，載入時依陣列位置推導。
- `hc`、`articleIndex`、`patterns[].cases`、`patterns[].laws`、`laws[].articles[].used` 也都是載入時推導的值，不要手動寫進 JSON。

## 維護注意事項

過去踩過的問題，修改前請先看過：

1. **不要把可以推導的資料另存一份。** 編號、法條索引、態樣歸屬、「已引用」標記一律由程式推導。曾經另存一份而與 `norm` 不同步，造成 86 筆錯位、22 筆漏列，而且畫面照樣正常顯示，很久都沒被發現。
2. **不要用 `no` 當索引。** 歷史上 `no` 與陣列位置有 39 處不一致，而且前 34 筆剛好一致，抽查看不出來。引用一律以陣列位置為準。
3. **用到 `:has()` 的 CSS，一個選擇器寫一條規則**，不要合併成以逗號分隔的選擇器列表。列表中只要有一項瀏覽器不支援，整條規則都會被丟棄。
4. **全文彈出視窗的樣式**（`#ft-dlg`／`#ft-body`）已整理成「同一個選擇器只留一條宣告」，要調整就改那一條，不要在區塊後面另外加覆寫。
5. **捲動定位**一律使用「零淨高度錨點」的作法，說明見 `main.css` 的 `[CSS-PATTERN]` 區塊。
6. 人工歸類的內容（違失態樣名稱、`mapRows`、態樣說明）是逐筆人工查證的結果，修改前要先與負責同仁確認。

## SEO 說明

- `index.html` 含 title、description、canonical、Open Graph、Twitter Card，以及 schema.org 的 `WebSite`／`Dataset`／`Organization` 結構化資料（JSON-LD）。
- 首頁、資料庫說明、改革主張、申訴救濟、專題分析文章等文字內容直接寫在 `index.html`，不依賴 JSON 載入。其中非首頁的頁籤在 HTML 中預設為隱藏（`hidden`），搜尋引擎仍會索引，但權重可能較低。
- 案件清單、統計圖表由 JavaScript 產生；Google 會執行 JavaScript 後再建立索引。
- 站內各頁籤使用網址錨點（例如 `#list/q=…`、`#stats`），對搜尋引擎而言整站是同一個網址，因此 `sitemap.xml` 只列首頁。

## 外部資料來源

網站執行時不會連到這些來源。下列資料都已經整理進 `data/*.json`，只有新增案件、更新統計或核對原文時，才需要回到來源查。

| 資料 | 來源 |
|---|---|
| 律師懲戒人數統計 | 法務部法務統計 list_id=1531 |
| 本國律師人數統計 | 法務部法務統計 list_id=1527 |
| 考試及格人數 | 考試院統計資料查詢網（專技高考 2.2.8） |
| 決議書全文（法務部） | `lawyerbc.moj.gov.tw/discipline/{32 碼 ID}` |
| 決議書全文（行政院公報） | `gazette.nat.gov.tw/…/Eg.htm` |
| 律師懲戒案例選輯 | 全國律師聯合會 twba.org.tw |

新增案件時取得決議書全文：

- **用瀏覽器打開原文頁面、複製貼上**即可，兩個來源都適用，不必處理編碼。
- 若要寫程式批次抓取：
  - 法務部的頁面內容由 JavaScript 產生，一般下載工具（如 `curl`）抓不到內文，要用能執行 JavaScript 的瀏覽器自動化工具（如 Playwright）。
  - 行政院公報部分頁面是 Big5 編碼，抓下來要先以 cp950 解碼，再存成 UTF-8，否則會變亂碼。
