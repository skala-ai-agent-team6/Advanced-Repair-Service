"""Opt-in, metadata-only HTTP attempt measurement; shared by worker and local MCPs."""
import contextlib
import contextvars
import datetime
import functools
import json
import os
import sys
import time
import uuid
from urllib.parse import urlparse

_context = contextvars.ContextVar('repair_measurement', default={})
_HEADER = 'x-repair-measurement'


def enabled():
    return os.environ.get('REPAIR_MEASURE') == '1'


def context():
    local = _context.get()
    if local:
        return local
    try:
        from fastmcp.server.dependencies import get_http_headers
        raw = get_http_headers().get(_HEADER, '{}')
        data = json.loads(raw) if len(raw) < 2048 else {}
        return {k: v for k, v in data.items() if k in ('event_id', 'task_id', 'node', 'tool', 'attempt') and isinstance(v, (str, int))}
    except Exception:
        return {}


@contextlib.contextmanager
def scope(**fields):
    token = _context.set({**context(), **fields})
    try:
        yield
    finally:
        _context.reset(token)


def emit(event, **fields):
    if not enabled():
        return
    row = dict(timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
               session=os.environ.get('REPAIR_MEASURE_SESSION', 'manual'),
               version=os.environ.get('REPAIR_MEASURE_VERSION', 'v1'),
               pid=os.getpid(), process=os.path.basename(sys.argv[0]),
               event=event, **context())
    row.update(fields)
    line = (json.dumps(row, ensure_ascii=True) + '\n').encode()
    # Measurement failure must never turn a successful diagnosis into a failure.
    try:
        path = os.environ['REPAIR_MEASURE_FILE']
        import fcntl
        with open(path, 'ab', buffering=0) as out:
            fcntl.flock(out, fcntl.LOCK_EX)
            out.write(line)
            fcntl.flock(out, fcntl.LOCK_UN)
    except Exception as exc:
        print('measurement.write_failed ' + type(exc).__name__, file=sys.stderr)


def event_run(fn):
    @functools.wraps(fn)
    async def wrapped(command, *args, **kwargs):
        with scope(event_id=command.get('eventId'), task_id=command.get('taskId')):
            started = time.perf_counter()
            emit('execution.started')
            try:
                result = await fn(command, *args, **kwargs)
                emit('execution.finished', duration_ms=round((time.perf_counter()-started)*1000, 2),
                     result_type=result.get('eventType') if isinstance(result, dict) else None)
                return result
            except BaseException as exc:
                emit('execution.failed', duration_ms=round((time.perf_counter()-started)*1000, 2), error_type=type(exc).__name__)
                raise
    return wrapped


def target(url, method):
    parsed = urlparse(str(url))
    host = urlparse(os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1')).hostname
    return method.upper() == 'POST' and parsed.hostname == host and parsed.path.rstrip('/').endswith(('/chat/completions', '/responses', '/embeddings'))


def operation_name():
    # 함수 이름만 확인한다. 인자·프롬프트·응답·로컬 변수는 기록하지 않는다.
    frame = sys._getframe(1)
    try:
        while frame is not None:
            module = frame.f_globals.get('__name__', '')
            name = frame.f_code.co_name
            if module == 'repair_mcp.opinion' and name == 'generate_final_opinion':
                return 'rag_final_opinion'
            if module == 'repair_mcp.normalize' and name == 'normalize_observations':
                return 'normalize_observation'
            frame = frame.f_back
    finally:
        del frame
    return context().get('tool', 'unknown')


def begin(url, method, headers, body):
    if not enabled() or not target(url, method):
        return None
    try:
        model = json.loads(body).get('model')
    except Exception:
        model = None
    call_id = uuid.uuid4().hex
    emit('openai.started', call_id=call_id, model=model, api_operation=operation_name(),
         sdk_retry=headers.get('x-stainless-retry-count', '0'), endpoint=urlparse(str(url)).path)
    return call_id, time.perf_counter()


def finish(call, response=None, error=None, streaming=False):
    if call:
        emit('openai.failed' if error else 'openai.finished', call_id=call[0],
             duration_ms=round((time.perf_counter()-call[1])*1000, 2),
             status=getattr(response, 'status_code', getattr(response, 'status', None)),
             error_type=type(error).__name__ if error else None,
             latency_scope='response_headers' if streaming else 'response_body')


def install_httpx(module):
    for cls, asynchronous in ((module.Client, False), (module.AsyncClient, True)):
        original = cls.send
        if getattr(original, '_repair_measurement', False):
            continue
        def prepare(request):
            # Correlation is only sent to MCP endpoint requests, never to OpenAI.
            if enabled() and urlparse(str(request.url)).path.rstrip('/').endswith('/mcp') and context():
                request.headers[_HEADER] = json.dumps(context(), ensure_ascii=True)
            try:
                body = request.content
            except Exception:
                body = b''
            return begin(request.url, request.method, request.headers, body)
        if asynchronous:
            @functools.wraps(original)
            async def send(self, request, *args, _original=original, **kwargs):
                call = prepare(request)
                try:
                    response = await _original(self, request, *args, **kwargs)
                except BaseException as exc:
                    finish(call, error=exc)
                    raise
                finish(call, response, streaming=kwargs.get('stream', False))
                return response
        else:
            @functools.wraps(original)
            def send(self, request, *args, _original=original, **kwargs):
                call = prepare(request)
                try:
                    response = _original(self, request, *args, **kwargs)
                except BaseException as exc:
                    finish(call, error=exc)
                    raise
                finish(call, response, streaming=kwargs.get('stream', False))
                return response
        send._repair_measurement = True
        cls.send = send


def install():
    if not enabled():
        return
    loaded = []
    for name in ('httpx', 'httpx2'):
        try:
            import importlib
            install_httpx(importlib.import_module(name))
            loaded.append(name)
        except ImportError:
            pass
    import urllib.request
    original = urllib.request.urlopen
    if not getattr(original, '_repair_measurement', False):
        @functools.wraps(original)
        def urlopen(request, *args, **kwargs):
            call = begin(getattr(request, 'full_url', request),
                         request.get_method() if hasattr(request, 'get_method') else 'GET',
                         dict(request.header_items()) if hasattr(request, 'header_items') else {},
                         getattr(request, 'data', None))
            try:
                response = original(request, *args, **kwargs)
            except BaseException as exc:
                finish(call, error=exc)
                raise
            finish(call, response, streaming=True)
            return response
        urlopen._repair_measurement = True
        urllib.request.urlopen = urlopen
    emit('measurement.ready', clients=loaded + ['urllib'])
