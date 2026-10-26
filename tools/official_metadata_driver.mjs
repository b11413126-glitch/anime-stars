// Run in cua_repl with a documented CUA Tab. Only public, rendered work fields
// are retained; player, account, comments and personal ratings are never saved.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalize=s=>s.normalize('NFKC').replace(/\s+/gu,' ').trim();
export function sameWorkTitle(source,title){
  const a=normalize(source),b=normalize(title);
  return a===b||(a.startsWith(b)&&/^(?:\s*\[[^\]]+\])+\s*$/u.test(a.slice(b.length)));
}
export function validatePublicFields(item,raw){
  if(!sameWorkTitle(raw.heading,item.title))throw Error('影片作品名稱與原榜單不一致：'+item.title+' / '+raw.heading);
  const expected=new URL(item.image).pathname.match(/^\/B\/ACG\/c\/\d+\/0*(\d+)\.[^.]+$/)?.[1];
  if(!/^[1-9]\d*$/.test(raw.acgId||'')||(expected&&raw.acgId!==expected))
    throw Error('影片作品資料 ID 與原榜單封面不一致：'+item.title);
  const byLabel=label=>{
    const matches=raw.fields.filter(x=>x.label===label);
    if(matches.length!==1)throw Error('官方欄位缺漏或重複：'+label+' / '+item.title);
    return matches[0];
  };
  const manufacturer=byLabel('製作廠商').content;
  const tagField=byLabel('作品分類'),tags=tagField.tags;
  if(typeof manufacturer!=='string'||manufacturer!==manufacturer.trim())
    throw Error('官方製作廠商欄位無法解析：'+item.title);
  if(!Array.isArray(tags)||(!tags.length&&tagField.tagListPresent!==true)||tags.some(x=>typeof x!=='string'||!x.trim()||x!==x.trim())||new Set(tags).size!==tags.length)
    throw Error('官方分類欄位無法解析：'+item.title);
  return {id:item.id,title:item.title,videoSn:item.availability.videoSn,
    sourceURL:'https://ani.gamer.com.tw/animeVideo.php?sn='+item.availability.videoSn,
    sourceTitle:raw.heading,acgId:raw.acgId,premiereDate:byLabel('首播日期').content,
    manufacturer,tags:[...tags],...(tags.length?{}:{emptyTagsVerified:true})};
}
export class OfficialMetadataCollector{
  constructor(tab,{root,authorization}){
    if(!root||!authorization)throw Error('需本機路徑與本次人工授權紀錄');
    this.tab=tab;this.root=root;this.authorization=authorization;this.nextAt=0;
  }
  async save(){
    const file=path.join(this.root,'evidence/official-metadata-progress.json');
    await writeFile(file+'.tmp',JSON.stringify(this.state,null,2)+'\n');await rename(file+'.tmp',file);
  }
  async initialize(robots){
    if(!robots.includes('User-agent: *')||/Disallow:\s*\/(?:animeVideo\.php)?\s*$/mu.test(robots))
      throw Error('官方影片頁 robots 規則未通過');
    const bytes=await readFile(path.join(this.root,'site/data.json'));
    this.snapshot=JSON.parse(bytes);this.items=this.snapshot.items;
    await mkdir(path.join(this.root,'evidence'),{recursive:true});
    let old;try{old=JSON.parse(await readFile(path.join(this.root,'evidence/official-metadata-progress.json'),'utf8'));}
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(old?.rankingSHA256===digest(bytes)){
      if(old.error)throw Error('既有官方分類查核有錯誤，需先處理：'+old.error);
      this.state=old;
    }else this.state={schemaVersion:1,source:'gamer-rendered-work-metadata',rankingSHA256:digest(bytes),
      rankingUpdatedAt:this.snapshot.updatedAt,rankingCount:this.items.length,authorization:this.authorization,
      robots,checkedFrom:new Date().toISOString(),records:[],complete:false};
    if(this.state.records.some((x,i)=>x.id!==this.items[i].id))throw Error('已保存分類進度與榜單順序不一致');
    await this.save();return this.progress();
  }
  progress(){return {processed:this.state.records.length,total:this.items.length,unavailable:this.state.records.filter(x=>x.officialUnavailable).length,complete:this.state.complete,error:this.state.error||null};}
  async accountKnownExpiry(){
    // This accounts for the failed item; it never retries or replaces its URL.
    const bytes=await readFile(path.join(this.root,'site/data.json'));
    const saved=JSON.parse(await readFile(path.join(this.root,'evidence/official-metadata-progress.json'),'utf8'));
    const snapshot=JSON.parse(bytes),item=snapshot.items[saved.records.length],stop=saved.sourceStop;
    const match=item?.availability.downTime?.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    const expiry=match?Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`):NaN;
    if(saved.rankingSHA256!==digest(bytes)||!saved.error||!stop||stop.item.id!==item.id||
      stop.message!=='目前無此動畫或動畫授權已到期！'||stop.sourceURL!=='https://ani.gamer.com.tw/animeVideo.php?sn='+item.availability.videoSn||
      !Number.isFinite(expiry)||expiry>Date.parse(stop.observedAt))throw Error('只能處理原快照已明確排定下架且目前顯示到期訊息的作品');
    saved.records.push({id:item.id,title:item.title,videoSn:item.availability.videoSn,sourceURL:stop.sourceURL,
      sourceTitle:null,acgId:null,premiereDate:null,manufacturer:null,tags:null,checkedAt:stop.observedAt,
      officialUnavailable:{reason:'snapshot-licence-expired',scheduledDownTime:item.availability.downTime,
        observedAt:stop.observedAt,message:stop.message}});
    saved.sourceStops=[...(saved.sourceStops||[]),{...stop,handledAs:'expired-work-accounted-for-external-classification'}];
    saved.resolvedParserErrors=[...(saved.resolvedParserErrors||[]),{error:saved.error,stoppedAt:saved.stoppedAt,
      resolution:'原快照已記錄下架日，保留該筆失敗與下架狀態；該URL永久停止本輪請求，分類必須另有完整公共證據。不是官方空白分類，也不是新可觀看排名。'}];
    delete saved.error;delete saved.stoppedAt;
    this.snapshot=snapshot;this.items=snapshot.items;this.state=saved;await this.save();return this.progress();
  }
  async record(item){
    const sourceURL='https://ani.gamer.com.tw/animeVideo.php?sn='+item.availability.videoSn;
    if(this.state?.sourceStops?.some(x=>x.sourceURL===sourceURL&&x.automaticRetryAllowed===false))
      throw Error('已停止的下架影片不得重新請求');
    const wait=this.nextAt-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
    this.nextAt=Date.now()+2600;
    // An ad/player can prevent navigation's load event even though work metadata
    // is rendered. After that timeout, inspect the same URL; never retry it.
    try{if(await this.tab.url()!==sourceURL)await this.tab.goto(sourceURL);}catch(error){
      if(!/Timed out waiting for tab .* to navigate/.test(String(error))||await this.tab.url()!==sourceURL)throw error;
    }
    await this.tab.getAXState({emit:false});
    const headings=await this.tab.playwright.getByRole('heading',{level:1}).allTextContents({});
    if(!headings.length)throw Error('官方影片頁未顯示作品標題，可能需要正常登入或來源拒絕');
    const fields=await this.tab.playwright.locator('li.type').evaluateAll(nodes=>nodes.map(n=>({
      label:n.querySelector('.title')?.textContent?.trim(),content:n.querySelector('.content')?.textContent?.trim(),tagListPresent:!!n.querySelector('.tag-list'),
      tags:[...n.querySelectorAll('.tag-list .tag')].map(t=>t.textContent.trim())})));
    const href=await this.tab.playwright.getByRole('link',{name:'作品資料 keyboard_arrow_down',exact:true}).getAttribute('href');
    const acgId=href?.match(/[?&]s=(\d+)/)?.[1];
    const record=validatePublicFields(item,{heading:headings[0],fields,acgId});
    record.checkedAt=new Date().toISOString();return record;
  }
  async step(limit=20){
    if(!Number.isInteger(limit)||limit<1||limit>20||this.state.error)throw Error('每批最多20部，來源錯誤後不得自動接續');
    try{
      for(let n=0;n<limit&&this.state.records.length<this.items.length;n++){
        const item=this.items[this.state.records.length];
        this.state.records.push(await this.record(item));await this.save();
      }
      return this.progress();
    }catch(e){this.state.error=String(e);this.state.stoppedAt=new Date().toISOString();await this.save();throw e;}
  }
  async finish(){
    if(this.state.error||this.state.records.length!==this.items.length)throw Error('逐部官方分類尚未完整');
    const bytes=await readFile(path.join(this.root,'site/data.json'));
    if(digest(bytes)!==this.state.rankingSHA256)throw Error('查核期間評分快照變更');
    this.state.complete=true;this.state.checkedThrough=new Date().toISOString();await this.save();return this.progress();
  }
}
