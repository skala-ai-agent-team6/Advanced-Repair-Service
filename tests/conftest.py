import pytest

from worker import config as C


@pytest.fixture(autouse=True)
def no_case_saving(monkeypatch):
    # [통합] 시험에는 rag-mcp 서버가 없다. 사례 저장(save_repair_case)은 실제 실행에서만 확인한다
    monkeypatch.setattr(C, "SAVE_REPAIR_CASES", False)


@pytest.fixture(autouse=True)
def _no_polish_gpt(request, monkeypatch):
    """[통합] 리포트 근거 다듬기(polish_report)는 GPT를 한 번 더 부른다.
    테스트가 write_report만 흉내 낸 경우 실제 GPT로 나가지 않게 기본은 그대로 통과시킨다 (test_prompts는 직접 검증)."""
    if request.module.__name__.endswith("test_prompts"):
        return
    from worker import tools as _tools

    async def passthrough(summary, candidates):
        return summary, candidates
    monkeypatch.setattr(_tools, "polish_report", passthrough)
