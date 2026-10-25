"""통합 시연: 기사 로그인 → 사진 2장(PCB·기계)으로 접수 → Spring → Kafka → 에이전트 → Spring → 진단 결과 조회."""
import http.cookiejar, json, os, sys, time, urllib.parse, urllib.request, uuid
from pathlib import Path

BASE = os.environ.get("SPRING_URL", "http://localhost:8080")
SCENARIO = sys.argv[1] if len(sys.argv) > 1 and __name__ == "__main__" else "complete"
# complete: 결함이 보이는 사진 2장 → 바로 진단 완료
# photo:    결함이 안 보이는 기계 사진 1장 → 추가 사진 요청 → auto_photo.py가 지정 사진 제출 → 재개 → 완료
SOURCE = Path(__file__).parent.parent / "source"  # [통합] 제출용 정리: 사진을 source/로 옮김
PHOTOS = {"complete": [("PCB", SOURCE / "01_pcb.jpg"), ("MOTOR", SOURCE / "09_mech_extra.jpg")],
          "photo": [("MOTOR", SOURCE / "32_mech_photo_request.jpg")]}[SCENARIO]


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


def intake(c):
    b = "b-" + uuid.uuid4().hex
    data = {"productId": "1", "symptoms": "충전이 안 되고 바퀴 모터에서 소음", "errorCodes": ["E05"], "firmware": "1.2",
            "userInput": {"technicianNote": "펌웨어 업데이트 후부터 그렇다고 함"}}
    parts = [f'--{b}\r\nContent-Disposition: form-data; name="data"\r\nContent-Type: application/json\r\n\r\n'.encode(),
             json.dumps(data, ensure_ascii=False).encode(), b"\r\n"]
    for target, path in PHOTOS:
        parts += [f'--{b}\r\nContent-Disposition: form-data; name="files"; filename="{path.name}"\r\nContent-Type: image/jpeg\r\n\r\n'.encode(),
                  path.read_bytes(), b"\r\n"]
    query = "?" + "&".join(f"targets={t}" for t, _ in PHOTOS)
    parts.append(f"--{b}--\r\n".encode())
    return c.call("POST", "/api/repairs" + query, b"".join(parts), "multipart/form-data; boundary=" + b)


def start_diagnosis(c, created):
    """[통합] 사진 품질 검사 이후 접수만으로는 진단이 안 시작됨: 품질 대기 → 경고 사진 확인 → 진단 시작 (프론트 repairs.ts와 같은 순서)"""
    if not created.get("requiresDiagnosisRequest"):
        return
    ids = [a["attachmentId"] for a in created.get("attachments") or []]
    deadline = time.monotonic() + 30
    while True:
        qs = [c.call("GET", f"/api/attachments/{i}/quality") for i in ids]
        if all(q["status"] not in ("PENDING", "RUNNING") for q in qs) or time.monotonic() > deadline:
            break
        time.sleep(1)
    for i, q in zip(ids, qs):
        latest = q.get("latest") or {}
        print(f"  사진 {i} 품질 {q['status']} {latest.get('verdict')}")
        if latest.get("verdict") == "WARNING":
            c.call("POST", f"/api/attachments/{i}/quality/acknowledgment", {"resultId": int(latest["id"])})
    c.call("POST", f"/api/repairs/{created['repairId']}/diagnosis", {"attachmentIds": [int(i) for i in ids]},
           extra={"Idempotency-Key": str(uuid.uuid4())})


def main():
    c = Client("tech1")
    created = intake(c)
    repair = created["repairId"]
    print(f"접수 완료: repairId={repair} taskId={created['taskId']} status={created['status']}")
    start_diagnosis(c, created)
    deadline, last = time.monotonic() + 240, None
    while time.monotonic() < deadline:
        d = c.call("GET", f"/api/repairs/{repair}/diagnosis")
        if d.get("stage") != last or d["status"] != "RUNNING":
            print(f"  상태 {d['status']:14} stage={d.get('stage')}")
            last = d.get("stage")
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
    main()
