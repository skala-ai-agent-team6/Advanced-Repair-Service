"""평가셋 실행: 실제 MCP·GPT로 cases.json 20건을 돌려 기대 판정과 비교한다.

Spring·Kafka 없이 worker.verify_live와 같은 방식(사진 입력만 로컬 파일, 이벤트는 메모리 수집)으로 돈다.
실행: uv run python -m eval.run_eval --label baseline
결과: eval/results/<label>/results.json, summary.md
"""
import argparse
import asyncio
import copy
import hashlib
import json
import logging
import os
import time
import uuid
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

from worker import config as C, main, tools
from worker.journal import Journal
from worker.send_test import COMMAND
from worker.verify_live import LocalOutput

HERE = Path(__file__).parent
VERDICT = {"DIAGNOSIS_COMPLETED": "ok", "PHOTO_REQUESTED": "needs_review", "DIAGNOSIS_FAILED": "error"}
DOWN = {"MECH_MCP_URL": "http://127.0.0.1:1/mcp", "RAG_MCP_URL": "http://127.0.0.1:1/mcp",
        "PCB_MCP_SERVER": str(HERE / "missing_pcb_server.py")}


def build(case):
    cmd = copy.deepcopy(COMMAND)
    task = str(uuid.uuid4().int % 100000000 + 1)
    cmd.update(eventId=str(uuid.uuid4()), taskId=task, repairId=task)
    repair = cmd["payload"]["repair"]
    repair.update(id=task, symptom=case["symptom"], error_codes=case["error_codes"],
                  user_input={"customerDescription": case["description"]})
    cmd["payload"]["task"]["id"] = task
    paths = [(target, HERE / "images" / name) for target, name in case["photos"]]
    cmd["payload"]["attachments"] = [
        {"id": str(i + 1), "request_id": None, "mime_type": "image/jpeg",
         "downloadPath": f"/internal/attachments/{i + 1}", "target": target,
         "byte_size": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
        for i, (target, p) in enumerate(paths)]
    cmd["payload"]["attachmentIds"] = [a["id"] for a in cmd["payload"]["attachments"]]
    local = [{"attachmentId": str(i + 1), "path": str(p.resolve()), "target": target}
             for i, (target, p) in enumerate(paths)]
    return cmd, local


def grade(case, result, events):
    exp, p = case["expect"], result["payload"]
    actual = VERDICT.get(result["eventType"], "error")
    rows = p.get("analysisResults", [])
    labels = sorted({l for r in rows if r["source"] in ("PCB", "MECH") for l in r["labels"]})
    reasons = []
    if actual != exp["status"]:
        reasons.append(f"판정 {actual} (기대 {exp['status']})")
    if exp.get("labels_any") and not set(exp["labels_any"]) & set(labels):
        reasons.append(f"라벨 {labels or '없음'} (기대 {exp['labels_any']})")
    if exp["status"] == "ok" and actual == "ok" and not p.get("evidence"):
        reasons.append("근거(evidence) 없음")
    if exp.get("tool_error") and not any(r["status"] == "ERROR" for r in rows):
        reasons.append("도구 오류가 결과에 표시되지 않음")
    if exp.get("limitation_note") and "근거 제한" not in p.get("summary", ""):
        reasons.append("리포트에 근거 제한 문구 없음")
    detections = [{"source": e["payload"]["tool"], "defects": [(d["type"], round(d["confidence"], 2))
                   for d in e["payload"]["output"].get("defects", [])]}
                  for e in events if e["eventType"] == "TOOL_EXECUTED"
                  and e["payload"]["output"].get("defects") is not None]
    return {"actual": actual, "labels": labels, "pass": not reasons, "reasons": reasons,
            "errorCode": p.get("errorCode"), "summary": (p.get("summary") or p.get("description") or "")[:600],
            "topCause": p.get("topCause"), "evidence": len(p.get("evidence", [])), "detections": detections}


async def run_case(case, journal):
    cmd, local = build(case)
    output = LocalOutput()
    started = time.monotonic()
    with ExitStack() as stack:
        stack.enter_context(patch.object(tools, "load_photos", return_value=local))
        if case.get("fault"):
            stack.enter_context(patch.object(C, case["fault"], DOWN[case["fault"]]))
        result = await main.handle(cmd, output, journal)
    seconds = round(time.monotonic() - started, 1)
    row = journal.db.execute("SELECT metrics FROM executions WHERE event_id=?", (cmd["eventId"],)).fetchone()
    metrics = json.loads(row[0]) if row and row[0] else {}
    llm = metrics.get("llm", {})
    return {"id": case["id"], "type": case["type"], "expected": case["expect"]["status"], "seconds": seconds,
            "llm_calls": llm.get("calls"), "tokens": llm.get("actual_usage"), "retries": metrics.get("retries"),
            "prompts": metrics.get("prompts"), **grade(case, result, output.events)}


def write_summary(out, label, spec, rows):
    passed = sum(r["pass"] for r in rows)
    secs = sorted(r["seconds"] for r in rows)
    p95 = secs[min(len(secs) - 1, int(round(0.95 * len(secs))) - 1)] if secs else 0
    normal = [r for r in rows if r["type"] == "정상 사진"]
    lines = [f"# 평가 결과: {label}", "",
             f"- 평가셋 {spec['version']} · {len(rows)}건 · 모델 {C.GPT_MODEL} · 워커 {C.MODEL_VERSION}",
             f"- **충족 {passed} / {len(rows)} ({passed / len(rows) * 100:.0f}%)**",
             f"- 정상 사진 오탐: {sum(r['actual'] == 'ok' for r in normal)} / {len(normal)}",
             f"- 응답 시간 p95: {p95}초 (최대 {secs[-1] if secs else 0}초)", "",
             "| ID | 유형 | 기대 | 실제 | 검출 라벨 | 충족 | 사유 | 초 |", "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['id']} | {r['type']} | {r['expected']} | {r['actual']} | {', '.join(r['labels']) or '-'} | "
                     f"{'충족' if r['pass'] else '미충족'} | {'; '.join(r['reasons']) or '-'} | {r['seconds']} |")
    (out / "summary.md").write_text("\n".join(lines) + "\n")


async def run(label, only):
    if not C.USE_GPT:
        raise RuntimeError("OPENAI_API_KEY가 필요합니다 (레포 맨 위 .env)")
    # 평가용 서버 주소. 다른 세션이 기본 포트를 쓰고 있어도 겹치지 않게 run_all.sh가 넘긴다 (.env 값보다 우선)
    for name in ("MECH_MCP_URL", "RAG_MCP_URL", "OBSERVATION_MCP_URL", "PCB_INTERPRET_MCP_URL", "DAMAGE_MCP_URL"):
        if os.getenv("EVAL_" + name):
            setattr(C, name, os.environ["EVAL_" + name])
    if os.getenv("DEMO_FORCE_PHOTO") == "1":  # 시연용 강제 사진 요청이 켜져 있으면 판정이 무의미하다
        raise RuntimeError("DEMO_FORCE_PHOTO=1 상태에서는 평가하지 않습니다")
    spec = json.loads((HERE / "cases.json").read_text())
    cases = [c for c in spec["cases"] if not only or c["id"] in only]
    out = HERE / "results" / label
    out.mkdir(parents=True, exist_ok=True)
    journal = Journal(out / "journal.sqlite3")
    rows = []
    try:
        for case in cases:
            try:
                row = await run_case(case, journal)
            except Exception as exc:  # 한 건이 터져도 나머지는 계속 잰다
                row = {"id": case["id"], "type": case["type"], "expected": case["expect"]["status"],
                       "actual": "crash", "labels": [], "pass": False, "seconds": 0,
                       "reasons": [f"실행 오류 {type(exc).__name__}: {str(exc)[:200]}"]}
            rows.append(row)
            print(f"{row['id']} {row['actual']:12} {'충족' if row['pass'] else '미충족'} {row['seconds']}s "
                  f"{'; '.join(row['reasons'])}", flush=True)
            (out / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    finally:
        journal.close()
    write_summary(out, label, spec, rows)
    print((out / "summary.md").read_text())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", default="baseline")
    parser.add_argument("--only", nargs="*", help="일부만: --only A1 C3")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    asyncio.run(run(args.label, args.only))
