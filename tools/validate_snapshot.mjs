import {readFile} from 'node:fs/promises';
import {verifiedItems} from '../site/snapshot.mjs';

const data = JSON.parse(await readFile(new URL('../site/data.json', import.meta.url), 'utf8'));
const items = verifiedItems(data);
if (!items || data.catalogCount !== items.length + data.excludedCount ||
    !Number.isInteger(data.pageCount) || data.pageCount < 1 ||
    !Number.isInteger(data.excludedCount) || data.excludedCount < 0) {
  throw Error('缺少完整目錄、觀看權限或排除數證據，不可部署');
}
if (items.some(x => !x.year || !x.checkedAt || !Number.isFinite(Date.parse(x.checkedAt)))) {
  throw Error('作品年份或實際查詢時間缺漏，不可部署');
}
console.log(JSON.stringify({success:true,rankedCount:items.length,catalogCount:data.catalogCount,
  pageCount:data.pageCount,excludedCount:data.excludedCount,updatedAt:data.updatedAt}));
