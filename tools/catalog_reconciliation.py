"""Independently validate public pagination receipts and incremental membership."""
import datetime as dt
import hashlib
import re

def timestamp(value):
    if not isinstance(value,str): raise ValueError('Invalid evidence time')
    return dt.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()

def valid_ids(values):
    if not isinstance(values,list) or not values or len(set(values))!=len(values) or any(
        not isinstance(x,str) or not re.fullmatch(r'/animeRef\.php\?sn=[1-9]\d*',x) for x in values):
        raise ValueError('Duplicate or invalid ID within one page')
    return values

def frame(value):
    first,last=value['first'],value['last']
    total=first['totalPages']
    if type(total) is not int or total<1 or first['page']!=1 or last['page']!=total or last['totalPages']!=total:
        raise ValueError('Invalid first/last pagination')
    size=len(valid_ids(first['ids']));tail=len(valid_ids(last['ids']))
    if tail>size: raise ValueError('Last page larger than page size')
    return total,size,tail,(total-1)*size+tail

def analyze_pass(value):
    if value['sort'] not in (1,2) or not isinstance(value['runId'],str) or not value['runId']:
        raise ValueError('Invalid catalog pass')
    start,end=timestamp(value['checkedFrom']),timestamp(value['completedAt'])
    if start>end: raise ValueError('Invalid catalog time window')
    shape=frame(value['anchors']['start'])
    if shape!=frame(value['anchors']['end']): raise ValueError('Catalog count changed during pass')
    total,size,tail,expected=shape
    if len(value['pages'])!=total: raise ValueError('Incomplete catalog pages')
    seen=set();overlaps=0
    for i,p in enumerate(value['pages']):
        count=tail if i==total-1 else size
        if p['page']!=i+1 or p['totalPages']!=total or p['count']!=count or len(p['ids'])!=count or not start<=timestamp(p['checkedAt'])<=end:
            raise ValueError('Catalog page count/order/time mismatch')
        valid_ids(p['ids'])
        for identity in p['ids']:
            overlaps+=identity in seen
            seen.add(identity)
    return expected,seen,overlaps

def validate_catalog_proof(catalog,proof):
    if proof.get('version')!=2 or proof.get('source')!='gamer-page-count-reconciliation' or len(proof.get('passes',[]))<2:
        raise ValueError('Two independent complete catalog passes required')
    passes=proof['passes']
    if len({p['runId'] for p in passes})!=len(passes): raise ValueError('Repeated catalog pass')
    confirmed=timestamp(proof['confirmedAt']);union=set();expected=None;overlaps=0
    for i,p in enumerate(passes):
        count,identities,duplicate_count=analyze_pass(p)
        if expected is not None and expected!=count: raise ValueError('Cross-sort catalog counts disagree')
        if timestamp(p['completedAt'])>confirmed or (i and timestamp(p['checkedFrom'])<timestamp(passes[i-1]['completedAt'])):
            raise ValueError('Passes were not independent sequential observations')
        expected=count;union.update(identities);overlaps+=duplicate_count
    if overlaps and len({p['sort'] for p in passes})<2: raise ValueError('Overlap requires independent official sort')
    if len(union)!=expected: raise ValueError(f'Catalog union {len(union)} != expected {expected}')
    for p in passes:
        for f in p['anchors'].values():
            if not set(f['first']['ids']+f['last']['ids'])<=union: raise ValueError('Anchor ID missing from full union')
    actual=[x['id'] for x in catalog]
    digest=hashlib.sha256('\n'.join(sorted(actual)).encode()).hexdigest()
    if len(actual)!=len(set(actual)) or set(actual)!=union or proof['expectedTotal']!=expected or proof['catalogCount']!=expected or proof['overlapCount']!=overlaps or proof['idSHA256']!=digest:
        raise ValueError('Catalog identity/count/digest mismatch')
    return union

def plan_catalog_delta(previous,latest,removals,limit=20):
    old={x['id']:x for x in previous};fresh={x['id']:x for x in latest}
    if len(old)!=len(previous) or len(fresh)!=len(latest): raise ValueError('Duplicate incremental catalog ID')
    added=fresh.keys()-old.keys();removed=old.keys()-fresh.keys()
    if len(added)+len(removed)>limit: raise ValueError('Incremental catalog change exceeds limit')
    receipts={x['id']:x for x in removals}
    if set(receipts)!=removed or len(receipts)!=len(removals): raise ValueError('Missing confirmed removal evidence')
    for identity in removed:
        r=receipts[identity];sn=old[identity].get('availability',{}).get('videoSn')
        if type(sn) is not int or sn<1 or r['reason']!='confirmed-source-expiry' or r['message']!='目前無此動畫或動畫授權已到期！' or r['sourceURL']!='https://ani.gamer.com.tw/animeVideo.php?sn='+str(sn):
            raise ValueError('Removal is not an observed expiry of the fixed work video')
        timestamp(r['checkedAt'])
    arranged=[x for x in latest if x['id'] in old]+[x for x in latest if x['id'] in added]
    return arranged,len(arranged)-len(added),added,removed
