import{test}from'node:test';import assert from'node:assert/strict';import{rankItems,selectItems}from'../site/ranking.mjs';
import{verifiedItems,verifiedTags}from'../site/snapshot.mjs';
import{officialTags,readFilters,filterURL,ageCategory,workYears}from'../site/ranking.mjs';
import{MemberBrowserCollector}from'../tools/member_browser_driver.mjs';
import{verifiedGenres,applyGenres}from'../site/genres.mjs';
import{verifiedStudios,applyStudios,studioOptions}from'../site/studios.mjs';
function catalogDriver(apiIds){
  const driver=new MemberBrowserCollector({},{});
  driver.state={totalPages:null,nextCatalogPage:1,firstIds:['animeRef.php?sn=42','animeRef.php?sn=43'],catalog:[],pages:[]};
  driver.catalogPage=async()=>({totalPage:1,animeList:apiIds.map(animeSn=>({animeSn,title:'僅供目錄單元測試',dateInfo:'年份：2020/01',cover:''}))});
  driver.save=async()=>{};
  return driver;
}
test('HTML 與 API 首頁僅排序交換時保留完整作品集合',async()=>{
  const driver=catalogDriver([43,42]);
  const progress=await driver.catalogStep(1);
  assert.equal(progress.total,2);
  assert.deepEqual(driver.state.catalog.map(x=>x.id),['/animeRef.php?sn=43','/animeRef.php?sn=42']);
});
test('HTML 與 API 首頁作品集合改變時仍拒絕',async()=>{
  const driver=catalogDriver([42,44]);
  await assert.rejects(driver.catalogStep(1),/HTML 與 API 目錄不一致/);
  assert.equal(driver.state.catalog.length,0);
});
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

test('複選取交集，並同時套用名稱和人數，維持全站名次',()=>{
  const ranked=rankItems([
    {id:'a',title:'甲',score:5,votes:100,tags:['奇幻']},
    {id:'b',title:'乙 ABC',score:4.9,votes:80,tags:['奇幻','戀愛']},
    {id:'c',title:'丙 ABC',score:4.8,votes:20,tags:['奇幻','戀愛']},
    {id:'d',title:'丁 ABC',score:4.7,votes:90,tags:['戀愛']},
    {id:'e',title:'無標籤',score:4.6,votes:90,tags:[]}
  ]);
  const result=selectItems(ranked,'ＡＢＣ',50,['奇幻','戀愛']);
  assert.deepEqual(result.map(x=>[x.id,x.rank]),[['b',2]]);
  assert.equal(result[0].id,'b'); // The hero uses this first filtered row.
  assert.equal(selectItems(ranked,'',0,[]).length,5);
  assert.equal(selectItems(ranked,'',0,['不存在']).length,0);
  assert.deepEqual(ranked.map(x=>x.rank),[1,2,3,4,5]);
});

test('分類選項完整取自官方標籤，不隨目前搜尋結果消失',()=>{
  const items=[{tags:['奇幻','戀愛']},{tags:['科幻','奇幻']},{tags:[]}];
  assert.deepEqual(new Set(officialTags(items)),new Set(['奇幻','戀愛','科幻']));
  assert.equal(officialTags(items).length,3);
});

test('分享網址與重新整理可還原所有條件，保留其他網址參數',()=>{
  const filters={query:'星 & <作品>',minimum:123,tags:['奇幻','戀愛','奇幻'],year:'2023',age:'12',studios:[]};
  const url=filterURL('https://example.test/rank/?other=1&q=old&tag=old#list',filters);
  assert.deepEqual(readFilters(new URL(url).search),{...filters,tags:officialTags([{tags:filters.tags}])});
  assert.equal(new URL(url).searchParams.get('other'),'1');
  assert.equal(new URL(url).hash,'#list');
  const cleared=filterURL(url,{query:'',minimum:0,tags:[]});
  assert.equal(new URL(cleared).search,'?other=1');
  assert.deepEqual(readFilters('?min=-10&tag=無此題材&tag=無此題材'),{query:'',minimum:0,tags:['無此題材'],year:'',age:'',studios:[]});
  assert.equal(readFilters('?min=Infinity').minimum,0);
  assert.equal(readFilters('?min=12.8').minimum,12);
});

