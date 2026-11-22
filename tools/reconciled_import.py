"""Transactional protocol v2; the original protocol remains for old offline fixtures."""
import datetime as dt
import json
import re
import unicodedata
from collect import API,BASE,atomic_json,parse_metadata
from catalog_reconciliation import validate_catalog_proof,plan_catalog_delta,timestamp

def public_record(record):
    a=record['data']['anime'];v=record['data']['video']
    tags=a.get('tags')
    if not isinstance(tags,list) or len(set(tags))!=len(tags) or any(not isinstance(x,str) or not x or x.strip()!=x for x in tags):
        raise ValueError('Missing or invalid official tags')
    timestamp(record['checkedAt'])
    return {'animeSn':record['animeSn'],'checkedAt':record['checkedAt'],'data':{
      'anime':{k:a[k] for k in ['animeSn','score','reviewCount','tags','title','acgSn','maker','seasonStart']},
      'video':{k:v.get(k) for k in ['animeSn','videoSn','upTime','downTime','watchingPermission','requestParentPassword','ratingDesc']}}}

def validate_catalog(catalog):
    for x in catalog:
        if x['url']!=BASE.rstrip('/')+x['id'] or not re.fullmatch(r'/animeRef\.php\?sn=[1-9]\d*',x['id']) or not x.get('title') or not re.fullmatch(r'\d{4}(?:/\d{2})?',x.get('year','')):
            raise ValueError('Invalid canonical catalog item')

def verify_official_fields(item,record):
    a=record['data']['anime']
    normalize=lambda x:re.sub(r'\s+',' ',unicodedata.normalize('NFKC',x)).strip()
    source=normalize(a['title']);title=normalize(item['title'])
    if source!=title and not (source.startswith(title) and re.fullmatch(r'(?:\s*\[[^\]]+\])+\s*',source[len(title):])):
        raise ValueError('Official work title/edition does not match catalog')
    if type(a['acgSn']) is not int or a['acgSn']<1: raise ValueError('Missing official ACG identity')
    cover=re.search(r'/B/ACG/c/\d+/0*(\d+)\.[^.]+$',item['image'])
    if cover and int(cover[1])!=a['acgSn']: raise ValueError('Official ACG identity conflicts with catalog cover')
    if not isinstance(a['maker'],str) or a['maker'].strip()!=a['maker'] or not isinstance(a['seasonStart'],str):
        raise ValueError('Official manufacturer or premiere field missing; cannot assume empty')

