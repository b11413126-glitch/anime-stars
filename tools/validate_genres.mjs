import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{verifiedItems}from'../site/snapshot.mjs';
import{verifiedGenres}from'../site/genres.mjs';
const read=name=>readFile(new URL('../site/'+name,import.meta.url));
const [bytes,genresBytes,mappingBytes]=await Promise.all([read('data.json'),read('genres.json'),read('genre-map.json')]);
const snapshot=JSON.parse(bytes),genres=JSON.parse(genresBytes),mapping=JSON.parse(mappingBytes);
verifiedItems(snapshot);
verifiedGenres(snapshot,genres,mapping,createHash('sha256').update(bytes).digest('hex'));
console.log(JSON.stringify({success:true,rankedCount:snapshot.items.length,classifiedCount:genres.classifiedCount,
  unclassifiedCount:snapshot.items.length-genres.classifiedCount,source:genres.source,
  ratingUpdatedAt:snapshot.updatedAt,genreUpdatedAt:genres.updatedAt,rankingSHA256:genres.rankingSHA256}));