test('題材必須逐列有效，舊快照可讀取但不能冒充已驗證分類',()=>{
  assert.equal(verifiedTags({items:[{}]}),false);
  for(const tags of [undefined,null,'奇幻',[''],[' 奇幻'],['奇幻','奇幻'],[123]])
    assert.throws(()=>verifiedTags({officialTagsVerified:true,items:[{tags}]}));
  assert.equal(verifiedTags({officialTagsVerified:true,items:[{tags:[]},{tags:['奇幻']}]}),true);
});

test('來源只保留指定公開欄位，缺少官方題材就停止',async()=>{
  const driver=new MemberBrowserCollector({},{});
  driver.visit=async()=>{};
  const anime={animeSn:42,score:4.9,reviewCount:123,tags:['奇幻','戀愛'],star:'私人測試欄位',favorite:true};
  const video={animeSn:42,videoSn:100,upTime:'2020/01/01 00:00',downTime:'',watchingPermission:{pass:true},requestParentPassword:false,breakpoint:{privateTest:true}};
  driver.text=async()=>JSON.stringify({data:{anime,video}});
  const record=await driver.record(42);
  assert.deepEqual(Object.keys(record.data.anime).sort(),['animeSn','reviewCount','score','tags']);
  assert.equal('breakpoint' in record.data.video,false);
  assert.deepEqual(record.data.anime.tags,['奇幻','戀愛']);
  delete anime.tags;
  await assert.rejects(driver.record(42),/官方題材/);
});

test('目錄跨頁重複時整頁不採納，保存停止狀態且不繼續來源',async()=>{
  const driver=catalogDriver([42,43]);
  let calls=0;
  driver.catalogPage=async(page)=>{calls++;return {totalPage:2,animeList:(page===1?[42,43]:[43,44]).map(animeSn=>({animeSn,title:'目錄測試',dateInfo:'年份：2020/01'}))};};
  await driver.catalogStep(1);
  await assert.rejects(driver.catalogStep(1),/重複作品 ID/);
  assert.equal(driver.state.phase,'stopped');
  assert.equal(driver.state.pages.length,1);
  assert.equal(driver.state.catalog.length,2);
  await assert.rejects(driver.catalogStep(1),/來源已停止/);
  assert.equal(calls,2);
});

test('來源停止紀錄在真正導覽前阻止請求，錯誤批次不可接續',async()=>{
  const fs=await import('node:fs/promises');
  const base=new URL('./',import.meta.url);
  const root=await fs.mkdtemp(new URL('.category-guard-',base));
  const {pathToFileURL}=await import('node:url');
  const evidence=new URL('evidence/',pathToFileURL(root+'/'));
  await fs.mkdir(evidence);
  try{
    const blocked=new URL('source-blocked.json',evidence);
    await fs.writeFile(blocked,JSON.stringify({status:'blocked',automaticRetryAllowed:false}));
    let calls=0;
    const driver=new MemberBrowserCollector({goto:async()=>{calls++;}}, {}, {root});
    await assert.rejects(driver.visit('https://ani.gamer.com.tw/robots.txt'),/來源停止紀錄/);
    assert.equal(calls,0);
    await fs.unlink(blocked);
    const checkedFrom=new Date().toISOString();
    await fs.writeFile(new URL('browser-current.json',evidence),JSON.stringify({checkedFrom,officialTagsVerified:true}));
    await fs.writeFile(new URL('browser-driver.json',evidence),JSON.stringify({checkedFrom,error:'source refused'}));
    await assert.rejects(driver.resumeImportedRun(),/已有來源錯誤/);
    assert.equal(calls,0);
  }finally{
    for(const name of await fs.readdir(evidence))await fs.unlink(new URL(name,evidence));
    await fs.rmdir(evidence);await fs.rmdir(root);
  }
});

