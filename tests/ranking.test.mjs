import{test}from'node:test';import assert from'node:assert/strict';import{rankItems,selectItems}from'../site/ranking.mjs';
import{verifiedItems}from'../site/snapshot.mjs';
test('官方一位小數同分時忽略 API 浮點尾差，依評分人數排序',()=>{
  const source=[{id:'a',title:'甲',score:4.9000000000000004,votes:10},{id:'b',title:'乙',score:4.9,votes:100}];
  const result=rankItems(source);
  assert.deepEqual(result.map(x=>x.id),['b','a']);
  assert.deepEqual(result.map(x=>x.score),[4.9,4.9]);
  assert.equal(source[0].score,4.9000000000000004);
});
test('原始星等優先於人數，篩選後保留全站名次',()=>{const data=rankItems([{id:'a',title:'Alpha',score:5,votes:2},{id:'b',title:'Beta',score:4.9,votes:90000},{id:'c',title:'Gamma',score:5,votes:100}]);assert.deepEqual(data.map(x=>x.id),['c','a','b']);assert.deepEqual(selectItems(data,'beta',0).map(x=>x.rank),[3]);assert.equal(selectItems(data,'',50).length,2);});
test('拒絕無分數、非數字、重複作品與無評分人數',()=>{const valid={id:'x',title:'X',score:4.5,votes:10};assert.equal(rankItems([valid,valid,{...valid,id:'nan',score:NaN},{...valid,id:'null',score:null},{...valid,id:'zero',votes:0}]).length,1);});
test('全形搜尋可用且不變更輸入資料',()=>{const input=[{id:'x',title:'ABC 動畫',score:5,votes:10}];const ranked=rankItems(input);assert.equal(selectItems(ranked,'ＡＢＣ',0).length,1);assert.equal(input[0].rank,undefined);});
test('僅完成公開目錄或缺少台灣觀看證據時不顯示排名',()=>{
  assert.equal(verifiedItems({coverage:'complete-public-catalog',items:[]}),null);
  assert.equal(verifiedItems({coverage:'complete-tw-watchable-catalog',region:'TW',items:[]}),null);
});
test('完整快照中的無效列或重複作品使整份資料失效',()=>{
  const row={id:'/animeRef.php?sn=42',title:'僅供單元測試',score:4.9,votes:123,url:'https://ani.gamer.com.tw/animeRef.php?sn=42',availability:{pass:true,basis:'official-watching-permission',accessContext:'anonymous',videoSn:99}};
  const snapshot={schemaVersion:1,coverage:'complete-tw-watchable-catalog',region:'TW',playbackAvailabilityVerified:true,updatedAt:'2026-10-18T00:00:00Z',items:[row]};
  assert.equal(verifiedItems(snapshot).length,1);
  assert.throws(()=>verifiedItems({...snapshot,items:[row,row]}));
  assert.throws(()=>verifiedItems({...snapshot,items:[{...row,score:null}]}));
});
