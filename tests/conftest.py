import pytest

from worker import config as C


@pytest.fixture(autouse=True)
def no_case_saving(monkeypatch):
    # [통합] 시험에는 rag-mcp 서버가 없다. 사례 저장(save_repair_case)은 실제 실행에서만 확인한다
    monkeypatch.setattr(C, "SAVE_REPAIR_CASES", False)
