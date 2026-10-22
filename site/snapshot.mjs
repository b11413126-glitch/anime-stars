import {rankItems} from './ranking.mjs';

export function verifiedTags(data){
  if(data?.officialTagsVerified!==true)return false;
  if(!Array.isArray(data.items)||data.items.some(x=>!Array.isArray(x.tags)||
    x.tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag!==tag.trim())||
    new Set(x.tags).size!==x.tags.length)){
    throw Error('官方題材欄位缺漏或無效');
  }
  return true;
}

export function verifiedItems(data) {
  if (data?.coverage !== 'complete-tw-watchable-catalog' || data.region !== 'TW' ||
      data.playbackAvailabilityVerified !== true) return null;
  if (data.schemaVersion !== 1 || !Array.isArray(data.items) || !data.items.length ||
      !data.updatedAt || !Number.isFinite(Date.parse(data.updatedAt))) {
    throw Error('完整資料格式或更新時間無效');
  }
  const items = rankItems(data.items);
  verifiedTags(data);
  if (items.length !== data.items.length || items.some(x =>
      x.availability?.pass !== true || x.availability?.basis !== 'official-watching-permission' ||
      !['anonymous','member-browser'].includes(x.availability?.accessContext) ||
      !Number.isInteger(x.availability?.videoSn) ||
      !/^https:\/\/ani\.gamer\.com\.tw\/animeRef\.php\?sn=\d+$/.test(x.url))) {
    throw Error('完整資料含缺漏、重複或未驗證作品');
  }
  return items;
}
