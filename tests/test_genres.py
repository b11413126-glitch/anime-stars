"""Synthetic unit fixtures only: no fabricated ranking data is published."""
import importlib.util
import unittest
import tempfile
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('update_genres', Path(__file__).resolve().parents[1] / 'tools/update_genres.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IdentityTests(unittest.TestCase):
    def fixture(self):
        item = {'id': '/animeRef.php?sn=999', 'title': '測試動畫 第二季', 'year': '2024/01',
                'image': 'https://p2.bahamut.com.tw/B/ACG/c/42/0000042.JPG'}
        entry = {'title': '試験 第二期', 'titleTranslate': {'zh-Hant': ['測試動畫 第二季']},
                 'begin': '2023-12-31T16:00:00.000Z', 'sites': [{'site': 'gamer', 'id': '42'}, {'site': 'bangumi', 'id': '123'}]}
        crosswalk = {'siteMeta': {'gamer': {'urlTemplate': 'https://acg.gamer.com.tw/acgDetail.php?s={{id}}'}}, 'items': [entry]}
        return item, entry, crosswalk

    def test_precise_acg_title_taipei_month_and_subject_id(self):
        item, _, crosswalk = self.fixture()
        matches, reasons = module.match_items([item], crosswalk)
        self.assertEqual(matches[item['id']]['subjectId'], 123)
        self.assertEqual(matches[item['id']]['gamerId'], '42')
        self.assertFalse(reasons)

    def test_same_name_different_season_month_or_namespace_is_not_guessed(self):
        for field, value in [('title', '測試動畫'), ('year', '2023/12'), ('image', 'https://p2.bahamut.com.tw/B/ACG/c/99/0000999.JPG')]:
            item, _, crosswalk = self.fixture()
            item[field] = value
            matches, reasons = module.match_items([item], crosswalk)
            self.assertFalse(matches)
            self.assertEqual(reasons[item['id']], 'identity-not-confirmed')

    def test_ambiguous_crosswalk_or_url_override_is_not_silently_selected(self):
        item, entry, crosswalk = self.fixture()
        crosswalk['items'].append(entry.copy())
        self.assertEqual(module.match_items([item], crosswalk)[1][item['id']], 'ambiguous-identity')
        crosswalk['items'].pop()
        entry['sites'][0]['url'] = 'https://example.test/another-id'
        self.assertFalse(module.match_items([item], crosswalk)[0])

    def test_missing_meta_tags_fail_but_explicit_empty_is_preserved(self):
        subject = {'id': 123, 'type': 2, 'name': '試験', 'date': '2024-01-01'}
        with self.assertRaises(ValueError):
            module.public_subject(subject)
        subject.update(meta_tags=[], collection={'private-fixture': True}, tags=[{'name': '不可當公共題材'}])
        selected = module.public_subject(subject)
        self.assertEqual(selected['meta_tags'], [])
        self.assertNotIn('collection', selected)
        self.assertNotIn('tags', selected)

    def test_confirmed_live_action_is_unclassified_and_never_borrows_tags(self):
        test_root = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(dir=test_root, prefix='.genre-test-') as folder:
            self.assertTrue(Path(folder).resolve().is_relative_to(test_root))
            api = module.PublicAPI(Path(folder))
            api.cache({'id': 123, 'type': 6, 'name': '真人影視測試', 'date': '2024-01-01', 'meta_tags': ['奇幻']})
            cached = json.loads((Path(folder) / '123.json').read_text(encoding='utf-8'))
            self.assertEqual(cached['identityConflict']['type'], 6)
            self.assertNotIn('subject', cached)
            self.assertNotIn('meta_tags', cached['identityConflict'])


if __name__ == '__main__':
    unittest.main()
