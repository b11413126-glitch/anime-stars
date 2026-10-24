import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{verifiedItems}from'../site/snapshot.mjs';
import{verifiedGenres}from'../site/genres.mjs';
import{verifiedStudios}from'../site/studios.mjs';
const read=name=>readFile(new URL('../site/'+name,import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const [bytes,genresBytes,mappingBytes,studioBytes]=await Promise.all(['data.json','genres.json','genre-map.json','studios.json'].map(read));
const snapshot=JSON.parse(bytes),genres=JSON.parse(genresBytes),studios=JSON.parse(studioBytes);
if(!verifiedItems(snapshot))throw Error('評分快照尚未通過完整驗證');
const identities=verifiedGenres(snapshot,genres,JSON.parse(mappingBytes),hash(bytes));
verifiedStudios(snapshot,studios,identities,hash(bytes),hash(genresBytes));
console.log(JSON.stringify({success:true,rankedCount:snapshot.items.length,classifiedCount:studios.classifiedCount,
  unclassifiedCount:studios.rankingCount-studios.classifiedCount,companyCount:studios.studios.length,
  ratingUpdatedAt:snapshot.updatedAt,studioUpdatedAt:studios.updatedAt,studioSHA256:hash(studioBytes)}));
