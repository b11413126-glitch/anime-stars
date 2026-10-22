import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from browser_import import ImportSession


class BrowserImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root = Path(self.temp.name)
        (self.root / 'site').mkdir()
        (self.root / 'site/data.json').write_text('previous snapshot', encoding='utf-8')
        self.session = ImportSession(self.root)
        self.catalog = [{'id': f'/animeRef.php?sn={sn}', 'title': f'測試作品{sn}',
                         'url': f'https://ani.gamer.com.tw/animeRef.php?sn={sn}',
                         'year': '2020', 'image': ''} for sn in (42, 43)]
        self.session.accept({'kind': 'begin', 'catalog': self.catalog,
                             'pages': [{'page': 1, 'totalPages': 1, 'count': 2}], 'region': 'TW',
                             'checkedFrom': '2026-10-18T00:00:00Z', 'delaySeconds': 2.6,
                             'robots': {'https://ani.gamer.com.tw/': 'User-agent: *\nAllow: /',
                                        'https://api.gamer.com.tw/': 'User-agent: *\nAllow: /'}})

    def tearDown(self):
        self.temp.cleanup()

    def record(self, sn, allowed=True):
        return {'animeSn': sn, 'checkedAt': '2026-10-18T00:01:00Z',
                'data': {'anime': {'animeSn': sn, 'score': 4.9, 'reviewCount': 123, 'tags': ['奇幻', '戀愛']},
                         'video': {'animeSn': sn, 'videoSn': sn + 100, 'upTime': '2020/01/01 00:00',
                                   'downTime': '', 'watchingPermission': {'pass': allowed},
                                   'requestParentPassword': False}}}

    def test_incomplete_run_never_replaces_previous_snapshot(self):
        self.session.accept({'kind': 'batch', 'offset': 0, 'records': [self.record(42)]})
        with self.assertRaises(ValueError):
            self.session.accept({'kind': 'finish'})
        self.assertEqual((self.root / 'site/data.json').read_text(encoding='utf-8'), 'previous snapshot')

    def test_denial_or_identity_mismatch_does_not_advance_batch(self):
        for record in (self.record(43), self.record(42, allowed=False)):
            with self.assertRaises((ValueError, RuntimeError)):
                self.session.accept({'kind': 'batch', 'offset': 0, 'records': [record]})
        state = json.loads(self.session.state_path.read_text(encoding='utf-8'))
        self.assertEqual(state['processed'], 0)
        self.assertEqual((self.root / 'site/data.json').read_text(encoding='utf-8'), 'previous snapshot')

    def test_complete_run_requires_unchanged_catalog_before_atomic_publish(self):
        self.session.accept({'kind': 'batch', 'offset': 0, 'records': [self.record(42), self.record(43)]})
        finish = {'kind': 'finish', 'firstIds': [x['id'] for x in self.catalog],
                  'lastIds': [x['id'] for x in self.catalog], 'totalPages': 1}
        with self.assertRaises(ValueError):
            self.session.accept({**finish, 'lastIds': []})
        self.assertEqual((self.root / 'site/data.json').read_text(encoding='utf-8'), 'previous snapshot')
        self.assertTrue(self.session.accept(finish)['ok'])
        snapshot = json.loads((self.root / 'site/data.json').read_text(encoding='utf-8'))
        self.assertEqual(len(snapshot['items']), 2)
        self.assertEqual(snapshot['items'][0]['availability']['accessContext'], 'member-browser')
        self.assertTrue(snapshot['officialTagsVerified'])
        self.assertEqual(snapshot['items'][0]['tags'], ['奇幻', '戀愛'])

    def test_same_page_reordering_is_accepted_but_duplicates_are_rejected(self):
        self.session.accept({'kind': 'batch', 'offset': 0, 'records': [self.record(42), self.record(43)]})
        ids = [x['id'] for x in self.catalog]
        with self.assertRaises(ValueError):
            self.session.accept({'kind': 'finish', 'firstIds': [ids[0], ids[0]],
                                 'lastIds': ids, 'totalPages': 1})
        self.assertTrue(self.session.accept({'kind': 'finish', 'firstIds': ids[::-1],
                                             'lastIds': ids, 'totalPages': 1})['ok'])

    def test_bad_tags_roll_back_the_entire_batch_and_preserve_snapshot(self):
        for tags in (None, '奇幻', [''], [' 奇幻'], ['奇幻', '奇幻'], [123]):
            bad = self.record(43)
            bad['data']['anime']['tags'] = tags
            with self.assertRaises(ValueError):
                self.session.accept({'kind': 'batch', 'offset': 0, 'records': [self.record(42), bad]})
            state = json.loads(self.session.state_path.read_text(encoding='utf-8'))
            self.assertEqual(state['processed'], 0)
            self.assertEqual((self.root / 'site/data.json').read_text(encoding='utf-8'), 'previous snapshot')

    def test_explicit_no_tags_is_valid_but_missing_tags_on_unrated_work_is_not(self):
        record = self.record(42)
        record['data']['anime']['tags'] = []
        self.session.accept({'kind': 'batch', 'offset': 0, 'records': [record]})
        record = self.record(43)
        record['data']['anime'].update(score=0, reviewCount=0)
        del record['data']['anime']['tags']
        with self.assertRaises(ValueError):
            self.session.accept({'kind': 'batch', 'offset': 1, 'records': [record]})
        state = json.loads(self.session.state_path.read_text(encoding='utf-8'))
        self.assertEqual(state['rows'][0]['tags'], [])
        self.assertEqual(state['processed'], 1)

    def test_robots_for_catalog_are_checked_before_collection(self):
        with self.assertRaises(RuntimeError):
            self.session.accept({'kind': 'robots', 'delaySeconds': 2.6,
                                 'robots': {'https://ani.gamer.com.tw/': 'User-agent: *\nAllow: /',
                                            'https://api.gamer.com.tw/': 'User-agent: *\nDisallow: /anime/v1/anime_list.php'}})

    def test_full_catalog_recheck_accepts_reordering_but_rejects_changed_membership(self):
        self.session.accept({'kind': 'batch', 'offset': 0, 'records': [self.record(42), self.record(43)]})
        recheck = {'kind': 'recheck', 'catalog': list(reversed(self.catalog)),
                   'pages': [{'page': 1, 'totalPages': 1, 'count': 2}], 'region': 'TW',
                   'delaySeconds': 2.6, 'robots': {'https://ani.gamer.com.tw/': 'User-agent: *\nAllow: /',
                                                'https://api.gamer.com.tw/': 'User-agent: *\nAllow: /'}}
        changed = [self.catalog[0], {**self.catalog[1], 'id': '/animeRef.php?sn=44',
                                   'url': 'https://ani.gamer.com.tw/animeRef.php?sn=44'}]
        with self.assertRaises(ValueError):
            self.session.accept({**recheck, 'catalog': changed})
        self.assertEqual((self.root / 'site/data.json').read_text(encoding='utf-8'), 'previous snapshot')
        self.assertTrue(self.session.accept(recheck)['membershipUnchanged'])
        ids = [x['id'] for x in recheck['catalog']]
        self.assertTrue(self.session.accept({'kind': 'finish', 'firstIds': ids, 'lastIds': ids, 'totalPages': 1})['ok'])
        snapshot = json.loads((self.root / 'site/data.json').read_text(encoding='utf-8'))
        self.assertIsNotNone(snapshot['catalogRecheckedAt'])
        self.assertEqual({x['id'] for x in snapshot['items']}, set(ids))


if __name__ == '__main__':
    unittest.main()
