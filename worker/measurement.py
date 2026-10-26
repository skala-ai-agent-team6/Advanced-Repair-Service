"""측정 실행에서만 활성화. 일반 실행은 기존 동작을 유지한다."""
try:
    from repair_measurement import scope, emit, event_run
except ImportError:
    from contextlib import nullcontext
    def scope(**fields):
        return nullcontext()
    def emit(*args, **kwargs):
        pass
    def event_run(fn):
        return fn
