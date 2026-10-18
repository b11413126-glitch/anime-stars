// Run only inside cua_repl with the documented CUA Tab handles.
// Source access uses normal browser navigation; no cookies, auth headers or fetch.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.gamer.com.tw/';
const BASE = 'https://ani.gamer.com.tw/';

export class MemberBrowserCollector {
  constructor(sourceTab, importTab) {
    this.sourceTab = sourceTab;
    this.importTab = importTab;
    this.nextSourceAt = 0;
    this.state = null;
  }
  async save() {
    const target = path.join(ROOT, 'evidence/browser-driver.json');
    await fs.writeFile(target + '.tmp', JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(target + '.tmp', target);
  }
  async resumeImportedRun() {
    const saved = JSON.parse(await fs.readFile(path.join(ROOT, 'evidence/browser-current.json'), 'utf8'));
    if (saved.success) throw Error('既有驗證已完成，請檢查日期後建立新的一日更新');
    this.state = {phase:'verify', checkedFrom:saved.checkedFrom, region:saved.region,
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
    const wait = this.nextSourceAt - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.nextSourceAt = Date.now() + 2600;
    await this.sourceTab.goto(url);
    await this.sourceTab.getAXState({emit:false});
  }
  async text() { return this.sourceTab.playwright.locator('body').innerText(); }
  async catalogPage(page) {
    await this.visit(API+'anime/v1/anime_list.php?page='+page+'&tags=%E5%85%A8%E9%83%A8&category=%E5%85%A8%E9%83%A8&target=%E5%85%A8%E9%83%A8&sort=1');
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
    return {animeSn:sn,checkedAt:new Date().toISOString(),data:{
      anime:{animeSn:a.animeSn,score:a.score,reviewCount:a.reviewCount},
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
    await this.visit(BASE+'animeList.php?page=1&sort=1');
    const region=await this.sourceTab.playwright.locator('html').getAttribute('data-geo');
    if (region!=='TW') throw Error('目錄地區不是台灣');
    const firstIds=await this.sourceTab.playwright.locator('a.theme-list-main').evaluateAll(nodes=>nodes.map(x=>x.getAttribute('href')));
    this.state={phase:'catalog',checkedFrom:new Date().toISOString(),region,robots,firstIds,
      catalog:[],pages:[],totalPages:null,nextCatalogPage:1,offset:0};
    await this.save();
    return this.progress();
  }
  async catalogStep(limit=20) {
    const state=this.state;
    for(let n=0;n<limit&&(state.totalPages===null||state.nextCatalogPage<=state.totalPages);n++) {
      const page=state.nextCatalogPage,data=await this.catalogPage(page);
      if (state.totalPages===null) state.totalPages=data.totalPage;
      if (state.totalPages!==data.totalPage) throw Error('目錄頁數改變');
      if(page===1&&JSON.stringify(state.firstIds)!==JSON.stringify(data.animeList.map(x=>'animeRef.php?sn='+x.animeSn)))
        throw Error('HTML 與 API 目錄不一致');
      for(const x of data.animeList) {
        const id='/animeRef.php?sn='+x.animeSn;
        if(state.catalog.some(y=>y.id===id)) throw Error('重複作品 ID');
        const year=(x.dateInfo||'').match(/年份[：:]\s*(\d{4}(?:\/\d{2})?)/)?.[1];
        if(!year) throw Error('年份缺漏');
        state.catalog.push({id,title:x.title,url:BASE.slice(0,-1)+id,year,image:x.cover});
      }
      state.pages.push({page,totalPages:data.totalPage,count:data.animeList.length,checkedAt:new Date().toISOString()});
      state.nextCatalogPage++;
    }
    await this.save();
    return this.progress();
  }
  async probe() {
    const first=this.state.catalog.slice(0,3).map(x=>Number(x.id.split('sn=')[1]));
    if(this.state.catalog.some(x=>x.id==='/animeRef.php?sn=114209')) first.push(114209);
    const records=[];
    for(const sn of [...new Set(first)]) records.push(await this.record(sn));
    return this.persist({kind:'probe',records});
  }
  async begin() {
    if(this.state.nextCatalogPage!==this.state.totalPages+1) throw Error('目錄未完成');
    const result=await this.persist({kind:'begin',catalog:this.state.catalog,pages:this.state.pages,
      region:this.state.region,checkedFrom:this.state.checkedFrom,robots:this.state.robots,delaySeconds:2.6});
    this.state.phase='verify'; this.state.offset=0; await this.save(); return result;
  }
  async step(limit=20) {
    if(this.state.phase!=='verify'||this.state.error) throw Error('此來源已停止或未準備好');
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
    if(current.nextCatalogPage!==current.totalPages+1) throw Error('複查目錄尚未完成');
    const result=await this.persist({kind:'recheck',catalog:current.catalog,pages:current.pages,
      region:current.region,robots:current.robots,delaySeconds:2.6});
    this.state.catalog=current.catalog; this.state.pages=current.pages;
    this.state.totalPages=current.totalPages; await this.save(); return result;
  }
  async finish() {
    if(this.state.offset!==this.state.catalog.length||this.state.error) throw Error('完整驗證尚未完成');
    const first=await this.catalogPage(1),last=await this.catalogPage(this.state.totalPages);
    if(first.totalPage!==last.totalPage) throw Error('目錄頁數改變');
    const result=await this.persist({kind:'finish',firstIds:first.animeList.map(x=>'/animeRef.php?sn='+x.animeSn),
      lastIds:last.animeList.map(x=>'/animeRef.php?sn='+x.animeSn),totalPages:last.totalPage});
    this.state.phase='complete'; await this.save(); return result;
  }
}
