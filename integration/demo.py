"""통합 시연: 기사 로그인 → 사진 2장(PCB·기계)으로 접수 → Spring → Kafka → 에이전트 → Spring → 진단 결과 조회."""
import argparse, http.cookiejar, json, os, sys, time, urllib.parse, urllib.request, urllib.error, uuid
from pathlib import Path

BASE = os.environ.get("SPRING_URL", "http://localhost:8080")
SCENARIO = "complete"
# complete: 결함이 보이는 사진 2장 → 바로 진단 완료
# photo:    결함이 안 보이는 기계 사진 1장 → 추가 사진 요청 → auto_photo.py가 지정 사진 제출 → 재개 → 완료
SOURCE = Path(__file__).parent.parent / "source"  # [통합] 제출용 정리: 사진을 source/로 옮김
SCENARIOS = {"complete": [("PCB", SOURCE / "01_pcb.jpg"), ("MOTOR", SOURCE / "09_mech_extra.jpg")],
          "photo": [("MOTOR", SOURCE / "32_mech_photo_request.jpg")]}
PHOTOS = SCENARIOS[SCENARIO]


class Client:
    def __init__(self, user):
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.token = self.call("GET", "/api/auth/csrf")["token"]
        self.call("POST", "/api/auth/login", urllib.parse.urlencode({"username": user, "password": os.environ.get("LOGIN_PASSWORD", "1234")}).encode(),
                  "application/x-www-form-urlencoded")
        self.token = self.call("GET", "/api/auth/csrf")["token"]

    def call(self, method, path, data=None, ctype="application/json", extra=None):
        headers = {"Content-Type": ctype, **(extra or {})}
        if method != "GET":
            headers["X-CSRF-TOKEN"] = self.token
        if data is not None and not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode()
        with self.http.open(urllib.request.Request(BASE + path, data=data, method=method, headers=headers), timeout=30) as r:
            return json.load(r)


def intake(c, symptoms=None, technician_note=None):
    b = "b-" + uuid.uuid4().hex
    data = {"productId": "1", "symptoms": "충전이 안 되고 바퀴 모터에서 소음", "errorCodes": ["E05"], "firmware": "1.2",
            "userInput": {"technicianNote": "펌웨어 업데이트 후부터 그렇다고 함"}}
    if symptoms is not None:
        data['symptoms'] = symptoms
    if technician_note is not None:
        data['userInput']['technicianNote'] = technician_note
    parts = [f'--{b}\r\nContent-Disposition: form-data; name="data"\r\nContent-Type: application/json\r\n\r\n'.encode(),
             json.dumps(data, ensure_ascii=False).encode(), b"\r\n"]
    for target, path in PHOTOS:
        parts += [f'--{b}\r\nContent-Disposition: form-data; name="files"; filename="{path.name}"\r\nContent-Type: image/jpeg\r\n\r\n'.encode(),
                  path.read_bytes(), b"\r\n"]
    query = "?" + "&".join(f"targets={t}" for t, _ in PHOTOS)
    parts.append(f"--{b}--\r\n".encode())
    return c.call("POST", "/api/repairs" + query, b"".join(parts), "multipart/form-data; boundary=" + b)


