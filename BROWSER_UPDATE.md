# 會員瀏覽器更新程序

本專案的每日資料來源使用使用者在 Codex 內建瀏覽器正常登入的動畫瘋工作階段。GitHub Actions 只部署已通過完整驗證的靜態快照。不要匯出 Cookie、讀取瀏覽器憑證檔、設定巴哈密碼或把登入資訊放入 GitHub。

來源與更新程式：`tools/member_browser_driver.mjs`（只使用已文件化的 CUA Tab 操作）與 `tools/browser_import.py`（本機驗證接收器）。受限 API 端點來自官方播放器原始碼。網站與 API 的 robots.txt 每次重新檢查；所有來源頁面導覽間隔至少 2.6 秒。

每天只需要成功更新一次。先檢查 `site/data.json` 的 `updatedAt`（Asia/Taipei 日期），再讀回公開網站的資料確認已發布。同一天已成功且遠端一致時直接結束，不重新擷取或重複提交。若本機已有當天完整有效的新快照但遠端尚未發布，先重試發布，不重新擷取。

來源完整驗證約需 85 分鐘，電腦需開機、連網且 Codex 執行中。關機期間網站仍提供先前成功的快照。沒有開機或登入失效時不能承諾更新；前端保留真實最後成功時間，超過 36 小時顯示逾期提醒。

正常執行順序：

1. 用電腦／瀏覽器工具的正常入口讀取目前工作階段。重用已登入的內建瀏覽器；若需要登入、驗證碼或年齡確認，停止並請使用者正常完成，不代填身分或繞過限制。
2. 在本專案資料夾啟動 `python tools/browser_import.py --port 8017`。它只綁定 127.0.0.1。若沙箱阻擋 loopback，使用正常核准流程；不要改防火牆或降低沙箱保護。
3. 在 `cua_repl` 建立或取得官方來源 Tab 與 `http://127.0.0.1:8017` 接收器 Tab，對工作中建立的 Tab 使用 `markHandoff()` 保存。只讀公開作品欄位，勿保存首頁的個人觀看紀錄。
4. 在同一個 `cua_repl` 中匯入已讀過的專案模組並傳入 Tab：

```javascript
// 把 ABSOLUTE_PROJECT_PATH 換成本機專案絕對路徑，Windows 使用正斜線。
let driverModule = await import('file:///ABSOLUTE_PROJECT_PATH/tools/member_browser_driver.mjs');
let driver = new driverModule.MemberBrowserCollector(sourceTab, receiverTab);
```

5. 全新的一日更新：`await driver.initialize()`，然後每次呼叫 `await driver.catalogStep(20)`，直到 `nextCatalogPage > totalPages`。呼叫 `await driver.probe()` 兩次，都成功才執行 `await driver.begin()`。每次來源批次最多 20 部，以免長時間阻塞對話。
6. 每次呼叫 `await driver.step()`，保存所有完整批次，直到 `state.offset === state.catalog.length`。`evidence/browser-current.json` 是已接受資料的實際進度。若同一日的進行中驗證被打斷，重新建立 Tab 與 driver 後，可用 `await driver.resumeImportedRun()` 接續。若跨日、目錄改變或已有錯誤，不要盲目接續舊批次；重新確認來源狀態後建立新的一日驗證。
7. 完成後呼叫 `await driver.finish()`。它會再次核對首頁、末頁及總頁數，全部成功後才原子更新 `site/data.json`。任何來源拒絕、缺漏、無效值或目錄變動均不得以半份榜單取代舊資料。
8. 執行 `node --test tests/ranking.test.mjs`、`python -m unittest discover -s tests -p 'test_*.py' -v` 及 `node tools/validate_snapshot.mjs`。成功後，提交已驗證的公開作品快照至 `b11413126-glitch/anime-stars` 的 `main`。只上傳網站、程式與操作文件，排除 `evidence/`、`HANDOVER.md`、測試暫存檔與任何登入資料。
9. 等待 GitHub Pages workflow 成功，再匿名讀回網站 `data.json`，比對 `updatedAt`、作品數與資料雜湊。只有這一步成功才記錄當日發布完成。若部署失敗，保留線上舊版，保存本機有效新快照以供補發布。

遇來源錯誤時立即停止這次來源請求，保存錯誤及進度。不得把登入受限條目當成無評分、忽略失敗或修改完整性標記。只在來源或登入狀態確實改變後，才重新驗證。


### 擷取期間目錄排序改變

若 `finish()` 明確回報首末頁改變，先保存既有進度，建立另一個 `MemberBrowserCollector`，執行 `initialize()` 並讀完全部 `catalogStep(20)`，取得完整新目錄。不得只改首末頁或略過比對。用 `await driver.reconcileCatalog(recheckDriver)` 驗證新舊完整 ID 集合完全相同，再呼叫 `await driver.finish()`。若有新增或移除、重複、漏頁或來源拒絕，接收器會拒絕採納；應停止並重新確認完整來源，不能把舊集合冒充新集合。已驗證作品保留各自原始查詢時間，僅採納最新公開目錄欄位。
