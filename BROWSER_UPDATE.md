# 會員瀏覽器更新程序

本專案的每日資料來源使用使用者在 Codex 內建瀏覽器正常登入的動畫瘋工作階段。GitHub Actions 只部署已通過完整驗證的靜態快照。不要匯出 Cookie、讀取瀏覽器憑證檔、設定巴哈密碼或把登入資訊放入 GitHub。

來源與更新程式：`tools/member_browser_driver.mjs`（只使用已文件化的 CUA Tab 操作）與 `tools/browser_import.py`（本機驗證接收器）。受限 API 端點來自官方播放器原始碼。網站與 API 的 robots.txt 每次重新檢查；所有來源頁面導覽間隔至少 2.6 秒。

每天只需要成功更新一次。先檢查 `site/data.json` 的 `updatedAt`（Asia/Taipei 日期），再讀回公開網站的資料確認已發布。同一天已成功且遠端一致時直接結束，不重新擷取或重複提交。若本機已有當天完整有效的新快照但遠端尚未發布，先重試發布，不重新擷取。

目前分類使用已有真實資料的作品年份與官方年齡說明。先閱讀 [CATEGORY_FEATURE.md](CATEGORY_FEATURE.md)。網站發布需通過 `--require-classification`，不得變更舊快照 updatedAt 冒充當日資料。新資料完整驗證才可取代；官方題材介面只有 `officialTagsVerified:true` 且逐部 tags 有效時才顯示。未保存題材的舊批次不可接續，欄位缺失不能當成官方無題材，不可從片名猜測分類。

開始來源請求前，先讀取 `evidence/source-blocked.json`（若存在）。當 `status` 為 `blocked` 且 `automaticRetryAllowed` 為 false 時，不得重新啟動擷取；保留前次正式快照，僅核對公開網站與本機狀態。相同阻礙若已通知，後續檢查安靜結束。需有官方來源狀態已修復的證據，或使用者明確要求重新嘗試，才解除這個來源停止紀錄；換日不代表來源問題已消失。

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

5. 全新更新先建立第一個 driver，initialize() 後讀完所有 catalogStep(20)。再以同一來源 Tab 及接收器建立另一個 MemberBrowserCollector，重新 initialize() 並讀完全部目錄。兩個 driver 共用來源導覽間隔，不能平行擷取。用 await driver.confirmCatalog(secondDriver) 核對兩輪均無缺頁／重複且完整唯一 ID 集合相同，再執行兩次 probe()。可在第一輪首頁後先做小量登入診斷，但兩輪完整核對及兩次少量真實驗證都成功後，才可 await driver.begin() 開始昂貴的逐部資料核對。不能用同一個 driver 或同一輪資料冒充第二輪。來源拒絕、缺漏、重複或集合改變即停止；預檢不能替代完成後的首末頁與全目錄變動核對。
6. 每次呼叫 `await driver.step()`，保存所有完整批次，直到 `state.offset === state.catalog.length`。`evidence/browser-current.json` 是已接受資料的實際進度。若同一日的進行中驗證被打斷，重新建立 Tab 與 driver 後，可用 `await driver.resumeImportedRun()` 接續。若跨日、目錄改變或已有錯誤，不要盲目接續舊批次；重新確認來源狀態後建立新的一日驗證。
7. 完成後呼叫 `await driver.finish()`。它會再次核對首頁、末頁及總頁數，全部成功後才原子更新 `site/data.json`。任何來源拒絕、缺漏、無效值或目錄變動均不得以半份榜單取代舊資料。
8. 執行 `node --test tests/ranking.test.mjs`、`python -m unittest discover -s tests -p 'test_*.py' -v` 及 `node tools/validate_snapshot.mjs --require-classification`。成功後，提交已驗證的公開作品快照至 `b11413126-glitch/anime-stars` 的 `main`。分類發布須同時提交介面、資料驗證程式及必要文件；題材版另須額外通過 --require-tags。只上傳網站、程式與操作文件，排除 `evidence/`、`HANDOVER.md`、測試暫存檔與任何登入資料。
9. 等待 GitHub Pages workflow 成功，再匿名讀回網站 `data.json`，比對 `updatedAt`、作品數與資料雜湊。只有這一步成功才記錄當日發布完成。若部署失敗，保留線上舊版，保存本機有效新快照以供補發布。

遇來源錯誤時立即停止這次來源請求，保存錯誤及進度。不得把登入受限條目當成無評分、忽略失敗或修改完整性標記。只在來源或登入狀態確實改變後，才重新驗證。


### 擷取期間目錄排序改變

若同一頁內純粹交換排序，首末頁以唯一 ID 集合與數量比對；重複項目仍拒絕。如果 `finish()` 明確回報首末頁成員改變，先保存既有進度，建立另一個 `MemberBrowserCollector`，執行 `initialize()` 並讀完全部 `catalogStep(20)`，取得完整新目錄。不得只改首末頁或略過比對。用 `await driver.reconcileCatalog(recheckDriver)` 驗證新舊完整 ID 集合完全相同，再呼叫 `await driver.finish()`。只有這種目錄變動可在完整複查成功後清除狀態；來源拒絕或解析失敗不可用複查解除。若有新增或移除、重複、漏頁或來源拒絕，接收器會拒絕採納；應停止並重新確認完整來源，不能把舊集合冒充新集合。已驗證作品保留各自原始查詢時間與官方題材，僅採納最新公開目錄欄位。
