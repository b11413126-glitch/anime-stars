"""Synthetic unit fixtures only; real website credits come from public staff roles."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('update_studios', Path(__file__).resolve().parents[1] / 'tools/update_studios.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StudioTests(unittest.TestCase):
    def test_only_exact_animation_production_company_role(self):
        roles = ['动画制作', '製作', '制作', '制作协力', '製作协力', 'OP・ED 动画制作', '协力']
        response = [{'id': n + 1, 'name': '測試公司', 'type': 2, 'relation': role, 'eps': '1-3', 'private': 'discard'} for n, role in enumerate(roles)]
        response.append({'id': 99, 'name': '測試個人', 'type': 1, 'relation': '动画制作'})
        self.assertEqual(module.credits(response), [{'id': '1', 'name': '測試公司', 'type': 2, 'relation': '动画制作', 'eps': '1-3'}])

    def test_co_production_preserved_and_duplicate_rejected(self):
        rows = [{'id': n, 'name': '測試公司', 'type': 2, 'relation': '动画制作'} for n in [1, 2]]
        self.assertEqual([x['id'] for x in module.credits(rows)], ['1', '2'])
        with self.assertRaises(ValueError):
            module.credits(rows + [rows[0]])
        for response in [{}, [{'id': 1, 'name': '', 'type': 2, 'relation': '动画制作'}]]:
            with self.assertRaises(ValueError):
                module.credits(response)

    def test_public_alias_fields_only_and_identity_must_match(self):
        row = {'id': 1, 'type': 2, 'name': '測試公司', 'infobox': [
            {'key': '别名', 'value': [{'v': 'Test Studio'}]}, {'key': '成立', 'value': '不可當別名'}], 'comments': 'discard'}
        result = module.aliases(row, '1')
        self.assertEqual(set(result['aliases']), {'測試公司', 'Test Studio'})
        self.assertNotIn('comments', result)
        with self.assertRaises(ValueError):
            module.aliases(row, '2')

    def test_missing_credit_cache_does_not_publish_partial_data(self):
        snapshot = json.dumps({'updatedAt': '2026-10-18T00:00:00Z', 'items': [{'id': 'test'}]}).encode()
        genres = json.dumps({'rankingSHA256': hashlib.sha256(snapshot).hexdigest(), 'rankingUpdatedAt': '2026-10-18T00:00:00Z',
                             'records': [{'id': 'test', 'match': {'subjectId': 1}}]}).encode()
        test_root = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(dir=test_root, prefix='.studio-test-') as folder:
            self.assertTrue(Path(folder).resolve().is_relative_to(test_root))
            with self.assertRaisesRegex(ValueError, 'Unprocessed'):
                module.build(snapshot, genres, Path(folder))

    def test_offline_cache_requires_exact_credits_and_no_unresolved_failure(self):
        snapshot = json.dumps({'updatedAt': '2026-10-18T00:00:00Z', 'items': [{'id': 'test'}]}).encode()
        genres = json.dumps({'rankingSHA256': hashlib.sha256(snapshot).hexdigest(), 'rankingUpdatedAt': '2026-10-18T00:00:00Z',
                             'records': [{'id': 'test', 'match': {'subjectId': 1}}]}).encode()
        test_root = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory(dir=test_root, prefix='.studio-test-') as folder:
            self.assertTrue(Path(folder).resolve().is_relative_to(test_root))
            cache = Path(folder)
            row = {'subjectId': 1, 'checkedAt': '2026-10-24T01:00:00Z', 'credits': [
                {'id': '11', 'name': '測試公司', 'type': 2, 'relation': '动画制作', 'eps': ''}]}
            module.save(cache / 'subjects/1.json', row)
            value = module.build(snapshot, genres, cache)
            self.assertEqual(value['classifiedCount'], 1)
            self.assertEqual(value['studios'][0]['count'], 1)
            self.assertEqual(value['rankingUpdatedAt'], '2026-10-18T00:00:00Z')
            row['credits'][0]['relation'] = '制作协力'
            module.save(cache / 'subjects/1.json', row)
            with self.assertRaisesRegex(ValueError, 'Cached public credit'):
                module.build(snapshot, genres, cache)
            module.save(cache / 'failure.json', {'status': 'stopped'})
            with self.assertRaisesRegex(ValueError, 'Unresolved'):
                module.build(snapshot, genres, cache)


if __name__ == '__main__':
    unittest.main()
