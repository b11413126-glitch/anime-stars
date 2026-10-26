import {selectItems,officialTags,minimumVotes,readFilters,filterURL,workYears,AGE_CATEGORIES,ageCategory} from './ranking.mjs';
import {verifiedItems,verifiedTags} from './snapshot.mjs';
import {verifiedGenres,applyGenres} from './genres.mjs';
import {verifiedStudios,applyStudios,studioOptions} from './studios.mjs';
import {verifiedOfficialMetadata,applyOfficialMetadata} from './official-metadata.mjs';

const $=id=>document.getElementById(id);
const size=50,format=new Intl.NumberFormat('zh-TW');
let ranked=[],page=1,tagsReady=false,availableTags=[];
let genreInfo=null;
let officialMetadataInfo=null;
let studiosReady=false,studioDirectory=[];
let filters=readFilters(location.search);

function el(tag,cls,text){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined)n.textContent=text;
  return n;
}
function safeURL(raw,image=false){
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:')return null;
    if(image)return /(^|\.)(gamer|bahamut)\.com\.tw$/.test(u.hostname)?u.href:null;
    return u.hostname==='ani.gamer.com.tw'?u.href:null;
  }catch{return null;}
}
function link(item){
  const a=el('a','title',item.title),u=safeURL(item.url);
  if(u){a.href=u;a.target='_blank';a.rel='noopener noreferrer';}
  return a;
}
function filterInputs(){
  $('search').value=filters.query;
  $('minimum').value=String(filters.minimum);
  const years=workYears(ranked);
  $('year').replaceChildren(new Option('全部年份',''),...years.map(year=>new Option(year+' 年',year)));
  if(filters.year&&!years.includes(filters.year))$('year').append(new Option(filters.year+' 年（目前無作品）',filters.year));
  $('year').value=filters.year;
  $('age').replaceChildren(new Option('全部分級',''),...AGE_CATEGORIES.map(([id,label])=>new Option(label,id)));
  $('age').value=filters.age;
  renderTags();
  renderStudios();
}
function renderStudios(){
  $('studio-selected').replaceChildren();$('studio-options').replaceChildren();
  const known=new Set(studioDirectory.map(x=>x.id));
  const options=[...filters.studios.filter(id=>!known.has(id)).map(id=>({id,name:'未找到的公司（'+id+'）',count:0})),
    ...studioOptions(studioDirectory,filters.studios,$('studio-search').value)];
  for(const company of options){
    const label=el('label','studio-option'),input=el('input');
    input.type='checkbox';input.value=company.id;input.checked=filters.studios.includes(company.id);
    label.append(input,el('span','',company.name),el('small','',format.format(company.count)+' 部'));
    input.addEventListener('change',()=>{
      filters.studios=input.checked?[...filters.studios,company.id]:filters.studios.filter(id=>id!==company.id);
      renderStudios();changed();
      document.querySelector('.studio-option input[value="'+company.id+'"]')?.focus();
    });
    $(input.checked?'studio-selected':'studio-options').append(label);
  }
  if(!$('studio-options').childElementCount)$('studio-options').append(el('p','studio-empty',studiosReady?'沒有其他符合的公司':'公司資料尚未提供'));
  $('studio-status').textContent='可複選，符合任一已選公司即可；題材與其他篩選條件仍須同時符合。'+(officialMetadataInfo?'動畫作品依官方「製作廠商」與逐部補證整理，共同製作全部保留；真人與現場作品不納入動畫公司篩選。':'僅列實際動畫製作職務，共同製作公司全部保留。');
  $('studio-search').disabled=!studiosReady;
}
function filterSummary(){
  const names=new Map(studioDirectory.map(x=>[x.id,x.name]));
  const parts=[];
  if(filters.tags.length)parts.push('題材：'+filters.tags.join(' ＋ '));
  if(filters.studios.length)parts.push('公司：'+filters.studios.map(id=>names.get(id)||id).join(' ／ '));
  const text=parts.join('；')||'全部題材與公司';
  $('filter-summary').textContent=text;$('filter-summary').title=text;
}
function renderTags(){
  const selected=new Set(filters.tags);
  const options=[...availableTags,...filters.tags.filter(tag=>!availableTags.includes(tag))];
  $('tags').replaceChildren();
  for(const tag of options){
    const label=el('label','tag-option'),input=el('input');
    input.type='checkbox';input.value=tag;input.checked=selected.has(tag);
    const known=availableTags.includes(tag);
    label.append(input,el('span','',tag+(known?'':'（目前無作品）')));
    input.addEventListener('change',()=>{
      filters.tags=input.checked?[...filters.tags,tag]:filters.tags.filter(x=>x!==tag);
      changed();
    });
    $('tags').append(label);
  }
  $('tags-status').textContent=tagsReady?
    '可複選，作品必須同時符合所有已選題材；搜尋、年份、分級與人數條件也會同時套用。':
    '題材資料尚未提供，可先依作品年份與年齡分級篩選。';
  $('topic-categories').hidden=!tagsReady&&filters.tags.length===0;
}
function changed(){
  page=1;
  history.replaceState(null,'',filterURL(location.href,filters));
  render();
}
function reset(){
  filters={query:'',minimum:0,tags:[],year:'',age:'',studios:[]};
  $('studio-search').value='';
  filterInputs();changed();
}
function renderLeader(item){
  const hero=$('leader');
  hero.replaceChildren();
  if(!item){
    hero.append(el('span','top-label','ANIME STARS'),
      el('h2','',ranked.length?'沒有符合條件的作品':'尚無已驗證的完整資料'),
      el('p','',ranked.length?'調整題材、公司、年份、分級、搜尋文字或最低評分人數，繼續探索。':'完整驗證通過後才會顯示排行榜。'));
    return;
  }
  hero.append(el('span','top-label',`篩選結果最高分 · 全站第 ${format.format(item.rank)} 名`));
  const h=el('h2'),p=el('p');
  h.append(link(item));
  p.append(el('strong','',item.score.toFixed(1)+' ★'),document.createTextNode(format.format(item.votes)+' 人評分'));
  hero.append(h,p);
}
function render(){
  filterSummary();
  const items=selectItems(ranked,filters.query,filters.minimum,filters.tags,filters);
  const pages=Math.max(1,Math.ceil(items.length/size));
  page=Math.min(page,pages);
  renderLeader(items[0]);
  $('list').replaceChildren();
  for(const x of items.slice((page-1)*size,page*size)){
    const row=el('article','row'),identity=el('div','identity');
    identity.append(el('span',x.rank<=3?'rank top-rank':'rank',String(x.rank).padStart(2,'0')));
    const image=safeURL(x.image,true);
    if(image){
      const img=el('img','cover');img.src=image;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
      img.addEventListener('error',()=>img.replaceWith(el('div','cover')),{once:true});identity.append(img);
    }else identity.append(el('div','cover'));
    const info=el('div');
    const ageLabel=AGE_CATEGORIES.find(([id])=>id===ageCategory(x.ageRating))?.[1];
    info.append(link(x),el('div','year',(x.year||'年份未提供')+(ageLabel?' · '+ageLabel:'')));
    if(x.officialMetadata?.officialUnavailable)info.append(el('div','work-tags','原快照標示 '+x.officialMetadata.officialUnavailable.scheduledDownTime+' 下架；保留歷史排名，分類採公共補證。'));
    if(tagsReady){
      const tags=el('div','work-tags',x.tags.length?x.tags.join(' · '):(x.officialMetadata?'官方未標示分類':'題材尚未分類'));
      if(x.officialMetadata){
        const fallback=x.officialMetadata.genreSupplement;
        const source=el('a','genre-source',fallback?'分類補證 ↗':'官方分類 ↗');
        source.href=fallback?'https://bgm.tv/subject/'+fallback.subjectId:x.officialMetadata.sourceURL;source.target='_blank';source.rel='noopener noreferrer';
        tags.append(document.createTextNode(' · '),source);
      }else if(genreInfo&&x.genre?.match){
        const source=el('a','genre-source','分類來源 ↗');
        source.href='https://bgm.tv/subject/'+x.genre.match.subjectId;source.target='_blank';source.rel='noopener noreferrer';
        tags.append(document.createTextNode(' · '),source);
      }
      info.append(tags);
    }
    if(studiosReady){
      const names=new Map(studioDirectory.map(s=>[s.id,s.name]));
      const supplement=x.officialMetadata?.studioSupplement;
      const nonAnimation=x.officialMetadata?.animationStudioApplicability==='not-applicable';
      const companies=el('div','work-studios',nonAnimation?'非動畫作品 · '+(x.officialMetadata.manufacturer?'官方製作廠商：'+x.officialMetadata.manufacturer:'動畫製作公司不適用'):x.studioIds.length?(supplement?'動畫製作（補查）：':x.officialMetadata?'製作廠商：':'動畫製作：')+x.studioIds.map(id=>names.get(id)).join('、'):(x.officialMetadata?'官方未標示製作廠商':'製作公司尚未確認'));
      if(x.studioIds.length||nonAnimation){
        const source=el('a','genre-source',supplement?'補查來源 ↗':x.officialMetadata?'官方製作資料 ↗':'製作職務 ↗');
        source.href=supplement?(['first-party-animation-production','contemporaneous-production-report'].includes(supplement.source)||supplement.credits[0].sourceField==='person-work-list'?supplement.credits[0].sourceURL:'https://bgm.tv/subject/'+supplement.subjectId):x.officialMetadata?.sourceURL||'https://bgm.tv/subject/'+x.studio.subjectId;source.target='_blank';source.rel='noopener noreferrer';
        if(supplement)source.title='職務查核時間：'+new Date(supplement.checkedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
        if(supplement?.source==='contemporaneous-production-report')source.title+='；同期原始報導 '+supplement.reportPublishedAt+'，'+supplement.reportAuthor;
        companies.append(document.createTextNode(' · '),source);
      }
      info.append(companies);
    }
    identity.append(info);
    const score=el('div','score',x.score.toFixed(1));score.append(el('small','','★'));
    row.append(identity,score,el('div','votes',format.format(x.votes)));$('list').append(row);
  }
  if(!items.length){
    const empty=el('div','empty');
    empty.append(el('p','',ranked.length?'沒有符合條件的作品':'尚無已驗證的完整資料。'));
    if(ranked.length){const clear=el('button','','清除全部篩選');clear.type='button';clear.addEventListener('click',reset);empty.append(clear);}
    $('list').append(empty);
  }
  $('count').textContent=`共 ${format.format(ranked.length)} 部 · 符合條件 ${format.format(items.length)} 部`;
  $('selected').textContent=filters.tags.length?'已選題材：'+filters.tags.join(' ＋ '):'全部題材';
  $('page').textContent=`第 ${page} / ${pages} 頁`;
  $('prev').disabled=page<=1;$('next').disabled=page>=pages;
}
for(const id of ['search','minimum'])$(id).addEventListener('input',()=>{
  filters.query=$('search').value;filters.minimum=minimumVotes($('minimum').value);changed();
});
$('minimum').addEventListener('change',()=>{$('minimum').value=String(filters.minimum);});
for(const id of ['year','age'])$(id).addEventListener('change',()=>{filters[id]=$(id).value;changed();});
$('reset').addEventListener('click',reset);
$('studio-search').addEventListener('input',renderStudios);
$('prev').addEventListener('click',()=>{page--;render();});
$('next').addEventListener('click',()=>{page++;render();});
addEventListener('popstate',()=>{filters=readFilters(location.search);filterInputs();page=1;render();});
filterInputs();
try{
  const response=await fetch('./data.json',{cache:'no-store'});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const snapshotText=await response.text(),data=JSON.parse(snapshotText),verified=verifiedItems(data);
  if(verified){
    ranked=verified;tagsReady=verifiedTags(data);
    const sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const hash=await sha(snapshotText);
    try{
      const response=await fetch('./official-metadata.json',{cache:'no-store'});
      if(!response.ok)throw Error('官方分類檔案未提供');
      const metadata=await response.json(),mappingResponse=await fetch('./genre-map.json',{cache:'no-store'});
      if(!mappingResponse.ok)throw Error('補證題材對映讀取失敗');
      const records=verifiedOfficialMetadata(data,metadata,hash,await mappingResponse.json());
      ranked=applyOfficialMetadata(ranked,records);officialMetadataInfo=metadata;
      $('studio-categories').querySelector('legend').textContent='動畫製作公司';
      studioDirectory=metadata.studios;tagsReady=true;studiosReady=true;
      const source=el('a','','巴哈姆特動畫瘋影片頁');source.href='https://ani.gamer.com.tw/';source.target='_blank';source.rel='noopener noreferrer';
      const time=new Date(metadata.checkedThrough).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
      $('genre-attribution').replaceChildren(document.createTextNode(`作品分類：官方 ${format.format(metadata.officialGenreCount)} 部、公共補證 ${format.format(metadata.supplementedGenreCount)} 部，合計 ${format.format(metadata.classifiedCount)} / ${format.format(ranked.length)} 部；來源：`),source,
        document.createTextNode('，每部作品均附來源連結。'),el('br'),document.createTextNode('分類查核完成時間：'+time+'；評分時間保持原始快照。'));
      if(metadata.supplementedGenreCount){
        const license=el('a','','Bangumi 公共標籤（CC BY-SA 3.0）');license.href='https://bgm.tv/about/copyright';license.target='_blank';license.rel='noopener noreferrer';
        $('genre-attribution').append(el('br'),document.createTextNode('原快照已下架而無法讀取官方頁面的作品：'),license,document.createTextNode('；經固定版本ACG與完整片名對照、只採支援題材並轉繁體。原始查詢時間保留於分類檔。'));
      }
      const studioSource=el('a','','動畫瘋「製作廠商」欄位');studioSource.href='https://ani.gamer.com.tw/';studioSource.target='_blank';studioSource.rel='noopener noreferrer';
      $('studio-attribution').replaceChildren(document.createTextNode(`動畫製作：官方 ${format.format(metadata.officialStudioCount)} 部、外部補證 ${format.format(metadata.supplementedStudioCount)} 部，共 ${format.format(studioDirectory.length)} 家；另 ${format.format(metadata.notApplicableCount)} 部非動畫不適用、${format.format(metadata.unconfirmedStudioCount)} 部仍待補證。來源：`),studioSource,
        document.createTextNode('，不採用「代理廠商」欄位。官方空白且尚無補證者會明示，未選廠商仍保留完整榜單。'),el('br'),document.createTextNode('官方欄位查核完成時間：'+time+'；外部補證保留原始查詢時間，評分時間保持原始快照。'));
      if(metadata.supplementedStudioCount||metadata.companyAliasesSource){
        const license=el('a','','Bangumi 公共動畫製作職務（CC BY-SA 3.0）');license.href='https://bgm.tv/about/copyright';license.target='_blank';license.rel='noopener noreferrer';
        $('studio-attribution').append(el('br'),document.createTextNode('公司別名與部分職務補證：'),license,document.createTextNode('；其他補證依本作官方STAFF、第一方製作證據或明示的同期原始報導，逐部提供來源連結，不標成動畫瘋原欄位。'));
      }
      $('studio-attribution').append(el('br'),document.createTextNode('分類檔整理時間：'+new Date(metadata.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})));
    }catch(error){$('classification-notice').textContent='官方分類暫時無法通過核對，先顯示既有分類；排名資料仍可使用。';console.warn('官方分類未啟用，讀取既有分類：',error);}
    if(!officialMetadataInfo){
    let genreRecords=null,genreHash=null;
    {
      try{
        const [genresResponse,mappingResponse]=await Promise.all([
          fetch('./genres.json',{cache:'no-store'}),fetch('./genre-map.json',{cache:'no-store'})]);
        if(!genresResponse.ok||!mappingResponse.ok)throw Error('分類檔案讀取失敗');
        const [genreText,mapping]=await Promise.all([genresResponse.text(),mappingResponse.json()]);
        const genres=JSON.parse(genreText);
        const records=verifiedGenres(data,genres,mapping,hash);
        genreRecords=records;genreHash=await sha(genreText);
        // This sidecar also supplies the verified identities used by studio credits.
        ranked=applyGenres(ranked,records);genreInfo=genres;tagsReady=true;
        const source=el('a','','Bangumi 維基公共標籤');source.href='https://bgm.tv/';source.target='_blank';source.rel='noopener noreferrer';
        const crosswalk=el('a','','bangumi-data');crosswalk.href='https://github.com/bangumi-data/bangumi-data';crosswalk.target='_blank';crosswalk.rel='noopener noreferrer';
        const license=el('a','','CC BY-SA 3.0');license.href=genres.licenseURL;license.target='_blank';license.rel='noopener noreferrer';
        $('genre-attribution').replaceChildren(
          document.createTextNode(`已分類 ${format.format(genres.classifiedCount)} / ${format.format(ranked.length)} 部；其餘 ${format.format(ranked.length-genres.classifiedCount)} 部尚未分類，未選題材時仍會顯示。`),el('br'),
          document.createTextNode('題材來源：'),source,document.createTextNode('（'),license,document.createTextNode('；篩選並轉為繁體中文），作品對照：'),crosswalk,
          document.createTextNode('（CC BY 4.0）。非動畫瘋官方分類。'),el('br'),
          document.createTextNode('分類整理時間：'+new Date(genres.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})+'；評分資料時間如下。'));
      }catch(error){
        $('classification-notice').textContent='題材資料暫時無法通過核對，仍可使用完整排行榜、年份與分級篩選。';
        console.warn('題材資料未啟用：',error);
      }
    }
    try{
      if(!genreRecords)throw Error('缺少已核對作品對照');
      const response=await fetch('./studios.json',{cache:'no-store'});
      if(!response.ok)throw Error('公司分類檔案讀取失敗');
      const studios=await response.json();
      const records=verifiedStudios(data,studios,genreRecords,hash,genreHash);
      ranked=applyStudios(ranked,records);studioDirectory=studios.studios;studiosReady=true;
      const source=el('a','','Bangumi 公共製作職務');source.href='https://bgm.tv/';source.target='_blank';source.rel='noopener noreferrer';
      const license=el('a','','CC BY-SA 3.0');license.href=studios.licenseURL;license.target='_blank';license.rel='noopener noreferrer';
      $('studio-attribution').replaceChildren(
        document.createTextNode(`已確認 ${format.format(studios.classifiedCount)} / ${format.format(ranked.length)} 部、${format.format(studioDirectory.length)} 家公司；其餘 ${format.format(ranked.length-studios.classifiedCount)} 部製作公司尚未確認，未選公司時仍會顯示。`),el('br'),
        document.createTextNode('來源：'),source,document.createTextNode('（'),license,document.createTextNode('；依「動畫製作」職務整理）。非動畫瘋官方分類；公司作品數指本榜已核對作品數。'),el('br'),
        document.createTextNode('公司資料整理時間：'+new Date(studios.updatedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})+'；評分時間保持原始快照。'));
    }catch(error){
      $('studio-notice').textContent='製作公司資料暫時無法通過核對，完整排行榜與其他已驗證篩選仍可使用。';
      console.warn('公司資料未啟用：',error);
    }
    }
    availableTags=tagsReady?officialTags(ranked):[];
    filterInputs();
    const date=new Date(data.updatedAt);
    $('updated').textContent='最後成功更新：'+date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
    $('notice').textContent=[Date.now()-date.getTime()>35*24*3600*1000?'資料已超過 35 天未更新，以下為上次成功取得的排名。':'',
      officialMetadataInfo?.unavailableCount?`原快照有 ${format.format(officialMetadataInfo.unavailableCount)} 部作品已到排定下架日，現仍保留歷史排名並逐部標示；分類採獨立公共補證，沒有重試已下架影片。`:''].filter(Boolean).join(' ');
  }else $('notice').textContent='資料來源尚未通過完整性及台灣觀看資格驗證，目前不提供排名。';
  $('excluded').textContent=verified?`無評分而未列入：${format.format(data.excludedCount||0)} 部。部分作品可能需登入、年齡驗證或付費資格；可觀看狀態以官方當下頁面為準。`:'尚未取得完整資料，無評分作品數尚未確認。';
}catch(error){
  ranked=[];tagsReady=false;availableTags=[];studiosReady=false;studioDirectory=[];renderTags();renderStudios();
  $('notice').textContent='無法讀取已驗證的排行榜資料，請稍後重試。';console.error(error);
}finally{$('list').setAttribute('aria-busy','false');render();}