test('只有完整新目錄集合成功複查後才能清除首末頁變動狀態',async()=>{
  const driver=new MemberBrowserCollector({},{});
  driver.state={phase:'stopped',offset:2,catalog:[{id:'a'},{id:'b'}],error:'First catalog page changed during collection'};
  driver.save=async()=>{};
  driver.persist=async()=>({ok:true,membershipUnchanged:true});
  const recheck={state:{phase:'catalog',catalog:[{id:'b'},{id:'a'}],pages:[{page:1,count:2}],totalPages:1,nextCatalogPage:2}};
  await driver.reconcileCatalog(recheck);
  assert.equal(driver.state.error,undefined);
  assert.equal(driver.state.phase,'verify');
  driver.state.error='Official metadata refused access';
  await assert.rejects(driver.reconcileCatalog(recheck),/不可用目錄複查解除/);
});

test('年份、官方年齡、搜尋與最低人數交集仍保留全站名次',()=>{
  const items=rankItems([
    {id:'a',title:'動畫 A',score:5,votes:20,year:'2024/01',ageRating:'一般觀眾皆可觀賞。'},
    {id:'b',title:'動畫 B',score:4.9,votes:100,year:'2023/09',ageRating:'未滿12歲之兒童不宜觀賞。'},
    {id:'c',title:'動畫 C',score:4.8,votes:10,year:'2023/01',ageRating:'未滿18歲者不得觀賞。'}
  ]);
  assert.deepEqual(selectItems(items,'動畫',50,[],{year:'2023',age:'12'}).map(x=>x.rank),[2]);
  assert.equal(selectItems(items,'',0,[],{year:'2023'}).length,2);
  assert.equal(selectItems(items,'',0,[],{age:'0'}).length,1);
  assert.equal(selectItems(items,'',0,[],{year:'1800'}).length,0);
  assert.deepEqual(workYears(items),['2024','2023']);
});

test('官方年齡說明的兩種十八歲文字同組，不猜測未知說明',()=>{
  assert.equal(ageCategory('一般觀眾皆可觀賞。'),'0');
  for(const n of ['6','12','15','18'])assert.equal(ageCategory('未滿'+n+'歲者不宜觀賞。'),n);
  assert.equal(ageCategory('未滿18歲者不得觀賞，內容可能包含裸露與暴力。'),'18');
  assert.equal(ageCategory('未提供'), '');
  assert.equal(ageCategory(undefined), '');
});

test('年份分級分享網址可還原，清除篩選移除對應參數',()=>{
  const url=filterURL('https://example.test/?year=2020&age=18',{query:'動畫',minimum:100,tags:[],year:'2023',age:'0'});
  assert.deepEqual(readFilters(new URL(url).search),{query:'動畫',minimum:100,tags:[],year:'2023',age:'0',studios:[]});
  assert.equal(readFilters('?year=1800').year,'1800');
  assert.equal(readFilters('?year=abc&age=99').year,'');
  assert.equal(readFilters('?year=abc&age=99').age,'');
  const clean=filterURL(url,{query:'',minimum:0,tags:[]});
  assert.equal(new URL(clean).search,'');
});

test('兩輪完整目錄唯一集合相同後才可啟動逐部擷取',async()=>{
  function complete(ids){
    const d=new MemberBrowserCollector({},{});
    d.state={phase:'catalog',region:'TW',checkedFrom:'2026-10-22T00:00:00Z',totalPages:1,nextCatalogPage:2,
      catalog:ids.map(sn=>({id:'/animeRef.php?sn='+sn})),pages:[{page:1,totalPages:1,count:ids.length}]};
    d.save=async()=>{};d.persist=async()=>({ok:true,processed:0});return d;
  }
  const driver=complete([42,43]);
  await assert.rejects(driver.begin(),/兩輪完整目錄/);
  await assert.rejects(driver.confirmCatalog(complete([42,44])),/作品集合改變/);
  await assert.rejects(driver.confirmCatalog(complete([42,42])),/重複/);
  const proof=await driver.confirmCatalog(complete([43,42]));
  assert.equal(proof.catalogCount,2);assert.equal(proof.idSHA256.length,64);
  assert.equal((await driver.begin()).ok,true);
});

