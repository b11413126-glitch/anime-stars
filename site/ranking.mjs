export function rankItems(items){
  const seen=new Set();
  const valid=items.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&x.title.trim()&&typeof x.score==='number'&&Number.isFinite(x.score)&&x.score>=1&&x.score<=5&&Number.isInteger(x.votes)&&x.votes>0&&!seen.has(x.id)&&seen.add(x.id));
  // Match the official one-decimal display before comparing rating ties.
  return valid.map(x=>({...x,score:Math.round(x.score*10)/10})).sort((a,b)=>b.score-a.score||b.votes-a.votes||a.title.localeCompare(b.title,'zh-Hant')||a.id.localeCompare(b.id)).map((x,i)=>({...x,rank:i+1}));
}
export function selectItems(items,query,minimum){const q=query.trim().normalize('NFKC').toLocaleLowerCase('zh-TW');return items.filter(x=>x.votes>=minimum&&x.title.normalize('NFKC').toLocaleLowerCase('zh-TW').includes(q));}
