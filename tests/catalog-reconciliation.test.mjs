// Small synthetic fixtures exercise protocol behavior; never published as ranking data.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {reconcileCatalogPasses,validateCatalogProof,planCatalogDelta} from '../tools/catalog_reconciliation.mjs';
import {MemberBrowserCollector} from '../tools/member_browser_driver.mjs';
const id=n=>'/animeRef.php?sn='+n;
test('導覽指令逾時但同一官方文件已有效呈現時讀取原文件，不重送請求',async()=>{
  const url='https://api.gamer.com.tw/anime/v1/video.php?animeSn=42';let requests=0;
  const source={goto:async()=>{requests++;throw Error('Timed out running CDP command "Page.navigate"');},url:async()=>url,
    playwright:{evaluate:async()=>true}};
  const d=new MemberBrowserCollector(source,{});d.state={phase:'verify'};d.assertSourceAllowed=async()=>{};
  await d.visit(url);assert.equal(requests,1);assert.equal(d.state.navigationRecoveries.length,1);
  source.playwright.evaluate=async()=>false;d.nextSourceAt=0;
  await assert.rejects(d.visit(url),/Timed out/);assert.equal(requests,2);
});
function pass(rows,sort,start=0){
  const time=n=>new Date(Date.UTC(2026,10,22,0,0,start+n)).toISOString();
  const pages=rows.map((r,i)=>({page:i+1,totalPages:rows.length,count:r.length,ids:r.map(id),checkedAt:time(i+1)}));
  const frame={first:{page:1,totalPages:rows.length,ids:pages[0].ids},last:{page:rows.length,totalPages:rows.length,ids:pages.at(-1).ids}};
  return {runId:'unit-'+sort+'-'+start,catalogSort:sort,phase:'catalog',checkedFrom:time(0),completedAt:time(rows.length+1),
    anchors:{start:structuredClone(frame),end:structuredClone(frame)},pages,
    catalog:[...new Set(rows.flat())].map(n=>({id:id(n),title:'測試'+n,url:'https://ani.gamer.com.tw'+id(n),year:'2020',image:''}))};
}
test('跨頁邊界重疊被完整記錄，雙排序總數吻合可通過',()=>{
  const a=pass([[1,2],[2,3]],1),b=pass([[4,3],[2,1]],2,10);
  const result=reconcileCatalogPasses([a,b]);assert.equal(result.catalog.length,4);assert.equal(result.proof.overlapCount,1);
  assert.equal(validateCatalogProof(result.catalog,result.proof).expectedTotal,4);
});
test('翻頁偏移漏抓且聯集仍少於預期總數，必須拒絕',()=>{
  assert.throws(()=>reconcileCatalogPasses([pass([[1,2],[2,3]],1),pass([[3,2],[2,1]],2,10)]),/唯一ID 3，預期 4/);
});
test('兩個有偏移的排序可互補，不能靠同一輪去重冒充',()=>{
  const a=pass([[1,2],[2,3]],1),b=pass([[4,3],[3,2]],2,10);
  assert.equal(reconcileCatalogPasses([a,b]).catalog.length,4);
  assert.throws(()=>reconcileCatalogPasses([a,a]),/重複/);
  assert.throws(()=>reconcileCatalogPasses([a,{...b,catalogSort:1}]),/另一官方排序/);
});
test('拒絕單頁重複、缺頁、膨脹聯集及被竄改的證據',()=>{
  assert.throws(()=>reconcileCatalogPasses([pass([[1,1],[2,3]],1),pass([[1,2],[3,4]],2,10)]),/同頁重複/);
  const a=pass([[1,2],[3,4]],1),b=pass([[1,2],[3,4]],2,10);
  const missing=structuredClone(b);missing.pages.pop();assert.throws(()=>reconcileCatalogPasses([a,missing]),/缺頁/);
  assert.throws(()=>reconcileCatalogPasses([a,pass([[1,2],[4,5]],2,10)]),/唯一ID 5，預期 4/);
  const result=reconcileCatalogPasses([a,b]);result.proof.expectedTotal=3;
  assert.throws(()=>validateCatalogProof(result.catalog,result.proof),/不符/);
});
test('結尾順序交換沿用已驗證作品，新增作品排入補驗佇列',()=>{
  const old=[1,2].map(n=>({id:id(n),availability:{videoSn:n+10}}));
  const next=[2,3,1].map(n=>({id:id(n)}));const delta=planCatalogDelta(old,next);
  assert.deepEqual(delta.addedIds,[id(3)]);assert.deepEqual(delta.catalog.map(x=>x.id),[id(2),id(1),id(3)]);
  assert.equal(delta.processed,2);
});
test('移除須有固定影片官方到期補證，不能把缺項當下架',()=>{
  const old=[{id:id(1),availability:{videoSn:11}},{id:id(2),availability:{videoSn:12}}];
  assert.throws(()=>planCatalogDelta(old,[old[1]]),/下架補證/);
  const proof={id:id(1),reason:'confirmed-source-expiry',message:'目前無此動畫或動畫授權已到期！',
    checkedAt:'2026-11-22T00:10:00Z',sourceURL:'https://ani.gamer.com.tw/animeVideo.php?sn=11'};
  assert.deepEqual(planCatalogDelta(old,[old[1]],[proof]).removedIds,[id(1)]);
});
