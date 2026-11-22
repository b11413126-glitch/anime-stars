// Retain historical public fallback facts only when the new official identity
// is exactly the same. New works remain explicitly unconfirmed in fallbacks;
// current official genres/manufacturers are supplied by official-metadata.json.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {verifiedItems} from '../site/snapshot.mjs';
import {verifiedGenres,coverID} from '../site/genres.mjs';
import {verifiedStudios} from '../site/studios.mjs';
import {verifiedOfficialMetadata} from '../site/official-metadata.mjs';
if(!process.argv[2])throw Error('需提供完整舊版基準專案路徑');
const root=new URL('../',import.meta.url),baseline=pathToFileURL(path.resolve(process.argv[2])+path.sep);
if(root.href===baseline.href)throw Error('基準不能是正在產生的新快照');
const read=(base,name)=>readFile(new URL(name,base)),hash=b=>createHash('sha256').update(b).digest('hex');
const [bytes,oldBytes,oldGenreBytes,oldStudioBytes,oldMetadataBytes,progressBytes,mapBytes,stateBytes]=await Promise.all([
  read(root,'site/data.json'),read(baseline,'site/data.json'),read(baseline,'site/genres.json'),read(baseline,'site/studios.json'),
  read(baseline,'site/official-metadata.json'),read(root,'evidence/official-metadata-progress.json'),read(root,'site/genre-map.json'),read(root,'evidence/browser-current.json')]);
const snapshot=JSON.parse(bytes),old=JSON.parse(oldBytes),genres=JSON.parse(oldGenreBytes),studios=JSON.parse(oldStudioBytes),
  oldMetadata=JSON.parse(oldMetadataBytes),progress=JSON.parse(progressBytes),mapping=JSON.parse(mapBytes),state=JSON.parse(stateBytes);
if(!verifiedItems(old)||!verifiedItems(snapshot)||!state.success||state.updatedAt!==snapshot.updatedAt||
  !progress.complete||progress.rankingSHA256!==hash(bytes))throw Error('新舊完整快照或官方分類尚未通過');
const oldIdentities=verifiedGenres(old,genres,mapping,hash(oldBytes));
const oldCredits=verifiedStudios(old,studios,oldIdentities,hash(oldBytes),hash(oldGenreBytes));
const oldOfficial=verifiedOfficialMetadata(old,oldMetadata,hash(oldBytes),mapping);
const freshOfficial=new Map(progress.records.map(x=>[x.id,x])),oldItems=new Map(old.items.map(x=>[x.id,x]));
const retain=new Set(snapshot.items.filter(item=>{const previous=oldItems.get(item.id),a=oldOfficial.get(item.id),b=freshOfficial.get(item.id),identity=oldIdentities.get(item.id)?.match;
  return previous&&previous.title===item.title&&previous.year===item.year&&a?.acgId&&a.acgId===b?.acgId&&
    identity&&identity.gamerId===coverID(item.image)&&identity.month===item.year;}).map(x=>x.id));
const genreRows=snapshot.items.map(item=>retain.has(item.id)?structuredClone(oldIdentities.get(item.id)):
  {id:item.id,status:'unclassified',reason:'identity-not-confirmed',tags:[]});
const newGenres={...genres,updatedAt:new Date().toISOString(),rankingUpdatedAt:snapshot.updatedAt,
  rankingSHA256:hash(bytes),rankingCount:snapshot.items.length,records:genreRows,
  classifiedCount:genreRows.filter(x=>x.status==='classified').length};
const encodedGenres=Buffer.from(JSON.stringify(newGenres,null,2)+'\n');
const identities=verifiedGenres(snapshot,newGenres,mapping,hash(bytes));
const studioRows=snapshot.items.map(item=>retain.has(item.id)?structuredClone(oldCredits.get(item.id)):
  {id:item.id,status:'unclassified',reason:'identity-not-confirmed',studioIds:[]});
const counts=new Map();for(const row of studioRows)for(const id of row.studioIds)counts.set(id,(counts.get(id)||0)+1);
const newStudios={...studios,updatedAt:new Date().toISOString(),rankingUpdatedAt:snapshot.updatedAt,rankingSHA256:hash(bytes),
  identitySHA256:hash(encodedGenres),rankingCount:snapshot.items.length,records:studioRows,
  classifiedCount:studioRows.filter(x=>x.status==='classified').length,
  studios:studios.studios.filter(x=>counts.has(x.id)).map(x=>({...x,count:counts.get(x.id)}))};
verifiedStudios(snapshot,newStudios,identities,hash(bytes),hash(encodedGenres));
for(const [name,data] of [['genres.json',encodedGenres],['studios.json',Buffer.from(JSON.stringify(newStudios,null,2)+'\n')]]){
  await writeFile(new URL('site/'+name+'.tmp',root),data);await rename(new URL('site/'+name+'.tmp',root),new URL('site/'+name,root));
}
console.log(JSON.stringify({success:true,rankingCount:snapshot.items.length,retainedVerifiedIdentities:retain.size,
  fallbackGenreCount:newGenres.classifiedCount,fallbackStudioCount:newStudios.classifiedCount,
  historicalSourceTimesPreserved:true,officialDataProvidedSeparately:true}));