def accept_reconciled(session,payload,check_robots):
    kind=payload['kind']
    if kind=='begin':
        check_robots(payload);catalog=payload['catalog'];proof=payload['catalogProof']
        validate_catalog(catalog);validate_catalog_proof(catalog,proof)
        if payload.get('region')!='TW': raise ValueError('Missing Taiwan evidence')
        state={'protocolVersion':2,'success':False,'officialTagsVerified':True,'accessContext':'member-browser',
          'region':'TW','checkedFrom':payload['checkedFrom'],'catalog':catalog,'catalogProof':proof,
          'catalogPrecheck':proof,'pages':proof['passes'][0]['pages'],'catalogSort':payload['catalogSort'],
          'processed':0,'rows':[],'excluded':0,'records':[],'verified':{},'robots':payload['robots'],'deltas':[]}
        atomic_json(session.state_path,state)
        return {'ok':True,'catalogCount':len(catalog),'pageCount':len(state['pages']),'processed':0}
    state=json.loads(session.state_path.read_text(encoding='utf-8'))
    if state.get('success') or state.get('protocolVersion')!=2: raise ValueError('Invalid or completed v2 run')
    if kind=='batch':
        if payload['offset']!=state['processed'] or not 1<=len(payload['records'])<=20: raise ValueError('Batch offset or size mismatch')
        for raw in payload['records']:
            item=state['catalog'][state['processed']];sn=item['id'].split('sn=')[1]
            r=public_record(raw)
            if str(r['animeSn'])!=sn or item['id'] in state['verified']: raise ValueError('Record/catalog identity mismatch')
            verify_official_fields(item,r)
            rating=parse_metadata(json.dumps({'data':r['data']}),sn,'member-browser')
            desc=r['data']['video'].get('ratingDesc')
            if not isinstance(desc,str) or not desc.strip(): raise ValueError('Missing official age classification')
            row=None if rating is None else {**item,**rating,'checkedAt':r['checkedAt'],'ageRating':desc,'tags':r['data']['anime']['tags']}
            state['verified'][item['id']]={'record':r,'row':row};state['processed']+=1
        state['rows']=[state['verified'][x['id']]['row'] for x in state['catalog'][:state['processed']] if state['verified'][x['id']]['row'] is not None]
        state['excluded']=state['processed']-len(state['rows'])
        atomic_json(session.state_path,state)
        return {'ok':True,'processed':state['processed'],'total':len(state['catalog']),'excluded':state['excluded']}
    if kind=='recheck':
        if state['processed']!=len(state['catalog']): raise ValueError('Complete pending verification before reconciliation')
        check_robots(payload);latest=payload['catalog'];proof=payload['catalogProof']
        validate_catalog(latest);validate_catalog_proof(latest,proof)
        old=[{**x,'availability':{'videoSn':state['verified'][x['id']]['record']['data']['video']['videoSn']}} for x in state['catalog']]
        arranged,processed,added,removed=plan_catalog_delta(old,latest,payload.get('removals',[]))
        state['verified']={key:value for key,value in state['verified'].items() if key not in removed}
        for item in arranged[:processed]:
            verified=state['verified'][item['id']]
            if verified['row'] is not None: verified['row']={**verified['row'],**item}
        state.update(catalog=arranged,processed=processed,catalogProof=proof,pages=proof['passes'][0]['pages'],
          catalogRecheckedAt=proof['confirmedAt'])
        state['rows']=[state['verified'][x['id']]['row'] for x in arranged[:processed] if state['verified'][x['id']]['row'] is not None]
        state['excluded']=processed-len(state['rows'])
        state['deltas'].append({'checkedAt':proof['confirmedAt'],'addedIds':sorted(added),'removedIds':sorted(removed),'removals':payload.get('removals',[])})
        atomic_json(session.state_path,state)
        return {'ok':True,'processed':processed,'total':len(arranged),'pending':len(added),'added':len(added),'removed':len(removed)}
    if kind=='finish':
        proof=payload['catalogProof'];validate_catalog_proof(state['catalog'],proof)
        if proof!=state['catalogProof'] or state['processed']!=len(state['catalog']) or len(state['verified'])!=len(state['catalog']) or not state['rows']:
            raise ValueError('Incomplete or unreconciled verification')
        latest=max(timestamp(x['record']['checkedAt']) for x in state['verified'].values())
        if timestamp(proof['confirmedAt'])<latest or not state['deltas']: raise ValueError('Full final catalog proof must follow all metadata verification')
        now=dt.datetime.now(dt.timezone.utc).isoformat()
        snapshot={'schemaVersion':1,'coverage':'complete-tw-watchable-catalog','region':'TW',
          'playbackAvailabilityVerified':True,'accessContext':'member-browser','officialTagsVerified':True,
          'checkedFrom':state['checkedFrom'],'updatedAt':now,'catalogRecheckedAt':proof['confirmedAt'],
          'catalogCount':len(state['catalog']),'pageCount':len(state['pages']),'catalogSort':state['catalogSort'],
          'catalogPrecheck':proof,'excludedCount':state['excluded'],'items':state['rows']}
        atomic_json(session.root/'site/data.json',snapshot)
        state.update(success=True,updatedAt=now)
        atomic_json(session.state_path,state)
        atomic_json(session.root/'evidence/member-collection.json',{'success':True,'protocolVersion':2,
          'catalogCount':len(state['catalog']),'ratedCount':len(state['rows']),'excludedCount':state['excluded'],
          'updatedAt':now,'catalogProof':proof,'deltas':state['deltas']})
        return {'ok':True,'updatedAt':now,'ratedCount':len(state['rows']),'excluded':state['excluded']}
    raise ValueError('Unsupported reconciled operation')
