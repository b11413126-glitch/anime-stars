// The official rendered work fields supplement, never replace, rating data.
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const text=x=>typeof x==='string'&&!!x&&x.trim()===x;
const norm=x=>x.normalize('NFKC').replace(/\s+/gu,' ').trim();
const titleMatches=(source,title)=>{const a=norm(source),b=norm(title);return a===b||
  (a.startsWith(b)&&/^(?:\s*\[[^\]]+\])+\s*$/u.test(a.slice(b.length)));};
const unique=x=>Array.isArray(x)&&new Set(x).size===x.length;
const mediaTypes=new Set(['live-action-drama','live-action-tokusatsu','live-action-variety','live-concert-recording','live-stage-reading','live-stage-recording']);
const https=x=>{try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname!=='localhost'&&!/^127\./.test(u.hostname);}catch{return false;}};
function supplementNames(row){
  const value=row.studioSupplement;
  if(!value)return [];
  if(['first-party-animation-production','contemporaneous-production-report'].includes(value.source)){
    if(manufacturerNames(row.manufacturer).length||value.workTitle!==row.title||!text(value.sourceTitle)||
      !text(value.scopeNote)||!date(value.checkedAt)||!Array.isArray(value.identitySources)||!value.identitySources.length||
      value.identitySources.some(x=>!https(x.url)||!text(x.fact))||!Array.isArray(value.credits)||!value.credits.length||
      value.credits.some(x=>!text(x.name)||x.relation!=='actual-animation-production'||!text(x.originalRole)||
        !https(x.sourceURL)||!text(x.fact)||!date(x.checkedAt)||x.type!==undefined||x.id!==undefined||
        (x.supportingSources!==undefined&&(!Array.isArray(x.supportingSources)||x.supportingSources.some(s=>!https(s.url)||!text(s.fact))))))
      throw Error('第一方製作補證缺少本作身分、原始職務、責任範圍或來源');
    if(value.source==='contemporaneous-production-report'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value.reportPublishedAt)||
      !text(value.reportAuthor)||value.reportPublishedAt.slice(0,4)!==row.premiereDate?.slice(0,4)||value.identitySources.length<2))
      throw Error('同期原始報導須保留發表日期、署名及本作版本互證');
    return [...new Set(value.credits.map(x=>x.name))];
  }
  if(manufacturerNames(row.manufacturer).length||value.source!=='bangumi-animation-production'||
    !Number.isInteger(value.subjectId)||value.subjectId<1||!text(value.subjectName)||
    !Array.isArray(value.identitySources)||!value.identitySources.length||
    value.identitySources.some(x=>!https(x.url)||!text(x.fact))||
    !Array.isArray(value.credits)||!value.credits.length||!date(value.checkedAt)||
    value.credits.some(x=>!text(x.name)||x.relation!=='动画制作'||(
      x.sourceField==='person-work-list'?
        !Number.isInteger(x.id)||x.id<1||x.type!==2||x.workId!==value.subjectId||x.workTitle!==row.title||
          x.subjectName!==value.subjectName||x.premiereDate!==row.premiereDate||
          x.sourceURL!=='https://bgm.tv/person/'+x.id+'/works#item_'+value.subjectId:
      x.sourceField==='infobox'?
        x.id!==null||x.sourceType!=='not-specified'||x.sourceURL!=='https://api.bgm.tv/v0/subjects/'+value.subjectId||
          !Array.isArray(x.organizationEvidence)||!x.organizationEvidence.length||x.organizationEvidence.some(p=>!https(p.url)||!text(p.fact)):
        !Number.isInteger(x.id)||x.id<1||x.type!==2||x.sourceURL!=='https://api.bgm.tv/v0/subjects/'+value.subjectId+'/persons')))
    throw Error('空白廠商的外部補證缺少身分或精確動畫製作職務');
  return [...new Set(value.credits.map(x=>x.name))];
}
export function verifiedOfficialMetadata(snapshot,metadata,rankingHash,mapping={}){
  if(metadata?.schemaVersion!==1||metadata.source!=='gamer-rendered-work-metadata'||metadata.complete!==true||
    metadata.sourceURL!=='https://ani.gamer.com.tw/'||metadata.rankingSHA256!==rankingHash||
    !/^[a-f0-9]{64}$/.test(rankingHash)||metadata.rankingUpdatedAt!==snapshot.updatedAt||
    metadata.rankingCount!==snapshot.items.length||!date(metadata.checkedFrom)||!date(metadata.checkedThrough)||
    !date(metadata.updatedAt)||Date.parse(metadata.checkedFrom)>Date.parse(metadata.checkedThrough)||Date.parse(metadata.checkedThrough)>Date.parse(metadata.updatedAt)||
    !Array.isArray(metadata.records)||metadata.records.length!==snapshot.items.length||
    !Array.isArray(metadata.studios))throw Error('官方分類來源、完整性或評分快照綁定無效');
  const directory=new Map(),counts=new Map(),rows=new Map(),items=new Map(snapshot.items.map(x=>[x.id,x]));
  for(const company of metadata.studios){
    if(!/^(?:[1-9]\d*|official-[a-f0-9]{16})$/.test(company.id)||
      (/^[1-9]\d*$/.test(company.id)&&company.identitySource!=='https://api.bgm.tv/v0/persons/'+company.id)||
      directory.has(company.id)||!text(company.name)||
      !unique(company.aliases)||!company.aliases.includes(company.name)||company.aliases.some(x=>!text(x))||
      !Number.isInteger(company.count)||company.count<1)throw Error('官方製作廠商目錄無效');
    directory.set(company.id,company);counts.set(company.id,0);
  }
  for(const row of metadata.records){
    const item=items.get(row.id);
    if(!item||rows.has(row.id)||row.title!==item.title||row.videoSn!==item.availability.videoSn||
      row.sourceURL!=='https://ani.gamer.com.tw/animeVideo.php?sn='+row.videoSn||
      !unique(row.tags)||row.tags.some(x=>!text(x))||!unique(row.studioIds)||
      row.studioIds.some(x=>!directory.has(x))||!date(row.checkedAt)||
      Date.parse(row.checkedAt)<Date.parse(metadata.checkedFrom)||Date.parse(row.checkedAt)>Date.parse(metadata.checkedThrough))
      throw Error('官方分類作品身分、公開欄位或查詢時間無效');
    const cover=new URL(item.image).pathname.match(/^\/B\/ACG\/c\/\d+\/0*(\d+)\.[^.]+$/)?.[1];
    if(row.officialUnavailable){
      const unavailable=row.officialUnavailable,g=row.genreSupplement;
      const match=item.availability.downTime?.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      const expiry=match?Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`):NaN;
      if(unavailable.reason!=='snapshot-licence-expired'||unavailable.scheduledDownTime!==item.availability.downTime||
        unavailable.message!=='目前無此動畫或動畫授權已到期！'||unavailable.observedAt!==row.checkedAt||
        !Number.isFinite(expiry)||expiry>Date.parse(unavailable.observedAt)||row.sourceTitle!==null||row.acgId!==null||
        row.manufacturer!==null||row.premiereDate!==null||!g||g.source!=='bangumi-meta-tags'||
        !Number.isInteger(g.subjectId)||g.subjectId<1||g.subjectType!==2||!text(g.subjectName)||
        !/^\d{4}-\d{2}-\d{2}$/.test(g.subjectDate)||g.subjectDate.slice(0,7).replace('-','/')!==item.year||
        g.gamerId!==cover||g.titleAlias!==item.title||g.sourceURL!=='https://api.bgm.tv/v0/subjects/'+g.subjectId||
        g.crosswalkURL!=='https://unpkg.com/bangumi-data@0.3.232/dist/data.json'||
        g.crosswalkSHA256!=='7e51a1066fe5f4322c2518186d01d6e1ec4eb36013700b7aebf40fc08a4fd542'||
        !date(g.checkedAt)||!Array.isArray(g.rawTags)||g.rawTags.some(x=>!text(x))||!row.tags.length||
        !row.studioSupplement||row.studioSupplement.subjectId!==g.subjectId)
        throw Error('到期作品不得冒充官方已讀取，須原下架日、完整身分及獨立分類證據');
      const expected=[...new Set(g.rawTags.filter(x=>Object.hasOwn(mapping,x)).map(x=>mapping[x]))];
      if(expected.length!==row.tags.length||expected.some(x=>!row.tags.includes(x)))throw Error('到期作品題材與公共原始標籤不一致');
    }else{
      if(!text(row.sourceTitle)||!titleMatches(row.sourceTitle,item.title)||!/^[1-9]\d*$/.test(row.acgId)||
        typeof row.manufacturer!=='string'||row.manufacturer.trim()!==row.manufacturer||
        (!row.tags.length&&row.emptyTagsVerified!==true)||(cover&&cover!==row.acgId)||row.genreSupplement)
        throw Error('官方分類公開欄位或ACG身分不符');
    }
    const nonAnimation=row.animationStudioApplicability==='not-applicable';
    if(nonAnimation&&(!mediaTypes.has(row.mediaType)||row.studioIds.length||row.studioSupplement||
      !https(row.mediaEvidence?.sourceURL)||!date(row.mediaEvidence.checkedAt)||!text(row.mediaEvidence.canonicalTitle)||!text(row.mediaEvidence.basis)))
      throw Error('非動畫作品須有逐部媒體類型證據，不能把查不到公司當成不適用');
    const extraNames=supplementNames(row);
    const names=nonAnimation?[]:manufacturerNames(row.manufacturer).length?manufacturerNames(row.manufacturer):extraNames;
    if(names.some(name=>!row.studioIds.some(id=>directory.get(id).aliases.includes(name)))||
      row.studioIds.some(id=>!names.some(name=>directory.get(id).aliases.includes(name))))
      throw Error('官方製作廠商與原始欄位不一致');
    for(const id of row.studioIds)counts.set(id,counts.get(id)+1);
    rows.set(row.id,row);
  }
  if(metadata.classifiedCount!==[...rows.values()].filter(x=>x.tags.length).length||
    metadata.officialGenreCount!==[...rows.values()].filter(x=>!x.officialUnavailable&&x.tags.length).length||
    metadata.supplementedGenreCount!==[...rows.values()].filter(x=>x.genreSupplement).length||
    metadata.unavailableCount!==[...rows.values()].filter(x=>x.officialUnavailable).length||
    metadata.studioClassifiedCount!==[...rows.values()].filter(x=>x.studioIds.length).length||
    metadata.officialStudioCount!==[...rows.values()].filter(x=>x.animationStudioApplicability!=='not-applicable'&&manufacturerNames(x.manufacturer).length).length||
    metadata.supplementedStudioCount!==[...rows.values()].filter(x=>x.studioSupplement).length||
    metadata.notApplicableCount!==[...rows.values()].filter(x=>x.animationStudioApplicability==='not-applicable').length||
    metadata.unconfirmedStudioCount!==[...rows.values()].filter(x=>x.animationStudioApplicability!=='not-applicable'&&!x.studioIds.length).length||
    [...directory.values()].some(x=>counts.get(x.id)!==x.count))throw Error('官方分類數量不一致');
  return rows;
}
export function manufacturerNames(raw){
  if(!raw||['-','—','－','不明','未知','未定','無','暫無'].includes(raw))return [];
  return [...new Set(raw.split('、').map(x=>x.trim()).filter(Boolean))];
}
export function applyOfficialMetadata(items,records){
  return items.map(item=>{
    const row=records.get(item.id);
    return {...item,tags:row.tags,studioIds:row.studioIds,officialMetadata:row};
  });
}
