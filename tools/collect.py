"""Public HTML probe/collector. No login, proxy, CAPTCHA or access-control bypass."""
import argparse
import datetime as dt
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://ani.gamer.com.tw/'
API = 'https://api.gamer.com.tw/'
AGENT = 'AnimeStarsPersonal/0.1'


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def all(self, tag=None, cls=None):
        result = []
        for child in self.children:
            if isinstance(child, Node):
                if (tag is None or child.tag == tag) and (cls is None or cls in child.attrs.get('class', '').split()):
                    result.append(child)
                result.extend(child.all(tag, cls))
        return result

    def text(self):
        return ' '.join(c.text() if isinstance(c, Node) else c for c in self.children).strip()


class Document(HTMLParser):
    VOID = {'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'embed', 'param', 'wbr', 'col', 'track'}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def official_url(value):
    url = urllib.parse.urljoin(BASE, value)
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'ani.gamer.com.tw':
        raise ValueError('Unexpected source origin')
    return url


def parse_list(source):
    doc = Document(source).root
    items = []
    for a in doc.all('a', 'theme-list-main'):
        url = official_url(a.attrs.get('href', ''))
        sn = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get('sn', [None])[0]
        blocks = a.all(cls='theme-info-block')
        if not sn or not blocks:
            raise ValueError('Catalog item identity/title structure changed')
        info = blocks[0]
        titles = info.all(cls='theme-name') or info.all('h3') or info.all('p')
        title = titles[0].text() if titles else re.split(r'年份[：:]|上架日[：:]', info.text())[0].strip()
        if not title:
            raise ValueError('Missing title')
        year = re.search(r'(?:年份|上架日)[：:]\s*(\d{4}(?:/\d{2})?)', info.text())
        images = a.all('img')
        image = ''
        if images:
            image = urllib.parse.urljoin(BASE, images[0].attrs.get('data-src') or images[0].attrs.get('src', ''))
        items.append({'id': urllib.parse.urlparse(url).path + '?sn=' + sn, 'title': title, 'url': url, 'year': year.group(1) if year else '', 'image': image})
    pages = []
    for a in doc.all('a'):
        parsed = urllib.parse.urlparse(urllib.parse.urljoin(BASE + 'animeList.php', a.attrs.get('href', '')))
        if parsed.hostname == 'ani.gamer.com.tw' and parsed.path == '/animeList.php':
            page = urllib.parse.parse_qs(parsed.query).get('page', [''])[0]
            if page.isdigit():
                pages.append(int(page))
    return items, pages


def parse_rating(source):
    doc = Document(source).root
    numbers, people = doc.all(cls='score-overall-number'), doc.all(cls='score-overall-people')
    if not numbers or not people:
        raise ValueError('Rating elements absent; page may be blocked or require rendering')
    score = re.fullmatch(r'([1-5](?:\.\d)?)', numbers[0].text().strip(' ;'))
    votes = re.search(r'([\d,]+)\s*人', people[0].text())
    if not score:
        if votes and int(votes.group(1).replace(',', '')) == 0:
            return None
        raise ValueError('Unrecognized rating; do not treat parse failure as unrated')
    if not votes:
        raise ValueError('Missing rating count')
    value, count = float(score.group(1)), int(votes.group(1).replace(',', ''))
    if not 1 <= value <= 5 or count < 0:
        raise ValueError('Rating out of range')
    return {'score': value, 'votes': count} if count else None


def parse_metadata(source, anime_sn, access_context='anonymous'):
    if access_context not in ('anonymous', 'member-browser'):
        raise ValueError('Unknown access context')
    payload = json.loads(source)
    if payload.get('error') is not None:
        raise RuntimeError('Official metadata refused access: ' + str(payload['error']))
    data = payload.get('data', {})
    anime, video = data.get('anime', {}), data.get('video', {})
    if str(anime.get('animeSn')) != anime_sn or str(video.get('animeSn')) != anime_sn:
        raise ValueError('Metadata/catalog work ID mismatch')
    permission = video.get('watchingPermission')
    if not isinstance(permission, dict) or permission.get('pass') is not True:
        raise RuntimeError('Official watching permission denied or unknown: ' + str(permission))
    if video.get('requestParentPassword') is not False:
        raise RuntimeError('Parent verification required or unknown; stopping without bypass')
    if not isinstance(video.get('videoSn'), int) or video['videoSn'] <= 0:
        raise ValueError('No official playable episode ID')
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
    for field in ('upTime', 'downTime'):
        value = video.get(field)
        if value == '' and field == 'downTime':
            continue
        if not isinstance(value, str):
            raise ValueError('Missing official availability timestamp')
        # The official API also emits a date-only expiry (observed 2026/10/31).
        # Use the start of that day, so no unstated end-of-day grace is assumed.
        pattern = '%Y/%m/%d' if field == 'downTime' and re.fullmatch(r'\d{4}/\d{2}/\d{2}', value) else '%Y/%m/%d %H:%M'
        timestamp = dt.datetime.strptime(value, pattern).replace(tzinfo=now.tzinfo)
        if (field == 'upTime' and timestamp > now) or (field == 'downTime' and timestamp <= now):
            raise RuntimeError('Official episode is not currently available: ' + field)
    score, votes = anime.get('score'), anime.get('reviewCount')
    if not isinstance(votes, int) or isinstance(votes, bool) or votes < 0:
        raise ValueError('Missing or invalid official review count')
    if votes == 0:
        if score not in (None, 0, '', '--'):
            raise ValueError('Inconsistent unrated metadata')
        return None
    if isinstance(score, bool) or not isinstance(score, (int, float)) or not 1 <= score <= 5:
        raise ValueError('Invalid official score')
    return {'score': float(score), 'votes': votes,
            'availability': {'basis': 'official-watching-permission', 'accessContext': access_context, 'pass': True,
                             'videoSn': video['videoSn'], 'upTime': video['upTime'],
                             'downTime': video['downTime']}}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self):
        self.delay, self.previous, self.requests = 2.5, 0, []
        self.robots = {}
        self.opener = urllib.request.build_opener(NoRedirect())

    def prepare(self):
        for origin in (BASE, API):
            robot = urllib.robotparser.RobotFileParser()
            text = self.get(origin + 'robots.txt', check=False)
            robot.parse(text.splitlines())
            self.robots[origin] = robot
            self.delay = max(self.delay, robot.crawl_delay(AGENT) or 0)

    def get(self, url, check=True, redirects=0):
        parsed = urllib.parse.urlparse(url)
        origin = f'{parsed.scheme}://{parsed.netloc}/'
        robots_missing_page = not check and url == 'https://www.gamer.com.tw/missing.html'
        if origin not in (BASE, API) and not robots_missing_page:
            raise ValueError('Unexpected source origin')
        if check and (origin not in self.robots or not self.robots[origin].can_fetch(AGENT, url)):
            raise RuntimeError('robots.txt does not allow this request')
        time.sleep(max(0, self.delay - (time.monotonic() - self.previous)))
        request = urllib.request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'text/html,text/plain'})
        self.previous = time.monotonic()
        started_at = dt.datetime.now(dt.timezone.utc).isoformat()
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            record = {'url': url, 'status': error.code, 'startedAt': started_at}
            self.requests.append(record)
            if error.code in (301, 302, 303, 307, 308) and redirects < 5:
                target = urllib.parse.urljoin(url, error.headers['Location'])
                record['redirectTo'] = target
                error.close()
                return self.get(target, check=check, redirects=redirects + 1)
            error.close()
            raise
        except OSError as error:
            self.requests.append({'url': url, 'status': None, 'startedAt': started_at, 'error': str(error)})
            raise
        with response:
            raw = response.read(4_000_001)
            if len(raw) > 4_000_000:
                raise ValueError('Unexpected response size')
            text = raw.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
            self.requests.append({'url': url, 'finalUrl': response.url, 'status': response.status, 'bytes': len(raw), 'startedAt': started_at, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat()})
            return text


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')
    temporary.replace(path)


