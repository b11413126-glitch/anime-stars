"""Import sanitized public data read through the user's normal signed-in browser.

This server never opens the source site, reads cookies, or accepts credentials.
Only a complete validated run can replace site/data.json.
"""
import argparse
import datetime as dt
import html
import json
import sys
import urllib.parse
import urllib.robotparser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from collect import ROOT, BASE, API, AGENT, atomic_json, parse_metadata


class ImportSession:
    def __init__(self, root=ROOT):
        self.root = Path(root)
        self.state_path = self.root / 'evidence/browser-current.json'

    def accept(self, payload):
        kind = payload['kind']
        if kind == 'probe':
            rows = []
            for record in payload['records']:
                rating = parse_metadata(json.dumps({'data': record['data']}), str(record['animeSn']), 'member-browser')
                rows.append({'animeSn': record['animeSn'], 'rating': rating, 'checkedAt': record['checkedAt']})
            if len(rows) < 3:
                raise ValueError('At least three distinct probe works required')
            if len(set(x['animeSn'] for x in rows)) != len(rows):
                raise ValueError('Duplicate probe work')
            report = {'success': True, 'accessContext': 'member-browser', 'samples': rows,
                      'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat()}
            name = 'member-probe-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S') + '.json'
            atomic_json(self.root / 'evidence' / name, report)
            return {'ok': True, 'probeWorks': len(rows), 'evidence': name}
        if kind in ('begin', 'recheck'):
            catalog, pages = payload['catalog'], payload['pages']
            if payload.get('region') != 'TW' or not catalog or not pages:
                raise ValueError('Missing Taiwan catalog evidence')
            if [x['page'] for x in pages] != list(range(1, len(pages) + 1)):
                raise ValueError('Incomplete page sequence')
            if any(x['totalPages'] != len(pages) or x['count'] <= 0 for x in pages):
                raise ValueError('Inconsistent pagination')
            ids = [x['id'] for x in catalog]
            if len(set(ids)) != len(ids) or sum(x['count'] for x in pages) != len(ids):
                raise ValueError('Duplicate or missing catalog work')
            for item in catalog:
                if item['url'] != BASE.rstrip('/') + item['id'] or not item['id'].startswith('/animeRef.php?sn='):
                    raise ValueError('Noncanonical work identity')
            for origin in (BASE, API):
                robot = urllib.robotparser.RobotFileParser()
                robot.parse(payload['robots'][origin].splitlines())
                target = origin + ('animeList.php' if origin == BASE else 'anime/v1/video.php')
                if not robot.can_fetch(AGENT, target):
                    raise RuntimeError('robots.txt forbids this source')
                if (robot.crawl_delay(AGENT) or 0) > payload.get('delaySeconds', 0):
                    raise ValueError('Crawl delay is insufficient')
            if payload.get('delaySeconds', 0) < 2.5:
                raise ValueError('Minimum request interval is 2.5 seconds')
            if kind == 'recheck':
                state = json.loads(self.state_path.read_text(encoding='utf-8'))
                if state.get('success') or state['processed'] != len(state['catalog']):
                    raise ValueError('Only a fully checked unfinished run can be reconciled')
                if set(ids) != {x['id'] for x in state['catalog']}:
                    raise ValueError('Catalog membership changed; additional source verification required')
                if len(state['rows']) + state['excluded'] != len(catalog):
                    raise ValueError('Verified work counts do not match catalog')
                latest = {x['id']: x for x in catalog}
                state.update(catalog=catalog, pages=pages,
                             rows=[{**row, **latest[row['id']]} for row in state['rows']],
                             catalogRecheckedAt=dt.datetime.now(dt.timezone.utc).isoformat())
                atomic_json(self.state_path, state)
                return {'ok': True, 'catalogCount': len(catalog), 'pageCount': len(pages),
                        'processed': state['processed'], 'membershipUnchanged': True}
            state = {'success': False, 'checkedFrom': payload['checkedFrom'], 'region': 'TW',
                     'catalog': catalog, 'pages': pages, 'rows': [], 'processed': 0, 'excluded': 0,
                     'accessContext': 'member-browser', 'records': [], 'robots': payload['robots']}
            atomic_json(self.state_path, state)
            return {'ok': True, 'catalogCount': len(catalog), 'pageCount': len(pages), 'processed': 0}
        state = json.loads(self.state_path.read_text(encoding='utf-8'))
        if state.get('success'):
            raise ValueError('Run already finalized; start a new run')
        if kind == 'batch':
            if payload['offset'] != state['processed']:
                raise ValueError('Batch offset mismatch')
            for record in payload['records']:
                item = state['catalog'][state['processed']]
                sn = urllib.parse.parse_qs(urllib.parse.urlparse(item['url']).query)['sn'][0]
                if str(record['animeSn']) != sn:
                    raise ValueError('Browser record/catalog identity mismatch')
                # Only selected public fields reach this importer; no auth/session data.
                rating = parse_metadata(json.dumps({'data': record['data']}), sn, 'member-browser')
                if rating is None:
                    state['excluded'] += 1
                else:
                    public = record['data']['video']
                    state['rows'].append({**item, **rating, 'checkedAt': record['checkedAt'],
                                          'ageRating': public.get('ratingDesc', '')})
                state['processed'] += 1
                state['records'].append({'animeSn': int(sn), 'checkedAt': record['checkedAt'],
                                         'source': API + 'anime/v1/video.php?animeSn=' + sn})
            atomic_json(self.state_path, state)
            return {'ok': True, 'processed': state['processed'], 'total': len(state['catalog']), 'excluded': state['excluded']}
        if kind == 'finish':
            if state['processed'] != len(state['catalog']) or not state['rows']:
                raise ValueError('Incomplete collection; previous snapshot preserved')
            first_count, last_count = state['pages'][0]['count'], state['pages'][-1]['count']
            if payload['firstIds'] != [x['id'] for x in state['catalog'][:first_count]]:
                raise ValueError('First catalog page changed during collection')
            if payload['lastIds'] != [x['id'] for x in state['catalog'][-last_count:]]:
                raise ValueError('Last catalog page changed during collection')
            if payload['totalPages'] != len(state['pages']):
                raise ValueError('Catalog page count changed')
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            snapshot = {'schemaVersion': 1, 'coverage': 'complete-tw-watchable-catalog',
                        'region': 'TW', 'playbackAvailabilityVerified': True, 'accessContext': 'member-browser',
                        'checkedFrom': state['checkedFrom'], 'updatedAt': now,
                        'catalogRecheckedAt': state.get('catalogRecheckedAt'),
                        'catalogCount': len(state['catalog']), 'pageCount': len(state['pages']),
                        'excludedCount': state['excluded'], 'items': state['rows']}
            atomic_json(self.root / 'site/data.json', snapshot)
            state.update(success=True, updatedAt=now)
            atomic_json(self.state_path, state)
            atomic_json(self.root / 'evidence/member-collection.json', {
                'success': True, 'checkedFrom': state['checkedFrom'], 'updatedAt': now,
                'accessContext': 'member-browser', 'completeCatalogVerified': True,
                'catalogRecheckedAt': state.get('catalogRecheckedAt'),
                'playbackAvailabilityVerified': True, 'pageCount': len(state['pages']),
                'catalogCount': len(state['catalog']), 'ratedCount': len(state['rows']),
                'excludedCount': state['excluded'], 'failedCount': 0, 'duplicateCount': 0,
                'pages': state['pages'], 'records': state['records']})
            return {'ok': True, 'updatedAt': now, 'ratedCount': len(state['rows']), 'excluded': state['excluded']}
        raise ValueError('Unknown operation')


