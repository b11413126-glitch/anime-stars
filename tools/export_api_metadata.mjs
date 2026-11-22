// Export only already-completed, independently validated public API facts.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validatePublicFields} from './official_metadata_driver.mjs';
const root=new URL('../',import.meta.url),read=name=>readFile(new URL(name,root));
const bytes=await read('site/data.json'),snapshot=JSON.parse(bytes),state=JSON.parse(await read('evidence/browser-current.json'));
if(state.protocolVersion!==2||state.success!==true||state.processed!==state.catalog.length||state.rows.length!==snapshot.items.length||
  state.updatedAt!==snapshot.updatedAt)throw Error('完整逐部驗證與收尾對帳尚未成功，不得建立分類檔');
const records=snapshot.items.map(item=>{
  const r=state.verified[item.id]?.record,a=r?.data.anime,v=r?.data.video;
  if(!a||v.videoSn!==item.availability.videoSn||a.animeSn!==Number(item.id.split('sn=')[1]))throw Error('公開API欄位與原評分快照身分不符');
  const row=validatePublicFields(item,{heading:a.title,acgId:String(a.acgSn),fields:[
    {label:'製作廠商',content:a.maker},{label:'首播日期',content:a.seasonStart},
    {label:'作品分類',tags:a.tags,tagListPresent:true}]});
  return {...row,checkedAt:r.checkedAt,sourceKind:'gamer-official-api',
    evidenceSourceURL:'https://api.gamer.com.tw/anime/v1/video.php?animeSn='+a.animeSn};
});
const times=records.map(x=>x.checkedAt).sort((a,b)=>Date.parse(a)-Date.parse(b));
const progress={schemaVersion:1,source:'gamer-official-api-work-metadata',complete:true,
  rankingSHA256:createHash('sha256').update(bytes).digest('hex'),rankingUpdatedAt:snapshot.updatedAt,
  rankingCount:records.length,checkedFrom:times[0],checkedThrough:times.at(-1),records};
await writeFile(new URL('evidence/official-metadata-progress.json.tmp',root),JSON.stringify(progress,null,2)+'\n');
await rename(new URL('evidence/official-metadata-progress.json.tmp',root),new URL('evidence/official-metadata-progress.json',root));
console.log(JSON.stringify({success:true,records:records.length,source:progress.source,checkedThrough:progress.checkedThrough}));
