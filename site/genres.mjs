// Bangumi classification is separate from the complete, dated rating snapshot.
export function normalizedTitle(value){return value.normalize('NFKC').toLowerCase().trim();}
export function coverID(raw){
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||!/^p\d+\.bahamut\.com\.tw$/.test(url.hostname))return null;
    return url.pathname.match(/^\/B\/ACG\/c\/\d+\/0*(\d+)\.(?:jpg|png|jpeg)$/i)?.[1]||null;
  }catch{return null;}
}
function validDate(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function sameSet(a,b){return a.length===b.length&&a.every(x=>b.includes(x));}
export function verifiedGenres(snapshot,genres,mapping,rankingSHA256){
  if(genres?.schemaVersion!==1||genres.source!=='bangumi-meta-tags'||
    genres.sourceURL!=='https://bgm.tv/'||genres.license!=='CC BY-SA 3.0'||
    genres.licenseURL!=='https://creativecommons.org/licenses/by-sa/3.0/'||
    !validDate(genres.updatedAt)||!validDate(genres.checkedFrom)||!validDate(genres.checkedThrough)||
    Date.parse(genres.checkedFrom)>Date.parse(genres.checkedThrough)||
    Date.parse(genres.checkedThrough)>Date.parse(genres.updatedAt)||
    genres.rankingUpdatedAt!==snapshot.updatedAt||genres.rankingCount!==snapshot.items.length||
    !/^[a-f0-9]{64}$/.test(rankingSHA256)||genres.rankingSHA256!==rankingSHA256||
    genres.crosswalk?.name!=='bangumi-data'||genres.crosswalk.license!=='CC BY 4.0'||
    !/^https:\/\/unpkg\.com\/bangumi-data@\d+\.\d+\.\d+\/dist\/data\.json$/.test(genres.crosswalk.url)||
    !/^[a-f0-9]{64}$/.test(genres.crosswalk.sha256)||
    !Array.isArray(genres.records)||genres.records.length!==snapshot.items.length||
    !mapping||typeof mapping!=='object'||Array.isArray(mapping)||
    Object.values(mapping).some(x=>typeof x!=='string'||!x.trim()))throw Error('題材來源、授權或快照對應無效');
  const byID=new Map(snapshot.items.map(x=>[x.id,x])),seen=new Set(),result=new Map();
  const reasons=['identity-not-confirmed','ambiguous-identity','public-subject-unavailable','subject-identity-conflict','no-supported-public-genre'];
  for(const row of genres.records){
    const item=byID.get(row.id);
    if(!item||seen.has(row.id)||!['classified','unclassified'].includes(row.status)||
      !Array.isArray(row.tags)||new Set(row.tags).size!==row.tags.length||
      (row.status==='classified')!==(row.tags.length>0)||
      (row.status==='unclassified'&&!reasons.includes(row.reason)))throw Error('題材作品缺漏、重複或狀態無效');
    seen.add(row.id);
    if(row.status==='classified'||row.match){
      const match=row.match;
      if(!match||!Number.isInteger(match.subjectId)||match.subjectId<1||
        match.gamerId!==coverID(item.image)||typeof match.titleAlias!=='string'||
        normalizedTitle(match.titleAlias)!==normalizedTitle(item.title)||match.month!==item.year||
        typeof match.sourceTitle!=='string'||typeof row.subjectName!=='string'||
        normalizedTitle(match.sourceTitle)!==normalizedTitle(row.subjectName)||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.subjectDate||'')||
        row.subjectDate.slice(0,7).replace('-','/')!==item.year||
        !validDate(row.checkedAt)||Date.parse(row.checkedAt)<Date.parse(genres.checkedFrom)||
        Date.parse(row.checkedAt)>Date.parse(genres.checkedThrough)||
        !Array.isArray(row.sourceTags)||new Set(row.sourceTags).size!==row.sourceTags.length||
        row.sourceTags.some(tag=>!Object.hasOwn(mapping,tag)))throw Error('題材作品身分或來源標籤未通過核對');
      const expected=[...new Set(row.sourceTags.map(tag=>mapping[tag]))];
      if(!sameSet(row.tags,expected)||(!row.tags.length&&row.reason!=='no-supported-public-genre'))
        throw Error('題材與原始公共標籤不一致');
    }else if(row.sourceTags||row.reason==='no-supported-public-genre')throw Error('無題材不能冒充已核對');
    result.set(row.id,row);
  }
  if([...result.values()].filter(x=>x.status==='classified').length!==genres.classifiedCount)
    throw Error('題材覆蓋數不一致');
  return result;
}
export function applyGenres(items,records){
  return items.map(item=>({...item,tags:records.get(item.id)?.tags||[],genre:records.get(item.id)}));
}