FORM = '''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>本機資料驗證接收器</title>
<h1>本機資料驗證接收器</h1><p>僅接收已去除個人資料的作品欄位。完整驗證前不會更新網站。</p>
<form method="post"><label>驗證資料<textarea id="payload" name="payload" rows="12" cols="80"></textarea></label>
<button type="submit">儲存驗證批次</button></form></html>'''


def serve(port):
    session = ImportSession()
    class Handler(BaseHTTPRequestHandler):
        def reply(self, body, status=200):
            raw = body.encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(raw)
        def do_GET(self):
            self.reply(FORM)
        def do_POST(self):
            try:
                if self.headers.get('Origin') != f'http://127.0.0.1:{port}':
                    raise ValueError('Unexpected browser origin')
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 8_000_000:
                    raise ValueError('Unexpected payload size')
                fields = urllib.parse.parse_qs(self.rfile.read(size).decode('utf-8'))
                result = session.accept(json.loads(fields['payload'][0]))
            except Exception as error:
                result = {'ok': False, 'error': f'{type(error).__name__}: {error}'}
            self.reply('<!doctype html><meta charset="utf-8"><pre id="result">' + html.escape(json.dumps(result, ensure_ascii=False)) + '</pre>')
    HTTPServer(('127.0.0.1', port), Handler).serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8017)
    serve(parser.parse_args().port)
