import {selectItems,officialTags,minimumVotes,readFilters,filterURL,workYears,AGE_CATEGORIES,ageCategory} from './ranking.mjs';
import {verifiedItems,verifiedTags} from './snapshot.mjs';

const $=id=>document.getElementById(id);
const size=50,format=new Intl.NumberFormat('zh-TW');
let ranked=[],page=1,tagsReady=false,availableTags=[];
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
    '可複選，作品必須同時符合所有已選題材。':
    '題材資料尚未提供，可先依作品年份與年齡分級篩選。';
  $('topic-categories').hidden=!tagsReady&&filters.tags.length===0;
}
function changed(){
  page=1;
  history.replaceState(null,'',filterURL(location.href,filters));
  render();
}
function reset(){
  filters={query:'',minimum:0,tags:[],year:'',age:''};
  filterInputs();changed();
}
function renderLeader(item){
  const hero=$('leader');
  hero.replaceChildren();
  if(!item){
    hero.append(el('span','top-label','ANIME STARS'),
      el('h2','',ranked.length?'沒有符合條件的作品':'尚無已驗證的完整資料'),
      el('p','',ranked.length?'調整年份、分級、搜尋文字或最低評分人數，繼續探索。':'完整驗證通過後才會顯示排行榜。'));
    return;
  }
  hero.append(el('span','top-label',`篩選結果最高分 · 全站第 ${format.format(item.rank)} 名`));
  const h=el('h2'),p=el('p');
  h.append(link(item));
  p.append(el('strong','',item.score.toFixed(1)+' ★'),document.createTextNode(format.format(item.votes)+' 人評分'));
  hero.append(h,p);
}
function render(){
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
    if(tagsReady&&x.tags.length)info.append(el('div','work-tags',x.tags.join(' · ')));
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
$('prev').addEventListener('click',()=>{page--;render();});
$('next').addEventListener('click',()=>{page++;render();});
addEventListener('popstate',()=>{filters=readFilters(location.search);filterInputs();page=1;render();});
filterInputs();
try{
  const response=await fetch('./data.json',{cache:'no-store'});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const data=await response.json(),verified=verifiedItems(data);
  if(verified){
    ranked=verified;tagsReady=verifiedTags(data);
    availableTags=tagsReady?officialTags(ranked):[];
    filterInputs();
    const date=new Date(data.updatedAt);
    $('updated').textContent='最後成功更新：'+date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
    if(Date.now()-date.getTime()>36*3600*1000)$('notice').textContent='資料已超過 36 小時未更新，以下為上次成功取得的排名。';
  }else $('notice').textContent='資料來源尚未通過完整性及台灣觀看資格驗證，目前不提供排名。';
  $('excluded').textContent=verified?`無評分而未列入：${format.format(data.excludedCount||0)} 部。部分作品可能需登入、年齡驗證或付費資格；可觀看狀態以官方當下頁面為準。`:'尚未取得完整資料，無評分作品數尚未確認。';
}catch(error){
  ranked=[];tagsReady=false;availableTags=[];renderTags();
  $('notice').textContent='無法讀取已驗證的排行榜資料，請稍後重試。';console.error(error);
}finally{$('list').setAttribute('aria-busy','false');render();}
