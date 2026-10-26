import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifiedItems} from '../site/snapshot.mjs';
import {verifiedOfficialMetadata} from '../site/official-metadata.mjs';
const read=name=>readFile(new URL('../site/'+name,import.meta.url));
const [bytes,metadataBytes,mappingBytes]=await Promise.all([read('data.json'),read('official-metadata.json'),read('genre-map.json')]);
const snapshot=JSON.parse(bytes),metadata=JSON.parse(metadataBytes);
if(!verifiedItems(snapshot))throw Error('評分快照未通過驗證');
verifiedOfficialMetadata(snapshot,metadata,createHash('sha256').update(bytes).digest('hex'),JSON.parse(mappingBytes));
console.log(JSON.stringify({success:true,rankedCount:snapshot.items.length,classifiedCount:metadata.classifiedCount,
  studioClassifiedCount:metadata.studioClassifiedCount,companyCount:metadata.studios.length,
  officialStudioCount:metadata.officialStudioCount,supplementedStudioCount:metadata.supplementedStudioCount,
  notApplicableCount:metadata.notApplicableCount,unconfirmedStudioCount:metadata.unconfirmedStudioCount,
  officialGenreCount:metadata.officialGenreCount,supplementedGenreCount:metadata.supplementedGenreCount,unavailableCount:metadata.unavailableCount,
  ratingUpdatedAt:snapshot.updatedAt,checkedThrough:metadata.checkedThrough,metadataUpdatedAt:metadata.updatedAt,
  SHA256:createHash('sha256').update(metadataBytes).digest('hex')}));
