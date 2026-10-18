import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[1] / 'tools/collect.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CollectorTests(unittest.TestCase):
    def test_date_only_expiry_is_validated_without_assuming_extra_hours(self):
        now = c.dt.datetime.now(c.dt.timezone(c.dt.timedelta(hours=8)))
        body = {'data': {'anime': {'animeSn': 42, 'score': 4.9, 'reviewCount': 123},
                         'video': {'animeSn': 42, 'videoSn': 99, 'upTime': '2020/01/01 00:00',
                                   'downTime': (now + c.dt.timedelta(days=2)).strftime('%Y/%m/%d'),
                                   'watchingPermission': {'pass': True}, 'requestParentPassword': False}}}
        self.assertEqual(c.parse_metadata(json.dumps(body), '42')['score'], 4.9)
        body['data']['video']['downTime'] = now.strftime('%Y/%m/%d')
        with self.assertRaises(RuntimeError):
            c.parse_metadata(json.dumps(body), '42')
        body['data']['video']['downTime'] = '2026/13/31'
        with self.assertRaises(ValueError):
            c.parse_metadata(json.dumps(body), '42')

    def test_late_login_requirement_preserves_snapshot_and_stops(self):
        metadata = {'data': {'anime': {'animeSn': 42, 'score': 4.9, 'reviewCount': 123},
                             'video': {'animeSn': 42, 'videoSn': 99, 'upTime': '2020/01/01 00:00',
                                       'downTime': '', 'watchingPermission': {'pass': True},
                                       'requestParentPassword': False}}}
        calls = []
        class PublicClient:
            requests = []
            def prepare(self):
                pass
            def get(self, url):
                calls.append(url)
                if 'animeList.php' in url:
                    return '<html data-geo="TW"><a class="theme-list-main" href="animeRef.php?sn=42"><div class="theme-info-block"><h3>第一季</h3></div></a><a class="theme-list-main" href="animeRef.php?sn=43"><div class="theme-info-block"><h3>第二季</h3></div></a><a href="?page=1">1</a></html>'
                if 'animeSn=42' in url:
                    return json.dumps(metadata)
                return json.dumps({'error': {'code': 1016, 'message': '須登入您的巴哈帳號'}})
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder:
            root = Path(folder)
            (root/'site').mkdir()
            snapshot = root/'site/data.json'
            snapshot.write_text('previous verified snapshot', encoding='utf-8')
            with patch.object(c, 'ROOT', root), patch.object(c, 'Client', PublicClient):
                result = c.run(full=True)
            self.assertFalse(result['success'])
            self.assertTrue(result['completeCatalogVerified'])
            self.assertFalse(result['playbackAvailabilityVerified'])
            self.assertEqual(result['processedCount'], 1)
            self.assertEqual(result['failedCount'], 1)
            self.assertIn('1016', result['error'])
            self.assertEqual(snapshot.read_text(encoding='utf-8'), 'previous verified snapshot')
            self.assertEqual(len(calls), 3)

    def test_query_relative_catalog_pagination(self):
        html = "<a href='?page=2&sort=1'>2</a><a href='?page=69&sort=1'>69</a>"
        self.assertEqual(c.parse_list(html)[1], [2, 69])

    def test_metadata_matches_catalog_identity_and_watch_permission(self):
        body = {'data': {'anime': {'animeSn': 42, 'score': 4.9, 'reviewCount': 123},
                         'video': {'animeSn': 42, 'videoSn': 99, 'upTime': '2020/01/01 00:00',
                                   'downTime': '', 'watchingPermission': {'pass': True},
                                   'requestParentPassword': False}}}
        self.assertEqual(c.parse_metadata(json.dumps(body), '42')['score'], 4.9)
        body['data']['anime']['animeSn'] = 43
        with self.assertRaises(ValueError):
            c.parse_metadata(json.dumps(body), '42')

    def test_denied_or_unknown_watch_permission_cannot_publish(self):
        for permission in ({'pass': False}, {}, None):
            body = {'data': {'anime': {'animeSn': 42, 'score': 4.9, 'reviewCount': 123},
                             'video': {'animeSn': 42, 'videoSn': 99, 'upTime': '2020/01/01 00:00',
                                       'downTime': '', 'watchingPermission': permission,
                                       'requestParentPassword': False}}}
            with self.assertRaises((ValueError, RuntimeError)):
                c.parse_metadata(json.dumps(body), '42')

    def test_rating_is_not_popularity(self):
        html = '<p>9000萬觀看</p><div class="score-overall-number">4.9</div><div class="score-overall-people">12,345人評價</div>'
        self.assertEqual(c.parse_rating(html), {'score': 4.9, 'votes': 12345})

    def test_blocked_page_cannot_be_unrated(self):
        with self.assertRaises(ValueError):
            c.parse_rating('<h1>Access denied</h1>')
        self.assertIsNone(c.parse_rating('<div class="score-overall-number">--</div><div class="score-overall-people">0人評價</div>'))

    def test_failed_network_preserves_previous_snapshot(self):
        test_parent = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(dir=test_parent) as folder:
            root = Path(folder)
            self.assertTrue(root.resolve().is_relative_to(test_parent))
            (root / 'site').mkdir()
            path = root / 'site/data.json'
            path.write_text('previous success', encoding='utf-8')
            with patch.object(c, 'ROOT', root), patch.object(c, 'Client', side_effect=OSError('network blocked')):
                result = c.run(full=True)
            self.assertFalse(result['success'])
            self.assertEqual(path.read_text(encoding='utf-8'), 'previous success')

    def test_catalog_keeps_series_and_pagination(self):
        html = '<a class="theme-list-main" href="animeRef.php?sn=42"><img data-src="https://p2.bahamut.com.tw/a.jpg"><div class="theme-info-block"><h3>作品 第二季</h3><p>年份：2026/01 共12集</p></div></a><a href="animeList.php?page=2">2</a>'
        items, pages = c.parse_list(html)
        self.assertEqual(items[0]['title'], '作品 第二季')
        self.assertEqual(items[0]['year'], '2026/01')
        self.assertEqual(pages, [2])

if __name__ == '__main__':
    unittest.main()