test('兩輪預檢不能接受漏頁，預檢後變更集合也不可開始',async()=>{
  const driver=new MemberBrowserCollector({},{});
  driver.state={phase:'catalog',region:'TW',totalPages:2,nextCatalogPage:3,
    catalog:[{id:'/animeRef.php?sn=42'}],pages:[{page:1,totalPages:2,count:1}]};
  driver.save=async()=>{};
  await assert.rejects(driver.confirmCatalog(driver),/分別讀取/);
  await assert.rejects(driver.confirmCatalog({state:structuredClone(driver.state)}),/缺頁/);
  driver.state={...driver.state,totalPages:1,nextCatalogPage:2,pages:[{page:1,totalPages:1,count:1}]};
  await driver.confirmCatalog({state:structuredClone(driver.state)});
  driver.state.catalog[0].id='/animeRef.php?sn=43';
  await assert.rejects(driver.begin(),/兩輪完整目錄/);
});

test('共用同一來源分頁的收集器共同遵守 2.6 秒間隔',async()=>{
  const times=[];
  const source={goto:async()=>times.push(Date.now()),getAXState:async()=>{}};
  const a=new MemberBrowserCollector(source,{}),b=new MemberBrowserCollector(source,{});
  a.assertSourceAllowed=b.assertSourceAllowed=async()=>{};
  await a.visit('https://example.test/first');await b.visit('https://example.test/second');
  assert.ok(times[1]-times[0]>=2590);
});

