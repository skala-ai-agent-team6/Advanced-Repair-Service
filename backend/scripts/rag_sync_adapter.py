"""RAG-team adapter: inject a real indexer; Spring never embeds documents itself.

The injected indexer must atomically upsert by documentId/version and return
{'searchReady': True}. No indexing success is inferred from an HTTP GET.
"""
import json
import uuid
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, HTTPRedirectHandler, ProxyHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SpringConfirmedSync:
    def __init__(self, base_url, service_token, indexer, checkpoint=0, transport=None):
        parsed = urlsplit(base_url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('INVALID_SPRING_URL')
        if not service_token or indexer is None:
            raise ValueError('SERVICE_TOKEN_AND_REAL_INDEXER_REQUIRED')
        self.base = base_url.rstrip('/')
        self.token = service_token
        self.indexer = indexer
        self.checkpoint = checkpoint
        self.transport = transport or self._request

    def _request(self, method, path, body=None):
        payload = None if body is None else json.dumps(body).encode()
        request = Request(self.base + path, data=payload, method=method,
                          headers={'Authorization': 'Bearer ' + self.token,
                                   'Content-Type': 'application/json'})
        # Credentials never enter URLs or application logs.
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=10) as response:
            return json.load(response)

    def sync_once(self, size=100):
        after, until, handled = self.checkpoint, None, 0
        while True:
            query = {'after': after, 'size': size}
            if until is not None:
                query['until'] = until
            page = self.transport('GET', '/internal/rag/confirmed-changes?' + urlencode(query))
            until = page['until']
            for item in page['items']:
                receipt = {'requestKey': str(uuid.uuid4()), 'reportId': str(item['report_id']),
                           'revision': item['revision'], 'status': 'SUCCEEDED'}
                try:
                    result = self.indexer(item['document'])
                    if not isinstance(result, dict) or result.get('searchReady') is not True:
                        raise RuntimeError('INDEX_NOT_SEARCH_READY')
                except Exception:
                    receipt.update(status='ERROR', errorCode='INDEX_FAILED')
                    self.transport('POST', f"/internal/rag/confirmed-changes/{item['id']}/receipt", receipt)
                    raise RuntimeError('INDEX_FAILED') from None
                self.transport('POST', f"/internal/rag/confirmed-changes/{item['id']}/receipt", receipt)
                handled += 1
            after = page['nextCursor']
            if not page['hasMore']:
                self.checkpoint = after
                return {'checkpoint': after, 'handled': handled}
