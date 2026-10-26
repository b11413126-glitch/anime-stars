# 星序｜動畫瘋評分榜

公開網站：[星序](https://b11413126-glitch.github.io/anime-stars/)

2026-10-26完成官方分類擷取修正。獨立檔案 `site/official-metadata.json` 包含原榜單全部1,893部：題材1,892部官方、1部到期影片公共補證；動畫製作公司1,761部官方、34部外部補證，另93部非動畫不適用、5部尚未確認，共393家公司。每部提供來源，保留原始評分快照與時間。程序見 [OFFICIAL_METADATA.md](OFFICIAL_METADATA.md)。

動畫瘋官方顯示星等排行榜，公開瀏覽免登入。依一位小數星等降冪、評分人數降冪、名稱固定排序，名次連續；搜尋與最低評分人數篩選保留全站名次，每頁 50 部。

網站提供題材複選、作品年份、年齡分級及動畫製作公司，與搜尋、最低評分人數同時篩選，保留全站名次。題材須全部符合，公司任一符合；分類面板預設收合。官方分類查核完成於2026-10-26台灣時間15:45:14；評分仍為2026-10-18台灣時間17:06:32。原已排定下架的影片明示到期，不冒充目前可觀看。規格見 [CATEGORY_FEATURE.md](CATEGORY_FEATURE.md)。

## 資料與完整性

資料取自動畫瘋台灣目錄與官方播放器中繼資料。不同季、劇場版依官方 `animeRef.php?sn=` 條目分開，各集不重複上榜。逐部確認官方觀看權限、作品身分、已上架且未下架；不把公開目錄直接當成可觀看證據，也不代表逐集播放過。部分作品需要會員、年齡或付費資格，實際觀看依官方當下規則。

首次完整驗證：69 頁、1,909 個唯一作品，1,893 部有評分、16 部確認無評分。擷取期間目錄順序變動後，重新讀取全部 69 頁，確認作品集合完全相同；不存在漏頁、重複或未解決的失敗。最新實際時間與數量以 `site/data.json` 為準。

任何來源拒絕、登入失效、無效值、缺漏或作品集合變動均停止，不發布半份榜單。無評分與解析失敗分開處理；全部成功才原子取代正式快照。資料逾 35 天會在網站提醒，失敗時保留前次成功時間與資料。

## 更新與部署

GitHub Pages／公開儲存庫提供免費靜態網站；GitHub Actions 只測試與部署已驗證快照，不擷取需會員登入的來源。Pages Source 使用 GitHub Actions，變數 `ANIME_SOURCE_VERIFIED=true` 仍須搭配每次快照驗證與測試通過。沒有儲存巴哈帳密或 Cookie。

排名每月最多更新一次，在使用者本機Codex與正常登入的內建瀏覽器執行。排程設為每月23日17:17（Asia/Taipei），目前因目錄完整性阻礙維持暫停，不因分類發布恢復。當月已成功便不重跑；關機、離線、Codex未執行或登入失效時不能更新。完整來源核對至少約85分鐘，程序見 [BROWSER_UPDATE.md](BROWSER_UPDATE.md)。

## 本機檢查

需要 Python 3.10+、Node.js，無第三方程式套件。

```powershell
node --test tests/ranking.test.mjs tests/official-metadata.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
node tools/validate_snapshot.mjs --require-classification
node tools/validate_genres.mjs
node tools/validate_studios.mjs
node tools/validate_official_metadata.mjs
python -m http.server 8000 --bind 127.0.0.1 --directory site
```

71項測試（Node 44、Python 27）涵蓋排序、來源完整性、拒絕停止、兩輪目錄預檢、題材交集與公司聯集、網址還原、固定影片及ACG身分、代理排除、官方空白與欄位缺漏、真人不適用證據、到期影片不重試、精確公司職務、第一方及同期原始報導補證。測試不能替代真實來源核對。

`tools/collect.py` 與 `verify-source.yml` 是無登入來源診斷工具；遇到限制級登入要求會停止，不是會員定期更新的替代方式。會員更新使用 `tools/member_browser_driver.mjs` 與本機 `tools/browser_import.py`，只透過正常瀏覽器讀公開作品欄位，每次來源導覽至少間隔 2.6 秒。

已修正初版的相對分頁連結、日期型下架時間解析、API 浮點尾差，以及擷取期間純目錄排序變動的完整性複查。

官方來源：[台灣目錄](https://ani.gamer.com.tw/animeList.php)。本工具非官方網站。

外部題材的來源、繁中轉換與授權見 [GENRE_DATA_LICENSE.md](GENRE_DATA_LICENSE.md)。題材更新工具與快取程序見 [CATEGORY_FEATURE.md](CATEGORY_FEATURE.md)；新評分快照須同步重建綁定雜湊的題材檔。

動畫製作公司優先採官方「製作廠商」，空白者才依逐部核對的動畫製作證據補充，共同製作全部保留；未知公司不排除全榜。公司別名、已選置頂、作品數排序及網址還原規格見 [STUDIO_FEATURE.md](STUDIO_FEATURE.md)。既有Bangumi題材及公司檔保留為已驗證的後備資料。
