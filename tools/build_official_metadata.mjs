import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifiedOfficialMetadata,manufacturerNames} from '../site/official-metadata.mjs';
import {verifiedGenres} from '../site/genres.mjs';
import {verifiedStudios} from '../site/studios.mjs';
const root=new URL('../',import.meta.url),hash=x=>createHash('sha256').update(x).digest('hex');
const bytes=await readFile(new URL('site/data.json',root));
const snapshot=JSON.parse(bytes),progress=JSON.parse(await readFile(new URL('evidence/official-metadata-progress.json',root)));
if(progress.error||!progress.complete||progress.rankingSHA256!==hash(bytes))throw Error('逐部官方欄位尚未完整通過核對');
const oldGenreBytes=await readFile(new URL('site/genres.json',root));
const oldGenres=JSON.parse(oldGenreBytes),oldStudio=JSON.parse(await readFile(new URL('site/studios.json',root)));
const genreMapping=JSON.parse(await readFile(new URL('site/genre-map.json',root)));
const oldIdentities=verifiedGenres(snapshot,oldGenres,genreMapping,hash(bytes));
const oldStudios=verifiedStudios(snapshot,oldStudio,oldIdentities,hash(bytes),hash(oldGenreBytes));
const manual=JSON.parse(await readFile(new URL('tools/official_supplements.json',root)));
const normalized=name=>name.normalize('NFKC').toLocaleLowerCase('en-US').trim();
const aliasIndex=new Map();
for(const company of oldStudio.studios)for(const alias of company.aliases){
  const key=normalized(alias);if(!aliasIndex.has(key))aliasIndex.set(key,new Map());aliasIndex.get(key).set(company.id,company);
}
const cache=new URL('../../../work/classification-completion/cache/',import.meta.url);
const media=JSON.parse(await readFile(new URL('../../../work/classification-completion/media-type-evidence.json',import.meta.url)));
const notAnimation=new Map(media.records.filter(x=>x.animationStudioApplicability==='not-applicable').map(x=>[x.id,x]));
const supplemental=new Map();
const fallbackGenres=new Map();
for(const row of progress.records){
  if(notAnimation.has(row.id))continue;
  if(manufacturerNames(row.manufacturer).length)continue;
  const known=oldStudios.get(row.id),identity=oldIdentities.get(row.id);
  if(known?.status==='classified')supplemental.set(row.id,{
    source:'bangumi-animation-production',subjectId:known.subjectId,subjectName:identity.subjectName,
    checkedAt:known.checkedAt,identitySources:[{url:'https://bgm.tv/subject/'+known.subjectId,
      fact:'沿用既有已驗證對照：相同ACG編號、完整片名別名、原文與月份；原評分快照雜湊相同。'}],
    credits:known.credits.map(x=>({...x,id:Number(x.id),sourceURL:'https://api.bgm.tv/v0/subjects/'+known.subjectId+'/persons'}))});
  const candidate=manual[row.id];if(!candidate){if(row.officialUnavailable)throw Error('已到期作品尚無獨立分類補證：'+row.title);continue;}
  if(candidate.firstPartyEvidence||candidate.contemporaneousEvidence){
    const proof=candidate.firstPartyEvidence||candidate.contemporaneousEvidence;
    if(proof.status!=='verified'||proof.id!==row.id||proof.title!==row.title||!proof.companies.length)
      throw Error('第一方本作製作補證無效：'+row.title);
    const credits=proof.companies.map(x=>({name:x.name,originalRole:x.originalRole,sourceURL:x.sourceURL,
      fact:x.fact,checkedAt:x.checkedAt,relation:'actual-animation-production',
      ...(x.supportingSources?{supportingSources:x.supportingSources}:{})}));
    supplemental.set(row.id,{source:candidate.contemporaneousEvidence?'contemporaneous-production-report':'first-party-animation-production',
      ...(candidate.contemporaneousEvidence?{reportPublishedAt:proof.reportPublishedAt,reportAuthor:proof.reportAuthor}:{}),workTitle:row.title,sourceTitle:proof.canonicalTitle,
      scopeNote:proof.scopeNote||proof.scopeProof||proof.note,
      identitySources:proof.identitySources,checkedAt:credits.map(x=>x.checkedAt).sort((a,b)=>Date.parse(b)-Date.parse(a))[0],credits});
    continue;
  }
  if(candidate.publicWorkCredit){
    const proof=JSON.parse(await readFile(new URL('../../../work/classification-completion/'+candidate.publicWorkCredit,import.meta.url)));
    if(proof.workTitle!==row.title||proof.premiereDate!==row.premiereDate||proof.subjectId!==candidate.subjectId||
      proof.subjectName!==candidate.subjectName||proof.relation!=='动画制作')throw Error('公開逐作職務補證不符');
    supplemental.set(row.id,{...candidate,source:'bangumi-animation-production',checkedAt:proof.checkedAt,
      credits:[{id:proof.companyId,name:proof.companyName,type:2,relation:proof.relation,sourceField:'person-work-list',
        workId:proof.subjectId,workTitle:proof.workTitle,subjectName:proof.subjectName,premiereDate:proof.premiereDate,
        sourceDate:proof.sourceDate,sourceURL:proof.sourceURL,checkedAt:proof.checkedAt}]});
    continue;
  }
  const subject=JSON.parse(await readFile(new URL('subjects/'+candidate.subjectId+'.json',cache)));
  const staff=JSON.parse(await readFile(new URL('staff/'+candidate.subjectId+'.json',cache)));
  if(subject.unavailable||subject.data.type!==2||subject.data.name!==candidate.subjectName||staff.unavailable)
    throw Error('補查作品身分或公開職務無效：'+row.title);
  if(row.officialUnavailable){
    if(!candidate.genreFallback)throw Error('到期作品必須另有題材與身分證據');
    const crosswalkBytes=await readFile(new URL('../../../work/classification-source/bangumi-data.json',import.meta.url));
    if(hash(crosswalkBytes)!=='7e51a1066fe5f4322c2518186d01d6e1ec4eb36013700b7aebf40fc08a4fd542')throw Error('固定版本跨站資料雜湊不符');
    const item=snapshot.items.find(x=>x.id===row.id),gamerId=new URL(item.image).pathname.match(/^\/B\/ACG\/c\/\d+\/0*(\d+)\.[^.]+$/)?.[1];
    const crosswalk=JSON.parse(crosswalkBytes).items.filter(x=>(x.sites||[]).some(s=>s.site==='gamer'&&String(s.id)===gamerId));
    const aliases=x=>Object.values(x.titleTranslate||{}).flat();
    if(crosswalk.length!==1||!aliases(crosswalk[0]).includes(item.title)||
      !crosswalk[0].sites.some(s=>s.site==='bangumi'&&Number(s.id)===candidate.subjectId))throw Error('到期作品完整別名與ACG對照不唯一');
    const g={source:'bangumi-meta-tags',subjectId:candidate.subjectId,subjectType:subject.data.type,
      subjectName:subject.data.name,subjectDate:subject.data.date,gamerId,titleAlias:item.title,
      sourceURL:'https://api.bgm.tv/v0/subjects/'+candidate.subjectId,checkedAt:subject.checkedAt,
      crosswalkURL:'https://unpkg.com/bangumi-data@0.3.232/dist/data.json',crosswalkSHA256:hash(crosswalkBytes),
      rawTags:subject.data.meta_tags};
    const tags=[...new Set(g.rawTags.filter(x=>Object.hasOwn(genreMapping,x)).map(x=>genreMapping[x]))];
    if(!tags.length)throw Error('到期作品沒有已核對公共題材，不可捏造分類');
    fallbackGenres.set(row.id,{tags,genreSupplement:g});
  }
  const credits=staff.data.filter(x=>x.type===2&&x.relation==='动画制作').map(x=>({...x,
    sourceURL:'https://api.bgm.tv/v0/subjects/'+candidate.subjectId+'/persons'}));
  if(candidate.infoboxCompany){
    const matching=subject.data.infobox.filter(x=>x.key==='动画制作'&&x.value===candidate.infoboxCompany);
    if(matching.length!==1||!candidate.organizationEvidence?.length)throw Error('工作室補證與原始infobox不一致');
    credits.push({id:null,name:candidate.infoboxCompany,sourceType:'not-specified',sourceField:'infobox',
      relation:'动画制作',sourceURL:'https://api.bgm.tv/v0/subjects/'+candidate.subjectId,
      organizationEvidence:candidate.organizationEvidence});
  }
  if(!credits.length)throw Error('補查不能使用製作、代理或協力取代動畫製作：'+row.title);
  supplemental.set(row.id,{...candidate,source:'bangumi-animation-production',checkedAt:candidate.infoboxCompany?subject.checkedAt:staff.checkedAt,credits});
}
const companies=new Map();
const records=progress.records.map(row=>{
  row={...row,...(fallbackGenres.get(row.id)||{})};
  const nonAnimation=notAnimation.get(row.id);
  if(nonAnimation){
    if(nonAnimation.title!==row.title)throw Error('非動畫作品身分不一致');
    return {...row,studioIds:[],animationStudioApplicability:'not-applicable',mediaType:nonAnimation.mediaType,
      mediaEvidence:{sourceURL:nonAnimation.sourceURL,checkedAt:nonAnimation.checkedAt,
        canonicalTitle:nonAnimation.canonicalTitle,basis:nonAnimation.basis}};
  }
  const studioSupplement=supplemental.get(row.id);
  const names=manufacturerNames(row.manufacturer).length?manufacturerNames(row.manufacturer):
    [...new Set(studioSupplement?.credits.map(x=>x.name)||[])];
  const studioIds=names.map(name=>{
    const matches=aliasIndex.get(normalized(name)),known=matches?.size===1?[...matches.values()][0]:null;
    const id=known?.id||'official-'+hash(normalized(name)).slice(0,16);
    if(!companies.has(id))companies.set(id,{id,name,aliases:known?[...known.aliases]:[],count:0,
      ...(known?{identitySource:'https://api.bgm.tv/v0/persons/'+known.id}:{})});
    const company=companies.get(id);if(!company.aliases.includes(name))company.aliases.push(name);
    return id;
  });
  for(const id of new Set(studioIds))companies.get(id).count++;
  return {...row,...(studioSupplement?{studioSupplement}:{}),studioIds:[...new Set(studioIds)]};
});
const metadata={schemaVersion:1,source:progress.source,sourceURL:'https://ani.gamer.com.tw/',complete:true,
  updatedAt:new Date().toISOString(),
  rankingSHA256:hash(bytes),rankingUpdatedAt:snapshot.updatedAt,rankingCount:snapshot.items.length,
  checkedFrom:progress.checkedFrom,checkedThrough:progress.checkedThrough,
  classifiedCount:records.filter(x=>x.tags.length).length,studioClassifiedCount:records.filter(x=>x.studioIds.length).length,
  officialGenreCount:records.filter(x=>!x.officialUnavailable&&x.tags.length).length,
  supplementedGenreCount:records.filter(x=>x.genreSupplement).length,
  unavailableCount:records.filter(x=>x.officialUnavailable).length,
  officialStudioCount:records.filter(x=>x.animationStudioApplicability!=='not-applicable'&&manufacturerNames(x.manufacturer).length).length,
  supplementedStudioCount:records.filter(x=>x.studioSupplement).length,
  notApplicableCount:records.filter(x=>x.animationStudioApplicability==='not-applicable').length,
  unconfirmedStudioCount:records.filter(x=>x.animationStudioApplicability!=='not-applicable'&&!x.studioIds.length).length,
  companyAliasesSource:'Bangumi public person aliases, CC BY-SA 3.0',
  studios:[...companies.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'zh-Hant')),records};
verifiedOfficialMetadata(snapshot,metadata,hash(bytes),genreMapping);
await writeFile(new URL('site/official-metadata.json.tmp',root),JSON.stringify(metadata,null,2)+'\n');
await rename(new URL('site/official-metadata.json.tmp',root),new URL('site/official-metadata.json',root));
console.log(JSON.stringify({success:true,rankedCount:records.length,classifications:metadata.classifiedCount,
  studios:metadata.studioClassifiedCount,companyCount:companies.size,ratingUpdatedAt:snapshot.updatedAt,
  metadataCheckedThrough:metadata.checkedThrough,metadataUpdatedAt:metadata.updatedAt}));