// Synthetic identities below are unit fixtures only; never website data.
function genreFixture(){
  const snapshot={updatedAt:'2026-10-18T00:00:00Z',items:[
    {id:'test-a',title:'測試甲',image:'https://p2.bahamut.com.tw/B/ACG/c/42/0000042.JPG',year:'2023/09',score:5,votes:100},
    {id:'test-b',title:'測試乙',image:'https://p2.bahamut.com.tw/B/ACG/c/43/0000043.JPG',year:'2024/01',score:4.9,votes:80}]};
  const hash='a'.repeat(64),mapping={'奇幻':'奇幻','战斗':'戰鬥'};
  const genres={schemaVersion:1,source:'bangumi-meta-tags',sourceURL:'https://bgm.tv/',license:'CC BY-SA 3.0',
    licenseURL:'https://creativecommons.org/licenses/by-sa/3.0/',updatedAt:'2026-10-23T03:00:00Z',
    checkedFrom:'2026-10-23T01:00:00Z',checkedThrough:'2026-10-23T02:00:00Z',
    rankingUpdatedAt:snapshot.updatedAt,rankingSHA256:hash,rankingCount:2,classifiedCount:1,
    crosswalk:{name:'bangumi-data',license:'CC BY 4.0',url:'https://unpkg.com/bangumi-data@0.3.232/dist/data.json',sha256:'b'.repeat(64)},
    records:[{id:'test-a',status:'classified',tags:['奇幻','戰鬥'],sourceTags:['奇幻','战斗'],checkedAt:'2026-10-23T01:30:00Z',
      match:{subjectId:1,gamerId:'42',titleAlias:'測試甲',month:'2023/09',sourceTitle:'試験一'},subjectName:'試験一',subjectDate:'2023-09-29'},
      {id:'test-b',status:'unclassified',tags:[],reason:'identity-not-confirmed'}]};
  return {snapshot,genres,mapping,hash};
}
test('外部題材與評分時間分開，未分類仍保留在完整排名',()=>{
  const {snapshot,genres,mapping,hash}=genreFixture(),before=JSON.stringify(snapshot);
  const records=verifiedGenres(snapshot,genres,mapping,hash),ranked=applyGenres(rankItems(snapshot.items),records);
  assert.equal(selectItems(ranked,'',0).length,2);
  assert.deepEqual(selectItems(ranked,'',0,['奇幻','戰鬥']).map(x=>x.rank),[1]);
  assert.deepEqual(ranked[1].tags,[]);assert.equal(ranked[1].genre.status,'unclassified');
  assert.equal(JSON.stringify(snapshot),before);assert.notEqual(genres.updatedAt,snapshot.updatedAt);
});
test('分類檔不能套在不同評分快照，漏列與重複列都拒絕',()=>{
  for(const change of [g=>g.rankingSHA256='c'.repeat(64),g=>g.rankingUpdatedAt=g.updatedAt,
    g=>g.records.pop(),g=>g.records[1]=structuredClone(g.records[0]),g=>g.classifiedCount=2]){
    const {snapshot,genres,mapping,hash}=genreFixture();change(genres);
    assert.throws(()=>verifiedGenres(snapshot,genres,mapping,hash));
  }
});
test('外部題材拒絕同名不同月、錯誤ACG編號、錯誤季別與任意標籤',()=>{
  for(const change of [r=>r.match.gamerId='99',r=>r.match.titleAlias='測試甲 第二季',
    r=>r.match.month='2024/09',r=>r.subjectDate='2024-09-29',r=>r.subjectName='別部作品',
    r=>r.tags.push('戀愛'),r=>r.sourceTags.push('隨意推測'),r=>r.checkedAt='2026-10-24T00:00:00Z']){
    const {snapshot,genres,mapping,hash}=genreFixture();change(genres.records[0]);
    assert.throws(()=>verifiedGenres(snapshot,genres,mapping,hash));
  }
});
test('空題材須有已核對證據，缺失不能冒充無題材或官方來源',()=>{
  const {snapshot,genres,mapping,hash}=genreFixture();
  genres.records[0].tags=[];genres.records[0].sourceTags=[];genres.records[0].status='unclassified';
  genres.records[0].reason='no-supported-public-genre';genres.classifiedCount=0;
  assert.equal(verifiedGenres(snapshot,genres,mapping,hash).size,2);
  delete genres.records[0].match;
  assert.throws(()=>verifiedGenres(snapshot,genres,mapping,hash));
  genres.source='official';assert.throws(()=>verifiedGenres(snapshot,genres,mapping,hash));
});

