import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('measurement_under_test', ROOT/'instrumentation/repair_measurement.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

@pytest.fixture
def log_file(monkeypatch, tmp_path):
    path = tmp_path/'attempts.jsonl'
    monkeypatch.setenv('REPAIR_MEASURE', '1')
    monkeypatch.setenv('REPAIR_MEASURE_FILE', str(path))
    monkeypatch.delenv('OPENAI_BASE_URL', raising=False)
    # Restore patches after every test.
    monkeypatch.setattr(httpx.Client, 'send', httpx.Client.send)
    monkeypatch.setattr(httpx.AsyncClient, 'send', httpx.AsyncClient.send)
    m.install_httpx(httpx)
    return path


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_real_sdk_retry_count_and_privacy(log_file):
    from openai import OpenAI
    statuses = iter([429, 200])
    def respond(request):
        status = next(statuses)
        return httpx.Response(status, json={'error': {'message': 'secret response'}} if status == 429 else {'id': 'ok', 'choices': []}, headers={'retry-after-ms': '1'})
    with m.scope(task_id='task-1', event_id='event-1', node='split_text'):
        with OpenAI(api_key='secret-key', max_retries=1, http_client=httpx.Client(transport=httpx.MockTransport(respond))) as client:
            client.chat.completions.create(model='test-model', messages=[{'role': 'user', 'content': 'secret prompt'}])
    records = rows(log_file)
    starts = [r for r in records if r['event'] == 'openai.started']
    assert len(starts) == 2
    assert [r['sdk_retry'] for r in starts] == ['0', '1']
    assert all(r['task_id'] == 'task-1' for r in starts)
    assert 'secret' not in log_file.read_text()


def test_async_transport_error_and_non_openai(log_file):
    async def run():
        def respond(request):
            if request.url.host == 'api.openai.com':
                raise httpx.ConnectError('secret-url', request=request)
            return httpx.Response(200, json={})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await client.post('http://localhost:8014/mcp', json={})
            with pytest.raises(httpx.ConnectError):
                await client.post('https://api.openai.com/v1/responses', json={'model': 'test'})
    asyncio.run(run())
    assert [r['event'] for r in rows(log_file)] == ['openai.started', 'openai.failed']
    assert 'secret-url' not in log_file.read_text()


def test_concurrent_scopes_and_mcp_header(log_file):
    seen = []
    async def run_one(task):
        with m.scope(task_id=task, node='parallel'):
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: (seen.append(req) or httpx.Response(200, json={})))) as client:
                await client.post('http://localhost:8014/mcp')
                await client.post('https://api.openai.com/v1/responses', json={'model': 'test'})
    async def run():
        await asyncio.gather(run_one('one'), run_one('two'))
    asyncio.run(run())
    assert {r['task_id'] for r in rows(log_file)} == {'one', 'two'}
    for req in seen:
        assert ('x-repair-measurement' in req.headers) == (req.url.host == 'localhost')


def test_disabled_does_not_write(log_file, monkeypatch):
    monkeypatch.setenv('REPAIR_MEASURE', '0')
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))) as client:
        client.post('https://api.openai.com/v1/responses', json={})
    assert not log_file.exists()


def test_event_timer(log_file):
    @m.event_run
    async def handle(command):
        return {'eventType': 'PHOTO_REQUESTED'}
    asyncio.run(handle({'eventId': 'e', 'taskId': 't'}))
    result = rows(log_file)[-1]
    assert result['result_type'] == 'PHOTO_REQUESTED'
    assert result['duration_ms'] >= 0


def test_mcp_incoming_context(log_file, monkeypatch):
    from fastmcp.server import dependencies
    monkeypatch.setattr(dependencies, 'get_http_headers', lambda: {'x-repair-measurement': json.dumps({'task_id': 'remote-task', 'event_id': 'remote-event', 'node': 'normalize', 'secret': 'omit'})})
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))) as client:
        client.post('https://api.openai.com/v1/responses', json={'model': 'test'})
    assert all(r['task_id'] == 'remote-task' for r in rows(log_file))
    assert 'omit' not in log_file.read_text()


def test_subprocess_sitecustomize(log_file, monkeypatch):
    import os
    import subprocess
    monkeypatch.setenv('PYTHONPATH', str(ROOT/'instrumentation'))
    subprocess.run([sys.executable, '-c', "import httpx; c=httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200))); c.post('https://api.openai.com/v1/responses',json={'model':'subprocess'})"], env=os.environ.copy(), check=True)
    assert any(r['event'] == 'measurement.ready' for r in rows(log_file))
    assert sum(r['event'] == 'openai.started' for r in rows(log_file)) == 1


def test_urllib_business_request(log_file, monkeypatch):
    import urllib.request
    from types import SimpleNamespace
    monkeypatch.setattr(urllib.request, 'urlopen', lambda *args, **kwargs: SimpleNamespace(status=200))
    m.install()
    req = urllib.request.Request('https://api.openai.com/v1/responses', data=b'{"model":"business"}', method='POST')
    urllib.request.urlopen(req)
    events = rows(log_file)
    assert sum(r['event'] == 'openai.started' for r in events) == 1
    assert events[-1]['latency_scope'] == 'response_headers'


def test_summary_counts_attempts_and_unfinished():
    spec = importlib.util.spec_from_file_location('summary_under_test', ROOT/'scripts/measurement_summary.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.summarize([
        {'event': 'openai.started', 'call_id': 'a'},
        {'event': 'openai.finished', 'call_id': 'a', 'status': 429, 'duration_ms': 10},
        {'event': 'openai.started', 'call_id': 'b', 'sdk_retry': '1'},
    ])
    assert result['actual_openai_attempts'] == 2
    group = next(iter(result['groups'].values()))
    assert group['sdk_retries'] == group['http_errors'] == group['unfinished'] == 1


def test_rag_function_identity_without_logging_body(log_file):
    namespace={'__name__':'repair_mcp.opinion','m':m,'httpx':httpx}
    exec("def generate_final_opinion():\n with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200))) as c:\n  c.post('https://api.openai.com/v1/responses',json={'model':'test'})",namespace)
    namespace['generate_final_opinion']()
    start=next(r for r in rows(log_file) if r['event']=='openai.started')
    assert start['api_operation']=='rag_final_opinion'
