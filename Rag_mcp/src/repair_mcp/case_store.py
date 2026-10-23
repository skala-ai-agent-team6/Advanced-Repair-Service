"""[통합] 에이전트 진단 사례 저장소. 기사 확인 전 자료라 검색 색인과 분리해 둔다."""
import json
import threading
from datetime import datetime, timezone

from .config import RUNTIME

LOCK = threading.Lock()


def _path():
    return RUNTIME / "agent_cases.jsonl"


def _read():
    path = _path()
    if not path.exists():
        return {}
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            rows[row["case_id"]] = row
    return rows


def save_case(case: dict) -> dict:
    with LOCK:
        rows = _read()
        created = case["case_id"] not in rows
        rows[case["case_id"]] = {**case, "status": "ai_draft_unconfirmed", "diagnosis_confirmed": False,
                                 "saved_at": datetime.now(timezone.utc).isoformat()}
        RUNTIME.mkdir(parents=True, exist_ok=True)
        tmp = _path().with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows.values()), encoding="utf-8")
        tmp.replace(_path())
    return {"saved": True, "created": created, "case_id": case["case_id"], "total": len(rows),
            "indexed_for_search": False}


def list_cases(limit: int) -> list[dict]:
    with LOCK:
        rows = sorted(_read().values(), key=lambda r: r["saved_at"], reverse=True)
    return rows[:limit]
