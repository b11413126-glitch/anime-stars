"""Import attributed public Bangumi meta_tags without changing the rating snapshot.

Only an exact ACG cover ID + title alias + Taipei month, unique crosswalk and
matching public animation subject are accepted. No fuzzy title matching.
"""
import argparse
import collections
import datetime as dt
import hashlib
import gzip
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UA = 'b11413126-glitch/anime-stars/1.0 (https://github.com/b11413126-glitch/anime-stars)'
CROSSWALK_VERSION = '0.3.232'
CROSSWALK_SHA256 = '7e51a1066fe5f4322c2518186d01d6e1ec4eb36013700b7aebf40fc08a4fd542'
CROSSWALK_URL = f'https://unpkg.com/bangumi-data@{CROSSWALK_VERSION}/dist/data.json'


def normalized(value):
    return unicodedata.normalize('NFKC', value).lower().strip()


def taipei_month(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(
        dt.timezone(dt.timedelta(hours=8))).strftime('%Y/%m')


def cover_id(value):
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != 'https' or not re.fullmatch(r'p\d+\.bahamut\.com\.tw', parsed.netloc):
        return None
    match = re.fullmatch(r'/B/ACG/c/\d+/0*(\d+)\.(?:JPG|PNG|JPEG)', parsed.path, re.I)
    return match.group(1) if match else None


def match_items(items, crosswalk):
    if crosswalk['siteMeta']['gamer']['urlTemplate'] != 'https://acg.gamer.com.tw/acgDetail.php?s={{id}}':
        raise ValueError('Unrecognized gamer ID namespace')
    index = collections.defaultdict(list)
    for entry in crosswalk['items']:
        for site in entry['sites']:
            if site['site'] == 'gamer' and not site.get('url'):
                index[site['id']].append(entry)
    matches, reasons = {}, {}
    for item in items:
        candidates = []
        for entry in index.get(cover_id(item['image']), []):
            aliases = [entry['title']] + entry.get('titleTranslate', {}).get('zh-Hant', [])
            alias = next((v for v in aliases if normalized(v) == normalized(item['title'])), None)
            if not alias or taipei_month(entry['begin']) != item['year']:
                continue
            subjects = [s['id'] for s in entry['sites'] if s['site'] == 'bangumi' and not s.get('url')]
            if len(subjects) == 1 and re.fullmatch(r'[1-9]\d*', subjects[0]):
                candidates.append({'subjectId': int(subjects[0]), 'gamerId': cover_id(item['image']),
                                   'titleAlias': alias, 'month': item['year'], 'sourceTitle': entry['title']})
        if len(candidates) == 1:
            matches[item['id']] = candidates[0]
        else:
            reasons[item['id']] = 'ambiguous-identity' if candidates else 'identity-not-confirmed'
    return matches, reasons


def public_subject(value):
    if not isinstance(value.get('id'), int) or value.get('type') != 2:
        raise ValueError('Invalid animation identity')
    tags = value.get('meta_tags')
    if not isinstance(tags, list) or any(not isinstance(t, str) or not t.strip() for t in tags):
        raise ValueError('Missing public meta_tags; never treat missing fields as no genre')
    return {k: value.get(k) for k in ('id', 'type', 'name', 'date', 'meta_tags')}


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    temporary.replace(path)


class PublicAPI:
    def __init__(self, cache_dir):
        self.cache_dir = cache_dir
        self.next_at = 0
        self.requests = 0

    def get(self, path):
        # Conservative local policy, not a claim about an official numerical quota.
        time.sleep(max(0, self.next_at - time.monotonic()))
        self.next_at = time.monotonic() + 1.1
        self.requests += 1
        request = urllib.request.Request('https://api.bgm.tv/v0/' + path, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(gzip.decompress(raw) if response.headers.get('Content-Encoding') == 'gzip' else raw)

    def cache(self, value):
        if isinstance(value.get('id'), int) and value.get('type') in (1, 3, 4, 6):
            save_json(self.cache_dir / f"{value['id']}.json", {
                'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'identityConflict': {k: value.get(k) for k in ('id', 'type', 'name', 'date')}})
            return  # An identified non-animation stays unclassified; never borrow its tags.
        selected = public_subject(value)
        save_json(self.cache_dir / f"{selected['id']}.json", {
            'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'subject': selected})


def collect(matches, items, cache_dir):
    api = PublicAPI(cache_dir)
    wanted = {m['subjectId'] for m in matches.values()}
    def pending():
        return {sid for sid in wanted if not (cache_dir / f'{sid}.json').exists()}
    years = sorted({int(m['month'][:4]) for m in matches.values()}, reverse=True)
    if len(pending()) < 50:
        years = []
    # Public year browsing saves requests. Only exact wanted IDs are retained.
    for year in years:
        year_ids = {m['subjectId'] for m in matches.values() if m['month'].startswith(str(year))}
        if len(year_ids.intersection(pending())) <= 10:
            continue  # Exact ID reads cost less than browsing a whole sparse year.
        for offset in range(0, 10000, 50):
            if not year_ids.intersection(pending()):
                break
            batch = api.get(f'subjects?type=2&year={year}&sort=rank&limit=50&offset={offset}')
            if not isinstance(batch.get('data'), list):
                raise ValueError('Invalid public subject page')
            for value in batch['data']:
                if value.get('id') in wanted:
                    api.cache(value)
            if len(batch['data']) < 50:
                break
            if offset + 50 >= batch.get('total', 0):
                break
        print(json.dumps({'year': year, 'received': len(wanted) - len(pending()), 'wanted': len(wanted), 'requests': api.requests}), flush=True)
    for sid in sorted(pending()):
        try:
            value = api.get(f'subjects/{sid}')
        except urllib.error.HTTPError as error:
            if error.code == 404:
                # A public absence can be recorded, without attempting authentication.
                save_json(cache_dir / f'{sid}.json', {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'unavailable': 'HTTP 404'})
                continue
            raise
        if value.get('id') != sid:
            raise ValueError('Subject endpoint returned another identity')
        api.cache(value)
        if api.requests % 20 == 0:
            print(json.dumps({'received': len(wanted) - len(pending()), 'wanted': len(wanted), 'requests': api.requests}), flush=True)


def build(snapshot_bytes, crosswalk_bytes, cache_dir, mapping):
    if hashlib.sha256(crosswalk_bytes).hexdigest() != CROSSWALK_SHA256:
        raise ValueError('Crosswalk version/hash mismatch; review a new version before using it')
    snapshot = json.loads(snapshot_bytes)
    matches, reasons = match_items(snapshot['items'], json.loads(crosswalk_bytes))
    records, times = [], []
    for item in snapshot['items']:
        record = {'id': item['id'], 'status': 'unclassified', 'tags': []}
        match = matches.get(item['id'])
        if not match:
            record['reason'] = reasons[item['id']]
        else:
            path = cache_dir / f"{match['subjectId']}.json"
            if not path.exists():
                raise ValueError(f'Unprocessed candidate {match["subjectId"]}; fetch before publishing')
            cache = json.loads(path.read_text(encoding='utf-8'))
            times.append(cache['checkedAt'])
            if cache.get('unavailable'):
                record['reason'] = 'public-subject-unavailable'
            elif cache.get('identityConflict'):
                record['reason'] = 'subject-identity-conflict'
            else:
                subject = public_subject(cache['subject'])
                if subject['id'] != match['subjectId']:
                    raise ValueError('Cached identity mismatch')
                if not isinstance(subject['name'], str) or not isinstance(subject['date'], str) or normalized(subject['name']) != normalized(match['sourceTitle']) or subject['date'][:7].replace('-', '/') != match['month']:
                    record['reason'] = 'subject-identity-conflict'
                else:
                    selected = sorted({tag for tag in subject['meta_tags'] if tag in mapping})
                    record.update({'match': match, 'checkedAt': cache['checkedAt'], 'sourceTags': selected,
                                   'tags': sorted({mapping[tag] for tag in selected}),
                                   'subjectName': subject['name'], 'subjectDate': subject['date']})
                    record['status'] = 'classified' if record['tags'] else 'unclassified'
                    if not record['tags']:
                        record['reason'] = 'no-supported-public-genre'
        records.append(record)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    return {'schemaVersion': 1, 'source': 'bangumi-meta-tags', 'sourceURL': 'https://bgm.tv/',
            'license': 'CC BY-SA 3.0', 'licenseURL': 'https://creativecommons.org/licenses/by-sa/3.0/',
            'attribution': 'Bangumi 維基公共標籤；本網站篩選題材並轉為繁體中文，非動畫瘋官方分類。',
            'updatedAt': now, 'checkedFrom': min(times), 'checkedThrough': max(times),
            'rankingUpdatedAt': snapshot['updatedAt'], 'rankingSHA256': hashlib.sha256(snapshot_bytes).hexdigest(),
            'rankingCount': len(records), 'classifiedCount': sum(r['status'] == 'classified' for r in records),
            'crosswalk': {'name': 'bangumi-data', 'version': CROSSWALK_VERSION, 'url': CROSSWALK_URL,
                          'sha256': CROSSWALK_SHA256, 'license': 'CC BY 4.0',
                          'licenseURL': 'https://creativecommons.org/licenses/by/4.0/'},
            'records': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--crosswalk', type=Path, required=True)
    parser.add_argument('--cache-dir', type=Path, required=True)
    parser.add_argument('--fetch', action='store_true', help='Read only public Bangumi API; stops on refusal, no retries')
    args = parser.parse_args()
    snapshot_bytes = (ROOT / 'site/data.json').read_bytes()
    crosswalk_bytes = args.crosswalk.read_bytes()
    if hashlib.sha256(crosswalk_bytes).hexdigest() != CROSSWALK_SHA256:
        raise ValueError('Unreviewed crosswalk')
    matches, _ = match_items(json.loads(snapshot_bytes)['items'], json.loads(crosswalk_bytes))
    if args.fetch:
        failure_file = args.cache_dir / 'failure.json'
        if failure_file.exists() and json.loads(failure_file.read_text(encoding='utf-8')).get('status') != 'resolved':
            raise ValueError('Previous source failure requires diagnosis; automatic retries are disabled')
        try:
            collect(matches, json.loads(snapshot_bytes)['items'], args.cache_dir)
        except Exception as error:
            save_json(args.cache_dir / 'failure.json', {'observedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                      'reason': str(error), 'automaticRetryAllowed': False})
            raise
    mapping = json.loads((ROOT / 'site/genre-map.json').read_text(encoding='utf-8'))
    genres = build(snapshot_bytes, crosswalk_bytes, args.cache_dir, mapping)
    save_json(ROOT / 'site/genres.json', genres)
    print(json.dumps({k: genres[k] for k in ('updatedAt', 'rankingUpdatedAt', 'rankingCount', 'classifiedCount')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