function studioFixture(){
  const fixture=genreFixture(),{snapshot,genres,mapping,hash}=fixture;
  const identities=verifiedGenres(snapshot,genres,mapping,hash),identityHash='d'.repeat(64);
  const studios={schemaVersion:1,source:'bangumi-animation-production',sourceURL:'https://bgm.tv/',role:'动画制作',roleId:67,
    license:'CC BY-SA 3.0',licenseURL:'https://creativecommons.org/licenses/by-sa/3.0/',
    updatedAt:'2026-10-24T03:00:00Z',checkedFrom:'2026-10-24T01:00:00Z',checkedThrough:'2026-10-24T02:00:00Z',
    rankingUpdatedAt:snapshot.updatedAt,rankingSHA256:hash,identitySHA256:identityHash,rankingCount:2,classifiedCount:1,
    studios:[{id:'11',name:'公司甲',aliases:['公司甲','Test Studio'],count:1},{id:'12',name:'公司乙',aliases:['公司乙'],count:1}],
    records:[{id:'test-a',studioIds:['11','12'],status:'classified',subjectId:1,checkedAt:'2026-10-24T01:30:00Z',
      credits:[{id:'11',name:'公司甲',type:2,relation:'动画制作',eps:''},{id:'12',name:'公司乙',type:2,relation:'动画制作',eps:'1-3'}]},
      {id:'test-b',studioIds:[],status:'unclassified',reason:'identity-not-confirmed'}]};
  return {...fixture,studios,identities,identityHash};
}
test('共同動畫製作全數保留，未知公司不排除全榜且不變更原始資料',()=>{
  const {snapshot,studios,identities,hash,identityHash}=studioFixture(),before=JSON.stringify(snapshot);
  const rows=verifiedStudios(snapshot,studios,identities,hash,identityHash);
  const items=applyStudios(rankItems(snapshot.items),rows);
  assert.deepEqual(items[0].studioIds,['11','12']);assert.equal(items[1].studio.status,'unclassified');
  assert.equal(selectItems(items,'',0).length,2);assert.equal(JSON.stringify(snapshot),before);
  assert.deepEqual(selectItems(items,'',0,[],{studios:['12']}).map(x=>x.rank),[1]);
});
test('公司複選為聯集，再與題材、搜尋、年份、分級及人數取交集',()=>{
  const items=rankItems([
    {id:'a',title:'動畫A',score:5,votes:20,tags:['奇幻'],studioIds:['11'],year:'2024/01',ageRating:'一般觀眾皆可觀賞。'},
    {id:'b',title:'動畫B',score:4.9,votes:100,tags:['奇幻','戀愛'],studioIds:['12'],year:'2023/01',ageRating:'未滿12歲者不宜觀賞。'},
    {id:'c',title:'動畫C',score:4.8,votes:100,tags:['戀愛'],studioIds:[],year:'2023/01',ageRating:'未滿12歲者不宜觀賞。'}]);
  assert.deepEqual(selectItems(items,'',0,[],{studios:['11','12']}).map(x=>x.rank),[1,2]);
  assert.deepEqual(selectItems(items,'動畫',50,['奇幻','戀愛'],{year:'2023',age:'12',studios:['11','12']}).map(x=>x.rank),[2]);
  assert.equal(selectItems(items,'',0,[],{studios:['999']}).length,0);
});
test('公司網址去重且拒絕非正整數，未知合法條件不偷偷取消',()=>{
  const filters={query:'動畫',minimum:3,tags:['奇幻'],year:'2023',age:'12',studios:['12','11']};
  const url=filterURL('https://example.test/?studio=5&other=1#list',filters);
  assert.deepEqual(readFilters(new URL(url).search),{...filters,studios:['11','12']});
  assert.deepEqual(readFilters('?studio=11&studio=11&studio=-2&studio=0&studio=1.2&studio=bad&studio=999').studios,['11','999']);
  assert.equal(new URL(filterURL(url,{query:'',minimum:0,tags:[]})).search,'?other=1');
});
test('公司依已確認作品數排序，別名搜尋且已選公司始終置頂',()=>{
  const directory=[{id:'1',name:'一',aliases:['Alpha'],count:2},{id:'2',name:'二',aliases:['Beta'],count:9},{id:'3',name:'三',aliases:['Gamma'],count:5}];
  assert.deepEqual(studioOptions(directory,[]).map(x=>x.id),['2','3','1']);
  assert.deepEqual(studioOptions(directory,['1'],'ＢＥＴＡ').map(x=>x.id),['1','2']);
  assert.equal(directory[0].id,'1');
});
test('公司檔拒絕錯誤快照、作品身分、任意公司、錯誤職務與灌水覆蓋率',()=>{
  for(const change of [s=>s.rankingSHA256='e'.repeat(64),s=>s.identitySHA256='e'.repeat(64),s=>s.records.pop(),
    s=>s.records[1]=structuredClone(s.records[0]),s=>s.records[0].subjectId=99,
    s=>s.records[0].credits[0].relation='制作协力',s=>s.records[0].credits[0].type=1,
    s=>s.records[0].studioIds.push('99'),s=>s.studios[0].count=9,s=>s.classifiedCount=2,
    s=>s.records[1].studioIds=['11'],s=>s.studios.push({id:'99',name:'無證據公司',aliases:['無證據公司'],count:1}),
    s=>s.records[0].checkedAt='2026-10-25T00:00:00Z',s=>s.role='製作']){
    const {snapshot,studios,identities,hash,identityHash}=studioFixture();change(studios);
    assert.throws(()=>verifiedStudios(snapshot,studios,identities,hash,identityHash));
  }
});
