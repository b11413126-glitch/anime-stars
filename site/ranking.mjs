const studioID=value=>typeof value==='string'&&/^(?:[1-9]\d*|official-[a-f0-9]{16})$/.test(value);
export function rankItems(items){
  const seen=new Set();
  const valid=items.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&x.title.trim()&&typeof x.score==='number'&&Number.isFinite(x.score)&&x.score>=1&&x.score<=5&&Number.isInteger(x.votes)&&x.votes>0&&!seen.has(x.id)&&seen.add(x.id));
  // Match the official one-decimal display before comparing rating ties.
  return valid.map(x=>({...x,score:Math.round(x.score*10)/10})).sort((a,b)=>b.score-a.score||b.votes-a.votes||a.title.localeCompare(b.title,'zh-Hant')||a.id.localeCompare(b.id)).map((x,i)=>({...x,rank:i+1}));
}
export function selectItems(items,query,minimum,tags=[],{year='',age='',studios=[]}={}){
  const q=query.trim().normalize('NFKC').toLocaleLowerCase('zh-TW');
  return items.filter(x=>x.votes>=minimum&&
    x.title.normalize('NFKC').toLocaleLowerCase('zh-TW').includes(q)&&
    tags.every(tag=>Array.isArray(x.tags)&&x.tags.includes(tag))&&
    (!year||x.year?.slice(0,4)===year)&&(!age||ageCategory(x.ageRating)===age)&&
    (!studios.length||studios.some(id=>x.studioIds?.includes(id))));
}
export const AGE_CATEGORIES=[['0','全年齡'],['6','6+'],['12','12+'],['15','15+'],['18','18+']];
export function ageCategory(description){
  if(typeof description!=='string')return '';
  if(description.startsWith('一般觀眾皆可觀賞'))return '0';
  for(const age of ['6','12','15','18'])if(description.startsWith('未滿'+age+'歲'))return age;
  return '';
}
export function workYears(items){
  return [...new Set(items.map(x=>x.year?.slice(0,4)).filter(x=>/^\d{4}$/.test(x)))].sort((a,b)=>b.localeCompare(a));
}
export function officialTags(items){
  return [...new Set(items.flatMap(x=>x.tags||[]))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
}
export function minimumVotes(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(n))):0;
}
export function readFilters(search){
  const params=new URLSearchParams(search);
  return {query:params.get('q')||'',minimum:minimumVotes(params.get('min')),
    tags:[...new Set(params.getAll('tag').filter(Boolean))],
    year:/^\d{4}$/.test(params.get('year')||'')?params.get('year'):'',
    age:AGE_CATEGORIES.some(([id])=>id===params.get('age'))?params.get('age'):'',
    studios:[...new Set(params.getAll('studio').filter(studioID))]};
}
export function filterURL(rawURL,{query,minimum,tags,year='',age='',studios=[]}){
  const url=new URL(rawURL);
  for(const name of ['q','min','tag','year','age','studio'])url.searchParams.delete(name);
  if(query)url.searchParams.set('q',query);
  if(minimumVotes(minimum))url.searchParams.set('min',String(minimumVotes(minimum)));
  if(/^\d{4}$/.test(year))url.searchParams.set('year',year);
  if(AGE_CATEGORIES.some(([id])=>id===age))url.searchParams.set('age',age);
  for(const tag of [...new Set(tags)].sort((a,b)=>a.localeCompare(b,'zh-Hant')))
    url.searchParams.append('tag',tag);
  for(const id of [...new Set(studios)].filter(studioID).sort((a,b)=>a.localeCompare(b,'en',{numeric:true})))
    url.searchParams.append('studio',id);
  return url.href;
}
