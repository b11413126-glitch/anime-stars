// Public catalog receipts, independent of browser navigation and rating data.
import {createHash} from 'node:crypto';
const validID=id=>typeof id==='string'&&/^\/animeRef\.php\?sn=[1-9]\d*$/.test(id);
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const positive=x=>Number.isInteger(x)&&x>0;
export const idDigest=ids=>createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
function ids(value){
  if(!Array.isArray(value)||!value.length||value.some(x=>!validID(x))||new Set(value).size!==value.length)
    throw Error('同頁重複、無效或缺少作品ID');
  return value;
}
function frame(value){
  const first=value?.first,last=value?.last;
  if(!positive(first?.totalPages)||first.page!==1||last?.page!==first.totalPages||last.totalPages!==first.totalPages)
    throw Error('首頁與末頁頁數不可對帳');
  ids(first.ids);ids(last.ids);
  if(last.ids.length>first.ids.length)throw Error('末頁筆數超過實測每頁筆數');
  return {totalPages:first.totalPages,pageSize:first.ids.length,lastPageCount:last.ids.length,
    expectedTotal:(first.totalPages-1)*first.ids.length+last.ids.length};
}
export function analyzeCatalogPass(pass){
  if(!pass||!['1','2'].includes(String(pass.sort))||typeof pass.runId!=='string'||!pass.runId||
    !date(pass.checkedFrom)||!date(pass.completedAt)||Date.parse(pass.checkedFrom)>Date.parse(pass.completedAt))
    throw Error('完整目錄輪次、排序或時間無效');
  const start=frame(pass.anchors?.start),end=frame(pass.anchors?.end);
  if(JSON.stringify(start)!==JSON.stringify(end))throw Error('目錄首頁／末頁總數改變，不可對帳');
  if(!Array.isArray(pass.pages)||pass.pages.length!==start.totalPages)throw Error('完整目錄缺頁');
  const all=[],seen=new Map(),overlaps=[];
  for(let i=0;i<pass.pages.length;i++){
    const p=pass.pages[i],expected=i===start.totalPages-1?start.lastPageCount:start.pageSize;
    if(p.page!==i+1||p.totalPages!==start.totalPages||p.count!==expected||p.ids?.length!==p.count||
      !date(p.checkedAt)||Date.parse(p.checkedAt)<Date.parse(pass.checkedFrom)||Date.parse(p.checkedAt)>Date.parse(pass.completedAt))
      throw Error('目錄分頁筆數、頁碼或時間不一致');
    ids(p.ids);
    for(let position=0;position<p.ids.length;position++){
      const id=p.ids[position];
      if(seen.has(id))overlaps.push({id,first:seen.get(id),again:{page:p.page,position}});
      else seen.set(id,{page:p.page,position});
      all.push(id);
    }
  }
  return {...start,ids:new Set(all),overlaps};
}
export function validateCatalogProof(catalog,proof){
  if(proof?.version!==2||proof.source!=='gamer-page-count-reconciliation'||!date(proof.confirmedAt)||
    !Array.isArray(proof.passes)||proof.passes.length<2||
    new Set(proof.passes.map(x=>x.runId)).size!==proof.passes.length)
    throw Error('須有兩輪獨立完整目錄證據');
  const all=new Set(),analyses=proof.passes.map(analyzeCatalogPass),expected=analyses[0].expectedTotal;
  for(let i=0;i<proof.passes.length;i++){
    const pass=proof.passes[i],a=analyses[i];
    if(a.expectedTotal!==expected||Date.parse(pass.completedAt)>Date.parse(proof.confirmedAt)||
      (i&&Date.parse(pass.checkedFrom)<Date.parse(proof.passes[i-1].completedAt)))
      throw Error('兩輪總數不一致或輪次不獨立串行');
    for(const id of a.ids)all.add(id);
  }
  const overlaps=analyses.reduce((n,x)=>n+x.overlaps.length,0);
  if(overlaps&&new Set(proof.passes.map(x=>x.sort)).size<2)
    throw Error('跨頁重疊必須以另一官方排序交叉核對');
  if(all.size!==expected)throw Error(`目錄無法對帳：唯一ID ${all.size}，預期 ${expected}`);
  for(const pass of proof.passes)for(const f of Object.values(pass.anchors))
    for(const id of [...f.first.ids,...f.last.ids])if(!all.has(id))throw Error('首末頁作品不在完整聯集中');
  const actual=catalog.map(x=>x.id);
  if(new Set(actual).size!==actual.length||actual.some(x=>!validID(x))||actual.length!==expected||actual.some(x=>!all.has(x))||
    proof.expectedTotal!==expected||proof.catalogCount!==expected||proof.idSHA256!==idDigest(actual)||proof.overlapCount!==overlaps)
    throw Error('目錄證據、總數、覆蓋率或ID雜湊不符');
  return {expectedTotal:expected,overlapCount:overlaps,ids:all};
}
export function reconcileCatalogPasses(drivers){
  if(new Set(drivers).size!==drivers.length||drivers.some(x=>x.error||x.phase==='stopped'))throw Error('不能重複或接續錯誤輪次');
  const catalog=new Map();
  const passes=drivers.map(state=>{
    const pass={runId:state.runId,sort:state.catalogSort,checkedFrom:state.checkedFrom,completedAt:state.completedAt,
      anchors:structuredClone(state.anchors),pages:structuredClone(state.pages)};
    const a=analyzeCatalogPass(pass),rows=state.catalog.map(x=>x.id);
    if(new Set(rows).size!==rows.length||rows.length!==a.ids.size||rows.some(x=>!a.ids.has(x)))throw Error('輪次公開條目與頁面ID不符');
    for(const item of state.catalog)catalog.set(item.id,{...item});
    return pass;
  });
  const list=[...catalog.values()],proof={version:2,source:'gamer-page-count-reconciliation',
    expectedTotal:analyzeCatalogPass(passes[0]).expectedTotal,catalogCount:list.length,
    confirmedAt:new Date().toISOString(),passes,idSHA256:idDigest(list.map(x=>x.id)),
    overlapCount:passes.reduce((n,p)=>n+analyzeCatalogPass(p).overlaps.length,0)};
  validateCatalogProof(list,proof);
  return {catalog:list,proof};
}
export function planCatalogDelta(previous,next,removals=[],limit=20){
  const old=new Map(previous.map(x=>[x.id,x])),fresh=new Map(next.map(x=>[x.id,x]));
  if(old.size!==previous.length||fresh.size!==next.length)throw Error('增量目錄含重複');
  const added=next.filter(x=>!old.has(x.id)),removed=previous.filter(x=>!fresh.has(x.id));
  if(added.length+removed.length>limit)throw Error('目錄變動超出少量增量上限');
  const evidence=new Map(removals.map(x=>[x.id,x]));
  if(evidence.size!==removals.length||removals.length!==removed.length)throw Error('下架補證數量不符');
  for(const item of removed){
    const r=evidence.get(item.id),sn=item.availability?.videoSn||item.videoSn;
    if(!r||r.reason!=='confirmed-source-expiry'||r.message!=='目前無此動畫或動畫授權已到期！'||
      !date(r.checkedAt)||!positive(sn)||r.sourceURL!=='https://ani.gamer.com.tw/animeVideo.php?sn='+sn)
      throw Error('移除作品缺少本作官方下架補證');
  }
  const retained=next.filter(x=>old.has(x.id));
  return {addedIds:added.map(x=>x.id),removedIds:removed.map(x=>x.id),catalog:[...retained,...added],processed:retained.length};
}
