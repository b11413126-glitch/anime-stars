# 動畫製作公司分類

2026-10-26目前優先採完整獨立 `site/official-metadata.json` 的官方「製作廠商」，空白者才補逐部公共或第一方證據。1,795部已確認公司（官方1,761、補證34）、93部非動畫不適用、5部仍未確認，共393家公司。代理不當製作公司；非動畫不能套動畫職務；未知仍保留全榜。補證來源與季別範圍見 [OFFICIAL_METADATA.md](OFFICIAL_METADATA.md)，須執行 `node tools/validate_official_metadata.mjs`。原 `studios.json` 保留為後備，以下Bangumi程序僅適用其來源，不能否定官方已明示的廠商。

公司與題材置於同一個原生 details「分類篩選」區，預設收合。收合時顯示已選摘要；搜尋作品、最低評分人數、年份、分級與清除全部維持常駐。展開後選取不自動收合，使用者可手動收合；重新整理與分享網址可還原條件，面板仍預設收合。

公司多選採任一符合（OR），題材多選採全部符合（AND），兩者再與其他條件取交集。維持全站名次、篩選後最高名次推薦及每頁50部。公司搜尋只影響選項，不偷偷變更已選條件；已選置頂，其餘依本榜已確認作品數降冪排列。公司與別名均可搜尋，清單高度固定並可捲動。URL 使用重複的 studio 參數保存穩定公司 ID（既有已核對Bangumi ID或官方名稱雜湊ID）；未知但格式正確的 ID 保留為可移除條件，不偷偷清除。

## 後備Bangumi來源與核對

使用已通過 genres.json 身分核對的全部作品對照，包括沒有支援題材但身分已確認的作品。透過公開 `GET https://api.bgm.tv/v0/subjects/{id}/persons`，只採 `type:2` 公司、原始職務字串精確為 `动画制作`（Bangumi職務67）的條目。共同製作全部保留，參與集數 eps 原文保存。

排除「製作／制作」、「制作协力／製作协力」、「OP・ED 动画制作」、「协力」與其他職務，不能用 producer career 或名稱包含「制作」推測。這是 Bangumi 公共作品職務，非動畫瘋官方分類，也不是對製作分工的獨立調查。

公司以來源 person ID 分開，顯示來源名稱。`GET /v0/persons/{id}` 僅保留公共名稱及別名欄位，供搜尋使用；不自行合併前身、分社、改組或相似名稱。沒有可靠作品身分、公共條目不存在或未提供動畫製作職務時顯示「製作公司尚未確認」，不能理解為實際沒有製作公司。未選公司仍保留完整榜單。

官方API結構：[OpenAPI](https://raw.githubusercontent.com/bangumi/server/master/openapi/v0.yaml)；職務定義：[subject_staffs.yml](https://raw.githubusercontent.com/bangumi/common/master/subject_staffs.yml)。

## 檔案與更新

`site/studios.json` 為獨立分類快照，綁定 `data.json` 原始 SHA-256、updatedAt、作品數及 `genres.json` 身分證據檔 SHA-256。每個上榜作品有唯一 classified／unclassified 紀錄。職務、公司ID、逐部身分、公司作品數及覆蓋率都須一致；公司整理時間與評分時間分開。

執行 `python tools/update_studios.py --cache-dir <本機公開欄位快取> --fetch`。單佇列最短間隔1.1秒是本機保守政策，不宣稱為官方配額。只存公開職務、名稱、別名及查詢時間，不讀會員 Cookie、私人收藏或評分。所有已核對身分均完成查詢後才寫入正式分類檔；來源拒絕、格式或傳輸失敗立即停止，在快取 failure.json 留下原因，不盲目重試。

省略 --fetch 可離線重建。快取完整不代表永久新鮮；月更新評分時應使用當次快取目錄重新查詢，或明確保留並標示既有公開職務的實際查詢時間。題材與公司只隨必要月更維護，不因排程檢查而每日重查。新的身分對照或評分快照需重新綁定，不能沿用雜湊不符的公司檔。

發布前執行 Node／Python 測試、`validate_snapshot.mjs --require-classification`、`validate_genres.mjs`、`validate_studios.mjs`。前端公司核對失敗時保留完整排名與其他有效篩選並顯示提示，不清除網址已選條件。發布後匿名讀回三份資料核對時間、數量及SHA-256。

公司衍生資料沿用 Bangumi 的 CC BY-SA 3.0，保留來源、授權及修改說明，詳見 [GENRE_DATA_LICENSE.md](GENRE_DATA_LICENSE.md)。快取、evidence、暫存及合成測試資料不公開。動畫瘋來源停止紀錄和每月更新限制維持有效，這次公司分類不構成重試評分來源或啟用暫停排程的授權。
