import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicFields,sameWorkTitle,OfficialMetadataCollector} from '../tools/official_metadata_driver.mjs';
import {verifiedOfficialMetadata,manufacturerNames,applyOfficialMetadata} from '../site/official-metadata.mjs';
const hash='a'.repeat(64),company='official-'+'b'.repeat(16);
function fixture(){
  const item={id:'/animeRef.php?sn=42',title:'僅供測試',year:'2020/01',image:'https://p2.bahamut.com.tw/B/ACG/c/2/0000042.JPG',availability:{videoSn:10},score:4.9,votes:10};
  const raw={heading:'僅供測試 [年齡限制版][1]',acgId:'42',fields:[
    {label:'首播日期',content:'2020/01/01'},
    {label:'製作廠商',content:'單元測試公司'},
    {label:'代理廠商',content:'不可誤收的代理'},
    {label:'作品分類',tags:['奇幻','動作']}],privateRating:'不可儲存',cookie:'不可儲存'};
  const record={...validatePublicFields(item,raw),checkedAt:'2026-10-26T00:01:00Z',studioIds:[company]};
  const snapshot={updatedAt:'2026-10-18T00:00:00Z',items:[item]};
  const metadata={schemaVersion:1,source:'gamer-rendered-work-metadata',sourceURL:'https://ani.gamer.com.tw/',complete:true,
    updatedAt:'2026-10-26T00:03:00Z',
    rankingSHA256:hash,rankingUpdatedAt:snapshot.updatedAt,rankingCount:1,
    checkedFrom:'2026-10-26T00:00:00Z',checkedThrough:'2026-10-26T00:02:00Z',
    classifiedCount:1,studioClassifiedCount:1,officialStudioCount:1,supplementedStudioCount:0,notApplicableCount:0,unconfirmedStudioCount:0,
    officialGenreCount:1,supplementedGenreCount:0,unavailableCount:0,
    records:[record],studios:[{id:company,name:'單元測試公司',aliases:['單元測試公司'],count:1}]};
  return {item,raw,snapshot,metadata};
}
test('官方影片公開欄位採用製作廠商，排除代理與私人欄位',()=>{
  const {item,raw}=fixture(),row=validatePublicFields(item,raw);
  assert.equal(row.manufacturer,'單元測試公司');assert.deepEqual(row.tags,['奇幻','動作']);
  assert.equal('privateRating' in row,false);assert.equal('cookie' in row,false);assert.equal('fields' in row,false);
  assert.equal(row.videoSn,10);assert.equal(row.sourceURL,'https://ani.gamer.com.tw/animeVideo.php?sn=10');
});
test('官方分類採固定影片與完整名稱核對，支援版本尾綴及非 ACG 封面',()=>{
  const {item,raw}=fixture();assert.equal(sameWorkTitle(raw.heading,item.title),true);
  assert.equal(sameWorkTitle('僅供測試 第二季 [1]',item.title),false);
  assert.throws(()=>validatePublicFields(item,{...raw,acgId:'99'}));
  assert.doesNotThrow(()=>validatePublicFields({...item,image:'https://p2.bahamut.com.tw/B/2KU/70/abcdef.JPG'},raw));
});
test('欄位缺失與來源明示空白分開，不能把解析失敗當成無分類',()=>{
  const {item,raw}=fixture();
  assert.throws(()=>validatePublicFields(item,{...raw,fields:raw.fields.filter(x=>x.label!=='作品分類')}));
  assert.throws(()=>validatePublicFields(item,{...raw,fields:[...raw.fields,{label:'製作廠商',content:'其他'}]}));
  const empty={...raw,fields:raw.fields.map(x=>x.label==='製作廠商'?{...x,content:''}:x.label==='作品分類'?{...x,tags:[],tagListPresent:true}:x)};
  assert.equal(validatePublicFields(item,empty).manufacturer,'');assert.deepEqual(manufacturerNames(''),[]);
});
test('完整官方分類必須逐部綁定原評分快照，篩選不更動分數',()=>{
  const {snapshot,metadata}=fixture(),records=verifiedOfficialMetadata(snapshot,metadata,hash);
  const applied=applyOfficialMetadata(snapshot.items,records);
  assert.deepEqual(applied[0].tags,['奇幻','動作']);assert.equal(applied[0].score,4.9);
  assert.equal(snapshot.items[0].tags,undefined);assert.equal(snapshot.updatedAt,'2026-10-18T00:00:00Z');
  assert.throws(()=>verifiedOfficialMetadata(snapshot,{...metadata,complete:false},hash));
  assert.throws(()=>verifiedOfficialMetadata(snapshot,metadata,'c'.repeat(64)));
  assert.throws(()=>verifiedOfficialMetadata(snapshot,{...metadata,records:[]},hash));
});
test('官方廠商不可替換成代理、外站或錯誤影片，覆蓋率必須正確',()=>{
  const {snapshot,metadata}=fixture();
  for(const change of [{sourceURL:'https://example.test/'},{videoSn:11},{manufacturer:'不可誤收的代理'},{acgId:'99'}])
    assert.throws(()=>verifiedOfficialMetadata(snapshot,{...metadata,records:[{...metadata.records[0],...change}]},hash));
  assert.throws(()=>verifiedOfficialMetadata(snapshot,{...metadata,classifiedCount:2},hash));
  assert.throws(()=>verifiedOfficialMetadata(snapshot,{...metadata,studios:[{...metadata.studios[0],count:2}]},hash));
});
test('官方空白僅能補已核對作品的動畫製作，不接受製作或OPED協力',()=>{
  const {snapshot,metadata}=fixture();
  metadata.officialStudioCount=0;metadata.supplementedStudioCount=1;
  const row=metadata.records[0];row.manufacturer='';
  row.studioSupplement={source:'bangumi-animation-production',subjectId:123,subjectName:'僅供測試原名',
    checkedAt:'2026-10-24T00:00:00Z',identitySources:[{url:'https://example.test/official-work',fact:'僅供測試：本作原名與完整片名對照'}],
    credits:[{id:999,name:'單元測試公司',type:2,relation:'动画制作',sourceURL:'https://api.bgm.tv/v0/subjects/123/persons'}]};
  assert.doesNotThrow(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
  for(const relation of ['製作','制作协力','OP・ED 动画制作']){
    const value=structuredClone(metadata);value.records[0].studioSupplement.credits[0].relation=relation;
    assert.throws(()=>verifiedOfficialMetadata(snapshot,value,hash));
  }
  const wrong=structuredClone(metadata);wrong.records[0].manufacturer='單元測試公司';
  assert.throws(()=>verifiedOfficialMetadata(snapshot,wrong,hash));
});
test('真人或現場不適用必須有作品類型證據，原廠商事實仍保留',()=>{
  const {snapshot,metadata}=fixture(),row=metadata.records[0];
  row.animationStudioApplicability='not-applicable';row.studioIds=[];
  metadata.studios=[];metadata.officialStudioCount=0;metadata.studioClassifiedCount=0;metadata.notApplicableCount=1;
  assert.throws(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
  row.mediaType='live-action-tokusatsu';row.mediaEvidence={sourceURL:'https://example.test/official-type',
    checkedAt:'2026-10-25T00:00:00Z',canonicalTitle:'僅供測試',basis:'僅供測試：本作品官方真人特攝分類'};
  assert.doesNotThrow(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
  assert.equal(row.manufacturer,'單元測試公司');
  row.mediaType='animation';assert.throws(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
});
test('同一已核對公司別名只計一部，既有公司 ID 可延用',()=>{
  const {snapshot,metadata}=fixture(),row=metadata.records[0];
  row.manufacturer='單元測試公司、TEST STUDIO';row.studioIds=['42'];
  metadata.studios=[{id:'42',name:'單元測試公司',aliases:['單元測試公司','TEST STUDIO'],
    count:1,identitySource:'https://api.bgm.tv/v0/persons/42'}];
  assert.doesNotThrow(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
  metadata.studios[0].identitySource='https://example.test/42';assert.throws(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
});
test('已排定下架的影片不偽造官方欄位，只允許完整的公共分類補證',()=>{
  const {snapshot,metadata}=fixture(),row=metadata.records[0];
  snapshot.items[0].availability.downTime='2026/10/22';
  Object.assign(row,{sourceTitle:null,acgId:null,premiereDate:null,manufacturer:null,tags:['冒險'],
    officialUnavailable:{reason:'snapshot-licence-expired',scheduledDownTime:'2026/10/22',observedAt:row.checkedAt,message:'目前無此動畫或動畫授權已到期！'},
    genreSupplement:{source:'bangumi-meta-tags',subjectId:123,subjectType:2,subjectName:'僅供測試原名',subjectDate:'2020-01-01',
      gamerId:'42',titleAlias:'僅供測試',sourceURL:'https://api.bgm.tv/v0/subjects/123',checkedAt:'2026-10-24T00:00:00Z',
      crosswalkURL:'https://unpkg.com/bangumi-data@0.3.232/dist/data.json',
      crosswalkSHA256:'7e51a1066fe5f4322c2518186d01d6e1ec4eb36013700b7aebf40fc08a4fd542',rawTags:['冒险']},
    studioSupplement:{source:'bangumi-animation-production',subjectId:123,subjectName:'僅供測試原名',checkedAt:'2026-10-24T00:00:00Z',
      identitySources:[{url:'https://example.test/official-work',fact:'測試用完整身分對照'}],
      credits:[{id:999,name:'單元測試公司',type:2,relation:'动画制作',sourceURL:'https://api.bgm.tv/v0/subjects/123/persons'}]}});
  Object.assign(metadata,{officialStudioCount:0,supplementedStudioCount:1,officialGenreCount:0,supplementedGenreCount:1,unavailableCount:1});
  assert.doesNotThrow(()=>verifiedOfficialMetadata(snapshot,metadata,hash,{'冒险':'冒險'}));
  for(const change of [{sourceTitle:'僅供測試 [1]'},{manufacturer:''},{tags:['奇幻']},
    {officialUnavailable:{...row.officialUnavailable,reason:'403'}},{genreSupplement:{...row.genreSupplement,gamerId:'99'}}])
    assert.throws(()=>verifiedOfficialMetadata(snapshot,{...metadata,records:[{...row,...change}]},hash,{'冒险':'冒險'}));
});
test('已停止的下架影片在任何導覽前拒絕重試',async()=>{
  let visited=false;const driver=new OfficialMetadataCollector({goto:async()=>{visited=true;}},{root:'測試不使用檔案',authorization:'測試'});
  driver.state={sourceStops:[{sourceURL:'https://ani.gamer.com.tw/animeVideo.php?sn=10',automaticRetryAllowed:false}]};
  await assert.rejects(driver.record(fixture().item),/不得重新請求/);assert.equal(visited,false);
});
test('第一方動畫公司補證保留本作範圍與原文，不捏造Bangumi型別或ID',()=>{
  const {snapshot,metadata}=fixture(),row=metadata.records[0];row.manufacturer='';
  row.studioSupplement={source:'first-party-animation-production',workTitle:row.title,sourceTitle:'Test Animation Season 2',
    scopeNote:'測試用：官方資料明確涵蓋第二季，不從第一季推定',checkedAt:'2026-10-26T00:01:00Z',
    identitySources:[{url:'https://example.test/official-season2',fact:'測試用：同一作品第二季身分'}],
    credits:[{name:'單元測試公司',relation:'actual-animation-production',originalRole:'2D Animation',
      sourceURL:'https://example.test/studio-project',fact:'測試用第一方本作動畫製作責任',checkedAt:'2026-10-26T00:01:00Z'}]};
  metadata.officialStudioCount=0;metadata.supplementedStudioCount=1;
  assert.doesNotThrow(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
  for(const change of [{workTitle:'其他季別'},{scopeNote:''},{identitySources:[]}])
    assert.throws(()=>verifiedOfficialMetadata(snapshot,{...metadata,records:[{...row,studioSupplement:{...row.studioSupplement,...change}}]},hash));
  const wrong=structuredClone(metadata);wrong.records[0].studioSupplement.credits[0].type=2;
  assert.throws(()=>verifiedOfficialMetadata(snapshot,wrong,hash));
});
test('同期原始報導不可冒充官方欄位，須同年日期、署名與兩個版本證據',()=>{
  const {snapshot,metadata}=fixture(),row=metadata.records[0];row.manufacturer='';
  row.studioSupplement={source:'contemporaneous-production-report',workTitle:row.title,sourceTitle:'測試用原名',
    scopeNote:'測試用：原始報導明確區分動畫製作與監修',checkedAt:'2026-10-26T00:01:00Z',
    reportPublishedAt:'2020-01-02',reportAuthor:'測試署名',
    identitySources:[{url:'https://example.test/official',fact:'測試用本作版本'},
      {url:'https://example.test/original-report',fact:'測試用同期版本資料'}],
    credits:[{name:'單元測試公司',relation:'actual-animation-production',originalRole:'制作',
      sourceURL:'https://example.test/original-report',fact:'測試用同期原始製作責任報導',checkedAt:'2026-10-26T00:01:00Z'}]};
  metadata.officialStudioCount=0;metadata.supplementedStudioCount=1;
  assert.doesNotThrow(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
  for(const change of [{reportPublishedAt:'2021-01-02'},{reportAuthor:''},{identitySources:row.studioSupplement.identitySources.slice(0,1)}])
    assert.throws(()=>verifiedOfficialMetadata(snapshot,{...metadata,records:[{...row,studioSupplement:{...row.studioSupplement,...change}}]},hash));
});
test('公共公司作品表補證須精確綁定作品、首播及動畫製作職務',()=>{
  const {snapshot,metadata}=fixture(),row=metadata.records[0];row.manufacturer='';
  row.studioSupplement={source:'bangumi-animation-production',subjectId:123,subjectName:'測試用原名',
    checkedAt:'2026-10-26T00:01:00Z',identitySources:[{url:'https://example.test/official',fact:'測試用本作身分'}],
    credits:[{id:999,name:'單元測試公司',type:2,relation:'动画制作',sourceField:'person-work-list',
      workId:123,workTitle:row.title,subjectName:'測試用原名',premiereDate:row.premiereDate,
      sourceURL:'https://bgm.tv/person/999/works#item_123'}]};
  metadata.officialStudioCount=0;metadata.supplementedStudioCount=1;
  assert.doesNotThrow(()=>verifiedOfficialMetadata(snapshot,metadata,hash));
  for(const change of [{workId:124},{premiereDate:'2021/01/01'},{relation:'OP・ED 动画制作'},
    {sourceURL:'https://bgm.tv/person/999/works#item_124'}]){
    const value=structuredClone(metadata);Object.assign(value.records[0].studioSupplement.credits[0],change);
    assert.throws(()=>verifiedOfficialMetadata(snapshot,value,hash));
  }
});