def ensure_diagnosis(c, repair, accept_warnings=False, timeout=120):
    """품질검사 완료와 명시적 사진 선택 뒤 진단을 시작. 기존 작업은 재사용한다."""
    try:
        return c.call("GET", f"/api/repairs/{repair}/diagnosis")
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise
    detail = c.call("GET", f"/api/repairs/{repair}")
    attachments = [a for a in detail.get("attachments", [])
                   if a.get("request_id") is None and a.get("use_status", "AVAILABLE") == "AVAILABLE"]
    if not attachments:
        raise RuntimeError("진단할 초기 사진이 없습니다.")
    deadline = time.monotonic() + timeout
    for attachment in attachments:
        aid = attachment["id"]
        while True:
            quality = c.call("GET", f"/api/attachments/{aid}/quality")
            if not quality.get("enabled") or not quality.get("required"):
                break
            latest = quality.get("latest") or {}
            status = latest.get("status", quality.get("status"))
            if status in ("PENDING", "RUNNING") or not latest:
                if time.monotonic() >= deadline:
                    raise RuntimeError(f"사진 {aid}: 품질검사 대기 시간 초과. --repair-id {repair}로 재실행하세요.")
                time.sleep(1)
                continue
            if status != "COMPLETED":
                raise RuntimeError(f"사진 {aid}: 품질검사 {status}. 화면에서 검사 결과를 확인하세요.")
            print(f"사진 {aid}: 품질검사 {latest.get('verdict')} {latest.get('issues', [])}", flush=True)
            if latest.get("verdict") == "WARNING" and not latest.get("confirmedByCurrentUser"):
                if not accept_warnings:
                    raise RuntimeError(f"사진 {aid}: 품질 경고 확인 필요. 화면에서 확인하거나 테스트 사진을 그대로 쓰려면 --repair-id {repair} --accept-quality-warnings로 재실행하세요.")
                c.call("POST", f"/api/attachments/{aid}/quality/acknowledgment", {"resultId": int(latest["id"])})
            break
    started = c.call("POST", f"/api/repairs/{repair}/diagnosis", {"attachmentIds": [int(a["id"]) for a in attachments]},
                     extra={"Idempotency-Key": str(uuid.uuid4())})
    print(f"진단 시작: repairId={repair} taskId={started.get('taskId')} status={started.get('status')}", flush=True)
    return started


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", nargs="?", choices=SCENARIOS, default="complete")
    parser.add_argument("--repair-id", type=int, help="새 접수 없이 기존 접수로 진행")
    parser.add_argument("--accept-quality-warnings", action="store_true", help="사진 품질 경고를 확인하고 해당 사진을 사용")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    global PHOTOS
    PHOTOS = SCENARIOS[args.scenario]
    c = Client("tech1")
    if args.repair_id:
        repair = args.repair_id
        print(f"기존 접수 사용: repairId={repair}", flush=True)
    else:
        created = intake(c)
        repair = created["repairId"]
        print(f"접수 완료: repairId={repair} taskId={created.get('taskId')} status={created['status']}", flush=True)
    ensure_diagnosis(c, repair, args.accept_quality_warnings)
    deadline, last = time.monotonic() + args.timeout, None
    while time.monotonic() < deadline:
        d = c.call("GET", f"/api/repairs/{repair}/diagnosis")
        if (d["status"], d.get("stage")) != last:
            print(f"  상태 {d['status']:14} stage={d.get('stage')}")
            last = (d["status"], d.get("stage"))
        if d["status"] in ("SUCCEEDED", "FAILED"):
            break
        time.sleep(2)
    print("\n== 진단 결과 (GET /api/repairs/{id}/diagnosis) ==")
    r = d.get("result") or {}
    print(json.dumps({k: r.get(k) for k in ("summary", "topCause", "urgency", "candidates", "agents", "similarCases",
                                             "inspectionSteps", "repairSteps", "sources")}, ensure_ascii=False, indent=2)[:6000])
    print("사진 요청 횟수:", d.get("photo_request_count"))
    tools = c.call("GET", f"/api/repairs/{repair}/diagnosis/tools")
    print("\n== 도구 실행 이력 ==")
    for t in tools:
        print(" -", t.get("agent_type"), t.get("mcp_server"), t.get("tool_name"), t.get("status"))
    detail = c.call("GET", f"/api/repairs/{repair}")
    print("\n접수 상태:", detail.get("status"), "/ 조달:", detail.get("procurement_status") or detail.get("procurementStatus"))
    sys.exit(0 if d["status"] == "SUCCEEDED" else 1)


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as exc:
        print(f"API 오류: HTTP {exc.code}: {exc.read().decode(errors='replace')[:1000]}", file=sys.stderr)
        sys.exit(1)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
