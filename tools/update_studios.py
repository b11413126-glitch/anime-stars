"""Import public animation-production credits, bound to the verified ranking.

Bangumi staff role 67 is exactly 动画制作. Funding, assistance, OP/ED and
other company roles are not animation-production credits for this filter.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import http.client
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROLE = '动画制作'
UA = 'b11413126-glitch/anime-stars/1.0 (https://github.com/b11413126-glitch/anime-stars)'


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    temporary.replace(path)


def credits(value):
    if not isinstance(value, list):
        raise ValueError('Invalid public staff response')
    selected = []
    for person in value:
        if not isinstance(person, dict):
            raise ValueError('Invalid public credit')
        if person.get('relation') != ROLE or person.get('type') != 2:
            continue
        if type(person.get('id')) is not int or person['id'] < 1 or not isinstance(person.get('name'), str) or not person['name'].strip():
            raise ValueError('Animation company identity missing')
        eps = person.get('eps', '')
        if not isinstance(eps, str):
            raise ValueError('Unexpected credited episode format')
        selected.append({'id': str(person['id']), 'name': person['name'].strip(), 'type': 2, 'relation': ROLE, 'eps': eps})
    if len({x['id'] for x in selected}) != len(selected):
        raise ValueError('Duplicate animation company credit')
    return selected


def aliases(value, company_id):
    if value.get('id') != int(company_id) or value.get('type') != 2:
        raise ValueError('Company detail identity mismatch')
    names = {value['name'].strip()}
    for entry in value.get('infobox', []):
        if entry.get('key') not in ('别名', '简体中文名', '英文名', '中文名'):
            continue
        raw = entry.get('value')
        values = [raw] if isinstance(raw, str) else [x.get('v') for x in raw] if isinstance(raw, list) else []
        names.update(x.strip() for x in values if isinstance(x, str) and x.strip())
    return {'id': str(company_id), 'name': value['name'].strip(), 'aliases': sorted(names)}


class PublicAPI:
    def __init__(self):
        self.connection = http.client.HTTPSConnection('api.bgm.tv', timeout=30)
        self.next_at = 0
        self.requests = 0

    def get(self, path):
        time.sleep(max(0, self.next_at - time.monotonic()))
        self.next_at = time.monotonic() + 1.1
        self.requests += 1
        self.connection.request('GET', '/v0/' + path, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'})
        response = self.connection.getresponse()
        raw = response.read()
        if response.status == 404:
            return None
        if response.status != 200:
            raise RuntimeError(f'Public API HTTP {response.status}; stopped, no automatic retry')
        if response.getheader('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
        return json.loads(raw)

    def close(self):
        self.connection.close()


def collect(genres, cache):
    failure = cache / 'failure.json'
    if failure.exists() and json.loads(failure.read_text(encoding='utf-8')).get('status') != 'resolved':
        raise ValueError('Previous source failure requires diagnosis, do not retry automatically')
    # Only identities that already passed name, ACG ID, date and animation-type checks.
    subjects = sorted({r['match']['subjectId'] for r in genres['records'] if r.get('match')})
    api = PublicAPI()
    try:
        for index, subject_id in enumerate(subjects, 1):
            target = cache / 'subjects' / f'{subject_id}.json'
            if not target.exists():
                value = api.get(f'subjects/{subject_id}/persons')
                save(target, {'subjectId': subject_id, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                              'credits': credits(value) if value is not None else [], 'unavailable': value is None})
            if index % 20 == 0 or index == len(subjects):
                print(json.dumps({'phase': 'credits', 'processed': index, 'total': len(subjects), 'requests': api.requests}), flush=True)
        company_ids = sorted({c['id'] for sid in subjects for c in json.loads((cache / 'subjects' / f'{sid}.json').read_text(encoding='utf-8'))['credits']}, key=int)
        for index, company_id in enumerate(company_ids, 1):
            target = cache / 'companies' / f'{company_id}.json'
            if not target.exists():
                value = api.get(f'persons/{company_id}')
                if value is None:
                    save(target, {'id': company_id, 'unavailable': True})
                else:
                    save(target, {**aliases(value, company_id), 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat()})
            if index % 20 == 0 or index == len(company_ids):
                print(json.dumps({'phase': 'aliases', 'processed': index, 'total': len(company_ids), 'requests': api.requests}), flush=True)
    except Exception as error:
        save(failure, {'status': 'stopped', 'observedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'reason': str(error), 'automaticRetryAllowed': False})
        raise
    finally:
        api.close()


def build(snapshot_bytes, genres_bytes, cache):
    failure = cache / 'failure.json'
    if failure.exists() and json.loads(failure.read_text(encoding='utf-8')).get('status') != 'resolved':
        raise ValueError('Unresolved public source failure; preserve previous studio snapshot')
    snapshot, genres = json.loads(snapshot_bytes), json.loads(genres_bytes)
    ranking_hash = hashlib.sha256(snapshot_bytes).hexdigest()
    if genres['rankingSHA256'] != ranking_hash or genres['rankingUpdatedAt'] != snapshot['updatedAt']:
        raise ValueError('Genre identity evidence does not match ranking snapshot')
    evidence = {r['id']: r for r in genres['records']}
    records, directory, times = [], {}, []
    for item in snapshot['items']:
        identity = evidence[item['id']].get('match')
        row = {'id': item['id'], 'studioIds': [], 'status': 'unclassified'}
        if not identity:
            row['reason'] = 'identity-not-confirmed'
        else:
            target = cache / 'subjects' / f"{identity['subjectId']}.json"
            if not target.exists():
                raise ValueError(f'Unprocessed public credit {identity["subjectId"]}')
            public = json.loads(target.read_text(encoding='utf-8'))
            if public['subjectId'] != identity['subjectId']:
                raise ValueError('Cached subject identity mismatch')
            # Cache IDs are strings; role filtering must not silently drop any cached credit.
            normalized = credits([{**c, 'id': int(c['id'])} for c in public['credits']])
            if normalized != public['credits']:
                raise ValueError('Cached public credit invalid')
            times.append(public['checkedAt'])
            row.update(subjectId=identity['subjectId'], checkedAt=public['checkedAt'], credits=public['credits'])
            row['studioIds'] = [c['id'] for c in public['credits']]
            row['status'] = 'classified' if row['studioIds'] else 'unclassified'
            if not row['studioIds']:
                row['reason'] = 'public-subject-unavailable' if public.get('unavailable') else 'no-animation-production-credit'
            for credit in public['credits']:
                sid = credit['id']
                if sid not in directory:
                    directory[sid] = {'id': sid, 'name': credit['name'], 'aliases': [], 'count': 0}
                    detail_path = cache / 'companies' / f'{sid}.json'
                    if detail_path.exists():
                        detail = json.loads(detail_path.read_text(encoding='utf-8'))
                        if not detail.get('unavailable'):
                            directory[sid]['name'] = detail['name']
                            directory[sid]['aliases'] = detail['aliases']
                            directory[sid]['detailsCheckedAt'] = detail['checkedAt']
                directory[sid]['aliases'] = sorted(set(directory[sid]['aliases'] + [credit['name']]))
                directory[sid]['count'] += 1
        records.append(row)
    return {'schemaVersion': 1, 'source': 'bangumi-animation-production', 'sourceURL': 'https://bgm.tv/',
            'role': ROLE, 'roleId': 67, 'license': 'CC BY-SA 3.0', 'licenseURL': 'https://creativecommons.org/licenses/by-sa/3.0/',
            'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'checkedFrom': min(times), 'checkedThrough': max(times),
            'rankingUpdatedAt': snapshot['updatedAt'], 'rankingSHA256': ranking_hash,
            'identitySHA256': hashlib.sha256(genres_bytes).hexdigest(), 'rankingCount': len(records),
            'classifiedCount': sum(r['status'] == 'classified' for r in records),
            'studios': sorted(directory.values(), key=lambda s: (-s['count'], s['name'])), 'records': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', required=True, type=Path)
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    snapshot_bytes = (ROOT / 'site/data.json').read_bytes()
    genres_bytes = (ROOT / 'site/genres.json').read_bytes()
    if args.fetch:
        collect(json.loads(genres_bytes), args.cache_dir)
    value = build(snapshot_bytes, genres_bytes, args.cache_dir)
    save(ROOT / 'site/studios.json', value)
    print(json.dumps({'classified': value['classifiedCount'], 'studios': len(value['studios']), 'rankingCount': value['rankingCount'], 'updatedAt': value['updatedAt']}), flush=True)


if __name__ == '__main__':
    main()
