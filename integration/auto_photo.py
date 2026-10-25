"""프론트 대역: 추가 사진 요청(WAITING_INPUT)에 지정 사진을 자동으로 올리고 진단을 재개한다.

프론트에 추가 사진 화면이 생기기 전까지 쓰는 임시 장치. 실제 프론트와 같은 Spring API를 쓴다.
  1) GET  /api/repairs?status=WAITING_INPUT
  2) POST /api/repairs/{id}/attachments?requestId=..&target=PCB|MOTOR   (지정 사진 업로드)
  3) POST /api/repairs/{id}/diagnosis/resume  {requestId, submissionKey, attachmentIds}

실행: python3 integration/auto_photo.py  (Ctrl+C로 종료, 로그인 비밀번호는 LOGIN_PASSWORD, 기본 1234)
요청 후 AUTO_PHOTO_GRACE초(기본 60) 동안은 기다린다. 그 안에 프론트에서 올리면 대역은 넘어간다.
지정 사진: source/01_pcb.jpg(PCB), source/09_mech_extra.jpg(기계)  (GENERAL 요청이면 둘 다 올린다)
"""
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from demo import Client, BASE  # 같은 폴더의 로그인·호출 도우미

# [통합] 제출용 정리: 사진을 레포 맨 위 source/로 옮김
SOURCE = Path(__file__).parent.parent / "source"
DESIGNATED = {"PCB": SOURCE / "01_pcb.jpg", "MOTOR": SOURCE / "09_mech_extra.jpg"}
GRACE = int(os.environ.get("AUTO_PHOTO_GRACE", "60"))  # 이 시간(초) 안에 프론트에서 사람이 올리면 대역은 손대지 않는다


def upload(c, repair, request_id, target):
    path = DESIGNATED[target]
    b = "b-" + uuid.uuid4().hex
    body = b"".join([f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\nContent-Type: image/jpeg\r\n\r\n'.encode(),
                     path.read_bytes(), f"\r\n--{b}--\r\n".encode()])
    out = c.call("POST", f"/api/repairs/{repair}/attachments?requestId={request_id}&target={target}", body,
                 "multipart/form-data; boundary=" + b)
    return str(out["attachmentId"])


def confirm_quality(c, ids, timeout=60):
    """[사진 품질] 검사가 끝날 때까지 기다리고 경고 사진은 확인 처리한다. 안 하면 재개가 409로 거절된다."""
    deadline = time.monotonic() + timeout
    for a in ids:
        while True:
            q = c.call("GET", f"/api/attachments/{a}/quality")
            if q.get("status") not in ("PENDING", "RUNNING") or time.monotonic() > deadline:
                break
            time.sleep(1)
        latest = q.get("latest") or {}
        if latest.get("verdict") == "WARNING":
            c.call("POST", f"/api/attachments/{a}/quality/acknowledgment", {"resultId": int(latest["id"])})


def answer(c, repair):
    detail = c.call("GET", f"/api/repairs/{repair}")
    now = datetime.now(timezone.utc)
    for req in [r for r in detail.get("photoRequests", []) if r.get("submitted_at") is None]:
        if (now - datetime.fromisoformat(req["created_at"].replace("Z", "+00:00"))).total_seconds() < GRACE:
            continue
        # 에이전트가 부위 이름(wheel 등)으로 요청할 수 있다. PCB 외 부위는 기계 사진으로, GENERAL은 둘 다
        t = req["target"]
        targets = ["PCB", "MOTOR"] if t == "GENERAL" else ["PCB"] if t == "PCB" else ["MOTOR"]
        ids = [upload(c, repair, req["id"], t) for t in targets]
        confirm_quality(c, ids)
        c.call("POST", f"/api/repairs/{repair}/diagnosis/resume",
               {"requestId": req["id"], "submissionKey": str(uuid.uuid4()), "attachmentIds": ids})
        print(f"[대역] 접수 {repair} · {req['round_no']}차 요청({req['target']}) → 지정 사진 {targets} 제출, 재개", flush=True)


def watch(interval=2):
    c = Client("tech1")
    print(f"[대역] 추가 사진 요청 감시 시작 ({BASE})", flush=True)
    while True:
        page = c.call("GET", "/api/repairs?status=WAITING_INPUT&size=50")
        for row in page.get("items") or page.get("content") or []:
            try:
                answer(c, row["id"])
            except Exception as e:  # 한 건 실패로 감시 전체가 죽지 않게
                print(f"[대역] 접수 {row['id']} 처리 실패: {e}", flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    watch()
