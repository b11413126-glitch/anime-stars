// Bangumi company IDs and the exact work-specific animation-production role.
const positive=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value);
const text=value=>typeof value==='string'&&value.trim()===value&&!!value;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const unique=values=>Array.isArray(values)&&new Set(values).size===values.length;
function fail(){throw Error('動畫製作公司來源、身分或快照對應無效');}
export function verifiedStudios(snapshot,studios,identities,rankingHash,identityHash){
  if(studios?.schemaVersion!==1||studios.source!=='bangumi-animation-production'||
    studios.sourceURL!=='https://bgm.tv/'||studios.role!=='动画制作'||studios.roleId!==67||
    studios.license!=='CC BY-SA 3.0'||studios.licenseURL!=='https://creativecommons.org/licenses/by-sa/3.0/'||
    !date(studios.updatedAt)||!date(studios.checkedFrom)||!date(studios.checkedThrough)||
    Date.parse(studios.checkedFrom)>Date.parse(studios.checkedThrough)||Date.parse(studios.checkedThrough)>Date.parse(studios.updatedAt)||
    studios.rankingUpdatedAt!==snapshot.updatedAt||studios.rankingCount!==snapshot.items.length||
    !/^[a-f0-9]{64}$/.test(rankingHash)||studios.rankingSHA256!==rankingHash||
    !/^[a-f0-9]{64}$/.test(identityHash)||studios.identitySHA256!==identityHash||
    !Array.isArray(studios.records)||studios.records.length!==snapshot.items.length||!Array.isArray(studios.studios))fail();
  const directory=new Map(),counts=new Map(),records=new Map(),items=new Set(snapshot.items.map(x=>x.id));
  for(const company of studios.studios){
    if(!positive(company.id)||directory.has(company.id)||!text(company.name)||
      !unique(company.aliases)||company.aliases.some(x=>!text(x))||!company.aliases.includes(company.name)||
      !Number.isInteger(company.count)||company.count<1||
      (company.detailsCheckedAt!==undefined&&(!date(company.detailsCheckedAt)||Date.parse(company.detailsCheckedAt)>Date.parse(studios.updatedAt))))fail();
    directory.set(company.id,company);counts.set(company.id,0);
  }
  let classified=0;
  for(const row of studios.records){
    const identity=identities.get(row.id)?.match;
    if(!items.has(row.id)||records.has(row.id)||!unique(row.studioIds)||
      row.studioIds.some(x=>!positive(x)||!directory.has(x))||
      !['classified','unclassified'].includes(row.status)||(row.status==='classified')!==(row.studioIds.length>0))fail();
    if(!identity){
      if(row.reason!=='identity-not-confirmed'||row.studioIds.length||row.subjectId!==undefined||row.credits!==undefined)fail();
    }else{
      if(row.subjectId!==identity.subjectId||!date(row.checkedAt)||
        Date.parse(row.checkedAt)<Date.parse(studios.checkedFrom)||Date.parse(row.checkedAt)>Date.parse(studios.checkedThrough)||
        !Array.isArray(row.credits)||row.credits.length!==row.studioIds.length)fail();
      const seen=new Set();
      for(const credit of row.credits){
        if(!positive(credit.id)||seen.has(credit.id)||!row.studioIds.includes(credit.id)||
          credit.type!==2||credit.relation!=='动画制作'||!text(credit.name)||typeof credit.eps!=='string'||
          !directory.get(credit.id)?.aliases.includes(credit.name))fail();
        seen.add(credit.id);counts.set(credit.id,counts.get(credit.id)+1);
      }
      if(!row.studioIds.length&&!['no-animation-production-credit','public-subject-unavailable'].includes(row.reason))fail();
      if(row.studioIds.length&&row.reason!==undefined)fail();
    }
    if(row.status==='classified')classified++;
    records.set(row.id,row);
  }
  if(classified!==studios.classifiedCount||[...directory.values()].some(x=>counts.get(x.id)!==x.count))fail();
  return records;
}
export function applyStudios(items,records){
  return items.map(item=>({...item,studioIds:records.get(item.id)?.studioIds||[],studio:records.get(item.id)}));
}
export function studioOptions(directory,selected,query=''){
  const chosen=new Set(selected),q=query.normalize('NFKC').toLocaleLowerCase('zh-TW').trim();
  return directory.filter(x=>chosen.has(x.id)||[x.name,...x.aliases].some(name=>name.normalize('NFKC').toLocaleLowerCase('zh-TW').includes(q)))
    .slice().sort((a,b)=>Number(chosen.has(b.id))-Number(chosen.has(a.id))||b.count-a.count||a.name.localeCompare(b.name,'zh-Hant')||Number(a.id)-Number(b.id));
}
