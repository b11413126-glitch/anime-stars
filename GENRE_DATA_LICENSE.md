# 外部題材資料來源與授權

`site/genres.json` 使用 [Bangumi](https://bgm.tv/) 維基人管理的公共 `meta_tags`，經題材白名單篩選、去除重複及繁體中文轉換，並依動畫瘋作品快照配對。每個已核對條目保留來源 subject ID、原始題材文字、名稱、日期、比對依據及實際查詢時間。網站各列提供原作品分類來源連結。

這份題材衍生資料依 **[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)** 提供；請保留 Bangumi 來源、授權連結、修改說明及相同授權。上游說明：[Bangumi 版權聲明](https://bgm.tv/about/copyright)、[開發者條款](https://bgm.tv/about/developer)。本網站不提供完整上游資料庫鏡像或代理 API，也不保證上游永久開放存取。

跨站對照使用 **[bangumi-data](https://github.com/bangumi-data/bangumi-data)**，依 **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)** 提供。版本、網址及 SHA-256 記於分類檔的 `crosswalk`。修改方式是僅保留 ACG 封面編號、精確別名、台灣年月及唯一性皆通過核對的對照；不同編號命名空間不混用，不採片名相似度猜測。

上述授權適用於外部題材及對照資料，不將動畫瘋分數、票數、封面或整個網站宣稱為 Bangumi 授權內容。`site/data.json` 評分來源仍為動畫瘋，實際更新時間獨立保存。

無法確認身分、公共資料不可取得，或公共標籤沒有支援題材時，作品顯示「尚未分類」。這不代表官方沒有題材；未選題材時仍保留在完整排行榜中。
