// Run only inside cua_repl with the documented CUA Tab handles.
// Source access uses normal browser navigation; no cookies, auth headers or fetch.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.gamer.com.tw/';
const BASE = 'https://ani.gamer.com.tw/';
const SOURCE_TIMES = new WeakMap();

function catalogDigest(state){
  if(state.region!=='TW'||state.error||state.phase==='stopped'||!Number.isInteger(state.totalPages)||state.totalPages<1||
    state.pages.length!==state.totalPages||state.nextCatalogPage!==state.totalPages+1||
    state.pages.some((p,i)=>p.page!==i+1||p.totalPages!==state.totalPages||p.count<1)||
    state.pages.reduce((n,p)=>n+p.count,0)!==state.catalog.length)throw Error('完整目錄預檢缺頁或含錯誤');
  const ids=state.catalog.map(x=>x.id);
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!/^\/animeRef\.php\?sn=\d+$/.test(id)))
    throw Error('完整目錄預檢含重複或無效作品');
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

export class MemberBrowserCollector {
  constructor(sourceTab, importTab, {root=ROOT,catalogSort=1}={}) {
    this.sourceTab = sourceTab;
    this.importTab = importTab;
    this.nextSourceAt = 0;
    this.state = null;
    this.root = root;
    if(![1,2].includes(catalogSort))throw Error('未知官方目錄排序');
    this.catalogSort = catalogSort;
  }
  async save() {
    const target = path.join(this.root, 'evidence/browser-driver.json');
    await fs.writeFile(target + '.tmp', JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(target + '.tmp', target);
  }
  async resumeImportedRun() {
    await this.assertSourceAllowed();
    const saved = JSON.parse(await fs.readFile(path.join(this.root, 'evidence/browser-current.json'), 'utf8'));
    if (saved.success) throw Error('既有驗證已完成，請檢查日期後建立新的一日更新');
    const taipeiDate=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
    if(saved.error||saved.officialTagsVerified!==true||taipeiDate(saved.checkedFrom)!==taipeiDate(Date.now()))
      throw Error('跨日、既有錯誤或未驗證題材的批次不可接續');
    let previous;
    try{previous=JSON.parse(await fs.readFile(path.join(this.root,'evidence/browser-driver.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(previous?.checkedFrom===saved.checkedFrom&&previous.error)throw Error('此批次已有來源錯誤，不可接續');
    if(!saved.catalogPrecheck)throw Error('未通過兩輪目錄預檢的舊批次不可接續');
    this.state = {phase:'verify', checkedFrom:saved.checkedFrom, region:saved.region,
      catalogSort:saved.catalogSort||1,
      catalogPrecheck:saved.catalogPrecheck,
      robots:saved.robots, catalog:saved.catalog, pages:saved.pages,
      totalPages:saved.pages.length, nextCatalogPage:saved.pages.length+1, offset:saved.processed};
    await this.save();
    return this.progress();
  }
  progress() {
    return {phase:this.state.phase,pages:this.state.pages.length,totalPages:this.state.totalPages,
      processed:this.state.offset,total:this.state.catalog.length,error:this.state.error||null};
  }
  async visit(url) {
    await this.assertSourceAllowed();
    if(this.state?.phase==='stopped')throw Error('來源已停止，必須重新確認原因');
    const wait = Math.max(this.nextSourceAt,SOURCE_TIMES.get(this.sourceTab)||0) - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.nextSourceAt = Date.now() + 2600;
    SOURCE_TIMES.set(this.sourceTab,this.nextSourceAt);
    await this.sourceTab.goto(url);
    await this.sourceTab.getAXState({emit:false});
  }
  async assertSourceAllowed(){
    let block;
    try{block=JSON.parse(await fs.readFile(path.join(this.root,'evidence/source-blocked.json'),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(block?.status==='blocked'&&block.automaticRetryAllowed===false)
      throw Error('來源停止紀錄尚未解除，需來源修復證據或使用者明確核准重新嘗試');
  }
  async stopped(error){
    if(this.state){this.state.phase='stopped';this.state.error=String(error);await this.save();}
  }
  async text() { return this.sourceTab.playwright.locator('body').innerText(); }
  async catalogPage(page) {
    await this.visit(API+'anime/v1/anime_list.php?page='+page+'&tags=%E5%85%A8%E9%83%A8&category=%E5%85%A8%E9%83%A8&target=%E5%85%A8%E9%83%A8&sort='+(this.state?.catalogSort||this.catalogSort));
    const json = JSON.parse(await this.text());
    if (json.error) throw Error(JSON.stringify(json.error));
    const data = json.data;
    if (!Number.isInteger(data.totalPage)||!Array.isArray(data.animeList)||!data.animeList.length)
      throw Error('目錄格式或分頁不明');
    return data;
  }
  async record(sn) {
    await this.visit(API+'anime/v1/video.php?animeSn='+sn);
    const json = JSON.parse(await this.text());
    if (json.error) throw Error(JSON.stringify(json.error));
    const a=json.data.anime,v=json.data.video;
    if (v.watchingPermission?.pass!==true||v.requestParentPassword!==false)
      throw Error(JSON.stringify({animeSn:sn,permission:v.watchingPermission,parent:v.requestParentPassword}));
    if(!Array.isArray(a.tags)||a.tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag!==tag.trim())||
      new Set(a.tags).size!==a.tags.length)throw Error('官方題材欄位缺漏或無效');
    return {animeSn:sn,checkedAt:new Date().toISOString(),data:{
      anime:{animeSn:a.animeSn,score:a.score,reviewCount:a.reviewCount,tags:[...a.tags]},
      video:{animeSn:v.animeSn,videoSn:v.videoSn,upTime:v.upTime,downTime:v.downTime,
        watchingPermission:{pass:true},requestParentPassword:v.requestParentPassword,ratingDesc:v.ratingDesc||''}}};
  }
  async persist(payload) {
    await this.importTab.goto('http://127.0.0.1:8017');
    await this.importTab.getAXState({emit:false});
    await this.importTab.playwright.locator('#payload').fill(JSON.stringify(payload));
    await this.importTab.playwright.getByRole('button',{name:'儲存驗證批次',exact:true}).click();
    await this.importTab.getAXState({emit:false});
    const result=JSON.parse(await this.importTab.playwright.locator('#result').innerText());
    if (!result.ok) throw Error(JSON.stringify(result));
    return result;
  }
  async initialize() {
    const robots={};
    await this.visit(BASE+'robots.txt'); robots[BASE]=await this.text();
    await this.visit(API+'robots.txt'); robots[API]=await this.text();
    await this.persist({kind:'robots',robots,delaySeconds:2.6});
    await this.visit(BASE+'animeList.php?page=1&sort='+this.catalogSort);
    const region=await this.sourceTab.playwright.locator('html').getAttribute('data-geo');
    if (region!=='TW') throw Error('目錄地區不是台灣');
    const firstIds=await this.sourceTab.playwright.locator('a.theme-list-main').evaluateAll(nodes=>nodes.map(x=>x.getAttribute('href')));
    this.state={phase:'catalog',checkedFrom:new Date().toISOString(),region,robots,firstIds,
      catalogSort:this.catalogSort,
      catalog:[],pages:[],totalPages:null,nextCatalogPage:1,offset:0};
    await this.save();
    return this.progress();
  }
  async catalogStep(limit=20) {
    const state=this.state;
    if(state.phase==='stopped'||state.error)throw Error('來源已停止');
    if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('每批最多 20 頁');
    try{
    for(let n=0;n<limit&&(state.totalPages===null||state.nextCatalogPage<=state.totalPages);n++) {
      const page=state.nextCatalogPage,data=await this.catalogPage(page);
      if (state.totalPages===null) state.totalPages=data.totalPage;
      if (state.totalPages!==data.totalPage) throw Error('目錄頁數改變');
      // HTML and API may reorder equally dated works between requests.
      // Require identical membership, while catalog iteration still rejects duplicates.
      if(page===1&&JSON.stringify([...state.firstIds].sort())!==JSON.stringify(data.animeList.map(x=>'animeRef.php?sn='+x.animeSn).sort()))
        throw Error('HTML 與 API 目錄不一致');
      const pageItems=[];
      for(const x of data.animeList) {
        const id='/animeRef.php?sn='+x.animeSn;
        if(state.catalog.some(y=>y.id===id)||pageItems.some(y=>y.id===id)) throw Error(`重複作品 ID：第 ${page} 頁 ${id}`);
        const year=(x.dateInfo||'').match(/年份[：:]\s*(\d{4}(?:\/\d{2})?)/)?.[1];
        if(!year) throw Error('年份缺漏');
        pageItems.push({id,title:x.title,url:BASE.slice(0,-1)+id,year,image:x.cover});
      }
      state.catalog.push(...pageItems);
      state.pages.push({page,totalPages:data.totalPage,count:data.animeList.length,checkedAt:new Date().toISOString()});
      state.nextCatalogPage++;
    }
    await this.save();
    return this.progress();
    }catch(error){await this.stopped(error);throw error;}
  }
  async probe() {
    try{
    const first=this.state.catalog.slice(0,3).map(x=>Number(x.id.split('sn=')[1]));
    if(this.state.catalog.some(x=>x.id==='/animeRef.php?sn=114209')) first.push(114209);
    const records=[];
    for(const sn of [...new Set(first)]) records.push(await this.record(sn));
    return await this.persist({kind:'probe',records});
    }catch(error){await this.stopped(error);throw error;}
  }
  async begin() {
    if(this.state.nextCatalogPage!==this.state.totalPages+1) throw Error('目錄未完成');
    if(!this.state.catalogPrecheck||this.state.catalogPrecheck.idSHA256!==catalogDigest(this.state))
      throw Error('須先以 confirmCatalog 完成兩輪完整目錄核對，才可逐部擷取');
    const result=await this.persist({kind:'begin',catalog:this.state.catalog,pages:this.state.pages,
      catalogSort:this.state.catalogSort,
      catalogPrecheck:this.state.catalogPrecheck,
      region:this.state.region,checkedFrom:this.state.checkedFrom,robots:this.state.robots,delaySeconds:2.6});
    this.state.phase='verify'; this.state.offset=0; await this.save(); return result;
  }
  async confirmCatalog(otherDriver){
    if(otherDriver===this||otherDriver.state===this.state)throw Error('兩輪目錄必須分別讀取，不能重複使用同一輪');
    const first=catalogDigest(this.state),second=catalogDigest(otherDriver.state);
    if(first!==second)throw Error('兩輪完整目錄作品集合改變，不啟動逐部擷取');
    this.state.catalogPrecheck={confirmedAt:new Date().toISOString(),idSHA256:first,
      catalogCount:this.state.catalog.length,pageCounts:[this.state.pages.length,otherDriver.state.pages.length],
      firstCheckedFrom:this.state.checkedFrom,secondCheckedFrom:otherDriver.state.checkedFrom};
    await this.save();return {...this.state.catalogPrecheck,ok:true};
  }
  async step(limit=20) {
    if(this.state.phase!=='verify'||this.state.error) throw Error('此來源已停止或未準備好');
    if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('每批最多 20 部');
    const records=[];
    try {
      for(let i=this.state.offset;i<Math.min(this.state.offset+limit,this.state.catalog.length);i++)
        records.push(await this.record(Number(this.state.catalog[i].id.split('sn=')[1])));
      const result=await this.persist({kind:'batch',offset:this.state.offset,records});
      this.state.offset=result.processed; await this.save(); return result;
    } catch(error) {
      this.state.phase='stopped'; this.state.error=String(error); await this.save();
      throw error;
    }
  }
  async reconcileCatalog(recheckDriver) {
    const current = recheckDriver.state;
    if(current.error||current.phase==='stopped'||current.nextCatalogPage!==current.totalPages+1) throw Error('複查目錄尚未完成');
    if(this.state.error&&!/First catalog page changed|Last catalog page changed|Catalog page count changed|目錄頁數改變/.test(this.state.error))
      throw Error('來源拒絕或解析失敗，不可用目錄複查解除');
    const result=await this.persist({kind:'recheck',catalog:current.catalog,pages:current.pages,
      catalogSort:current.catalogSort,
      region:current.region,robots:current.robots,delaySeconds:2.6});
    this.state.catalog=current.catalog; this.state.pages=current.pages;
    this.state.totalPages=current.totalPages;this.state.catalogSort=current.catalogSort;this.state.phase='verify';delete this.state.error;
    await this.save(); return result;
  }
  async finish() {
    if(this.state.offset!==this.state.catalog.length||this.state.error) throw Error('完整驗證尚未完成');
    try{
    const first=await this.catalogPage(1),last=await this.catalogPage(this.state.totalPages);
    if(first.totalPage!==last.totalPage) throw Error('目錄頁數改變');
    const result=await this.persist({kind:'finish',firstIds:first.animeList.map(x=>'/animeRef.php?sn='+x.animeSn),
      lastIds:last.animeList.map(x=>'/animeRef.php?sn='+x.animeSn),totalPages:last.totalPage});
    this.state.phase='complete'; await this.save(); return result;
    }catch(error){await this.stopped(error);throw error;}
  }
}
