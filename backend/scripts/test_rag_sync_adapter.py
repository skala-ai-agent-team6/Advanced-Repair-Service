"""Contract mock only: these tests do not connect to embeddings or Qdrant."""
import unittest
from urllib.parse import urlsplit, parse_qs
from rag_sync_adapter import SpringConfirmedSync


class AdapterTests(unittest.TestCase):
    def setup_adapter(self, fail=False, ready=True):
        self.receipts, self.points = [], {}
        changes = [dict(id=i, report_id=1, revision=i, document=dict(documentId='internal:report:1', revision=i)) for i in (1, 2)]
        def transport(method, path, body=None):
            if method == 'POST':
                self.receipts.append(body)
                return {}
            after = int(parse_qs(urlsplit(path).query)['after'][0])
            items = [c for c in changes if c['id'] > after][:1]
            cursor = items[-1]['id'] if items else 2
            return dict(items=items, until=2, nextCursor=cursor, hasMore=cursor < 2)
        def index(doc):
            if fail:
                raise RuntimeError('private external failure detail')
            if ready:
                current = self.points.get(doc['documentId'], 0)
                self.points[doc['documentId']] = max(current, doc['revision'])
            return {'searchReady': ready}
        return SpringConfirmedSync('http://spring.test', 'test-only', index, transport=transport)

    def test_mock_upsert_replaces_document_and_replaying_does_not_duplicate(self):
        adapter = self.setup_adapter()
        self.assertEqual(adapter.sync_once()['checkpoint'], 2)
        adapter.checkpoint = 0
        adapter.sync_once()
        self.assertEqual(self.points, {'internal:report:1': 2})
        self.assertEqual([r['status'] for r in self.receipts], ['SUCCEEDED'] * 4)

    def test_failure_reports_error_without_advancing_cursor(self):
        adapter = self.setup_adapter(fail=True)
        with self.assertRaisesRegex(RuntimeError, '^INDEX_FAILED$'):
            adapter.sync_once()
        self.assertEqual(adapter.checkpoint, 0)
        self.assertEqual(self.receipts[0]['status'], 'ERROR')
        self.assertNotIn('private', str(self.receipts))

    def test_not_search_ready_is_never_reported_as_success(self):
        adapter = self.setup_adapter(ready=False)
        with self.assertRaises(RuntimeError):
            adapter.sync_once()
        self.assertEqual(self.receipts[0]['status'], 'ERROR')

    def test_rejects_credential_bearing_configuration(self):
        with self.assertRaises(ValueError):
            SpringConfirmedSync('https://user:password@spring.test', 'token', lambda d: {})


if __name__ == '__main__':
    unittest.main()
