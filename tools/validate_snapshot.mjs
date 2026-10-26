import {readFile} from 'node:fs/promises';
import {verifiedItems,verifiedTags} from '../site/snapshot.mjs';
import {ageCategory} from '../site/ranking.mjs';
import {createHash} from 'node:crypto';
import {verifiedOfficialMetadata} from '../site/official-metadata.mjs';

const bytes=await readFile(new URL('../site/data.json', import.meta.url));
const data = JSON.parse(bytes);
const items = verifiedItems(data);
if(process.argv.includes('--require-classification')&&(!items||items.some(x=>
  !/^\d{4}(?:\/(?:0[1-9]|1[0-2]))?$/.test(x.year)||!ageCategory(x.ageRating)))){
  throw Error('年份或官方年齡說明缺漏，不可發布年份／分級分類');
}
let officialTagsVerified=verifiedTags(data);
if(process.argv.includes('--require-tags')&&!officialTagsVerified){
  const metadata=JSON.parse(await readFile(new URL('../site/official-metadata.json',import.meta.url)));
  verifiedOfficialMetadata(data,metadata,createHash('sha256').update(bytes).digest('hex'),
    JSON.parse(await readFile(new URL('../site/genre-map.json',import.meta.url))));
  if(metadata.supplementedGenreCount||metadata.unavailableCount||metadata.officialGenreCount!==data.items.length)
    throw Error('分類含明示的公共補證，不能宣稱整份官方題材；請另執行 validate_official_metadata.mjs 逐筆驗證混合來源');
  officialTagsVerified=true;
}
if (!items || data.catalogCount !== items.length + data.excludedCount ||
    !Number.isInteger(data.pageCount) || data.pageCount < 1 ||
    !Number.isInteger(data.excludedCount) || data.excludedCount < 0) {
  throw Error('缺少完整目錄、觀看權限或排除數證據，不可部署');
}
if (items.some(x => !x.year || !x.checkedAt || !Number.isFinite(Date.parse(x.checkedAt)))) {
  throw Error('作品年份或實際查詢時間缺漏，不可部署');
}
console.log(JSON.stringify({success:true,rankedCount:items.length,catalogCount:data.catalogCount,
  pageCount:data.pageCount,excludedCount:data.excludedCount,updatedAt:data.updatedAt,
  officialTagsVerified}));