def run(full=False, sample=3):
    report = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'mode': 'collect' if full else 'probe', 'success': False, 'completeCatalogVerified': False, 'playbackAvailabilityVerified': False, 'requests': []}
    client = None
    try:
        client = Client()
        client.prepare()
        catalog, seen, signatures, page = [], set(), set(), 1
        report.update(pageCount=0, duplicateCount=0, failedCount=0, processedCount=0)
        expected_last = None
        while True:
            source = client.get(BASE + f'animeList.php?page={page}&sort=1')
            batch, pages = parse_list(source)
            html_nodes = Document(source).root.all('html')
            if not html_nodes or html_nodes[0].attrs.get('data-geo') != 'TW':
                raise RuntimeError('Official catalog is not the Taiwan region; refusing to substitute another region')
            if not pages:
                raise ValueError('Pagination not recognized; cannot certify full catalog')
            visible_last = max([page] + pages)
            if expected_last is None:
                expected_last = visible_last
            elif visible_last != expected_last:
                raise ValueError('Catalog page count changed during collection')
            if not batch:
                raise ValueError('Empty catalog page; cannot prove completeness')
            signature = tuple(x['id'] for x in batch)
            if signature in signatures:
                raise ValueError('Repeated catalog page; pagination may be broken')
            signatures.add(signature)
            for item in batch:
                if item['id'] not in seen:
                    seen.add(item['id'])
                    catalog.append(item)
                else:
                    report['duplicateCount'] += 1
            report.update(pageCount=page, catalogCount=len(catalog), totalPages=expected_last,
                          lastPageIds=[x['id'] for x in batch])
            if full:
                print(f'目錄進度：{page}/{expected_last} 頁，{len(catalog)} 部', file=sys.stderr, flush=True)
            if not full:
                if page >= 2:
                    break
                page += 1
                continue
            if max(pages) <= page:
                report['completeCatalogVerified'] = True
                break
            page += 1
            if page > 150:
                raise ValueError('Pagination safety limit exceeded')
        rows, excluded = [], 0
        if full:
            atomic_json(ROOT / 'evidence/catalog.json', {'checkedAt': report['checkedAt'], 'pageCount': page, 'items': catalog})
        selected = catalog if full else catalog[:sample]
        for item in selected:
            report['currentItem'] = {'id': item['id'], 'title': item['title'], 'url': item['url']}
            sn = urllib.parse.parse_qs(urllib.parse.urlparse(item['url']).query)['sn'][0]
            metadata_url = API + 'anime/v1/video.php?' + urllib.parse.urlencode({'animeSn': sn})
            rating = parse_metadata(client.get(metadata_url), sn)
            if not full:
                displayed = parse_rating(client.get(item['url']))
                if displayed != (None if rating is None else {k: rating[k] for k in ('score', 'votes')}):
                    raise ValueError('Official metadata and displayed rating disagree')
            if rating is None:
                excluded += 1
            else:
                rows.append({**item, **rating})
            report.update(processedCount=report['processedCount'] + 1, excludedCount=excluded,
                          ratedSampleCount=len(rows))
            if full and report['processedCount'] % 20 == 0:
                report['requests'] = client.requests
                atomic_json(ROOT / 'evidence/collection-progress.json', report)
                print(f'評分及權限進度：{report["processedCount"]}/{len(selected)} 部', file=sys.stderr, flush=True)
        if not rows:
            raise ValueError('No rated works retrieved')
        if report['duplicateCount']:
            raise ValueError('Duplicate catalog identities; cannot certify a stable complete snapshot')
        report.update(success=True, playbackAvailabilityVerified=True, catalogCount=len(catalog), ratedSampleCount=len(rows), excludedCount=excluded, samples=rows[:10])
        if full:
            # Fail closed: no write until every catalog page and every work succeeded.
            payload = {'schemaVersion': 1, 'coverage': 'complete-tw-watchable-catalog', 'playbackAvailabilityVerified': True, 'region': 'TW', 'checkedFrom': report['checkedAt'], 'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'excludedCount': excluded, 'items': rows}
            atomic_json(ROOT / 'site/data.json', payload)
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        report['failedCount'] = 1
        if 'currentItem' in report:
            report['blockedItem'] = report['currentItem']
    finally:
        if client:
            report['requests'] = client.requests
        report['finishedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        atomic_json(ROOT / 'evidence' / ('collection.json' if full else 'probe.json'), report)
    return report


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--collect', action='store_true', help='Collect full public catalog; never publishes partial results')
    parser.add_argument('--sample', type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.sample <= 10:
        parser.error('--sample must be 1..10')
    result = run(args.collect, args.sample)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['success'] else 1)
