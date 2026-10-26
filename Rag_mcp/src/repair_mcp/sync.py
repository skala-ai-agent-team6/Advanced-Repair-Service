"""Poll Spring's confirmed reports. Never modify Spring or accept report text from a tool caller."""
import logging
import os
import re
import threading
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, PositiveInt, StrictBool, ValidationError

from .products import ProductType, PRODUCT_NAMES

logger = logging.getLogger(__name__)


class ReportContent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    actualCause: str = Field(min_length=1, max_length=10000)
    actualAction: str = Field(min_length=1, max_length=10000)
    technicianOpinion: str = Field(default="", max_length=10000)
    repairSuccessful: StrictBool
    outcome: Literal["FIXED", "NOT_FIXED", "NO_FAULT_FOUND"] | None = None


class ConfirmedReport(BaseModel):
    model_config = ConfigDict(extra="ignore")
    product_type: ProductType = "unknown"
    report_id: PositiveInt
    case_id: PositiveInt
    confirmed_revision: PositiveInt
    confirmed_at: datetime
    content: ReportContent


def clean_text(value):
    """Basic email/phone redaction. Other personal details must be omitted by the author/API."""
    value = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[이메일 제외]", value)
    value = re.sub(r"(?<!\d)(?:\+82[- .]?|0)(?:1[016789]|2|[3-6]\d)[- .]?\d{3,4}[- .]?\d{4}(?!\d)",
                   "[전화번호 제외]", value)
    return " ".join(value.split())


def report_document(raw):
    report = ConfirmedReport.model_validate(raw)
    content = report.content
    outcome = content.outcome or ("FIXED" if content.repairSuccessful else "NOT_FIXED")
    if ((outcome == "FIXED" and not content.repairSuccessful)
            or (outcome == "NOT_FIXED" and content.repairSuccessful)):
        raise ValueError("OUTCOME_SUCCESS_MISMATCH")
    cause, action, opinion = map(clean_text, (
        content.actualCause, content.actualAction, content.technicianOpinion))
    if not cause or not action:
        raise ValueError("EMPTY_REPORT")
    outcome_ko = {"FIXED": "수리 완료", "NOT_FIXED": "수리 미완료", "NO_FAULT_FOUND": "고장 미발견"}[outcome]
    text = "\n".join(filter(None, [
        f"제품: {PRODUCT_NAMES[report.product_type]}", f"기사 소견: {opinion}" if opinion else "",
        f"기사 확정 보고 원인: {cause}", f"실제 조치: {action}", f"수리 결과: {outcome_ko}",
    ]))
    return {
        "document_id": f"internal:report:{report.report_id}",
        "collection": "internal_confirmed_repair",
        "source_type": "internal_confirmed_repair",
        "source_label": "사내 확정 사례",
        "source_document_confirmed": True,
        "report_id": report.report_id, "case_id": report.case_id,
        "report_revision": report.confirmed_revision,
        "confirmed_at": report.confirmed_at.isoformat(),
        "source_uri": f"urn:repair-report:{report.report_id}:revision:{report.confirmed_revision}",
        "product_type": report.product_type, "product_domain": report.product_type,
        "product_category": PRODUCT_NAMES[report.product_type], "model_code": None,
        # The current API has no intake symptom or model labels. Do not fabricate them.
        "reported_observations_ko": opinion,
        "confirmed_cause_ko": cause, "reported_action_ko": action,
        "outcome": outcome, "outcome_ko": outcome_ko,
        "source_repair_status": {"FIXED": "Fixed", "NOT_FIXED": "Not fixed",
                                 "NO_FAULT_FOUND": "No fault found"}[outcome],
        "korean_summary": f"{opinion + '; ' if opinion else ''}보고 원인: {cause}; {action}; {outcome_ko}",
        "original_text": text, "search_text": text, "text": text,
    }


class ConfirmedCaseSync:
    def __init__(self, store, base_url, token, interval=30, client=None, page_size=100, max_pages=100):
        parsed = urlsplit(base_url)
        if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username
                or parsed.password or parsed.query or parsed.fragment):
            raise ValueError("SPRING_BASE_URL must be an HTTP(S) service URL without credentials/query")
        if not token.strip():
            raise ValueError("INTERNAL_SERVICE_TOKEN is required when REPAIR_SYNC_ENABLED=true")
        if not 1 <= interval <= 86400:
            raise ValueError("REPAIR_SYNC_INTERVAL_SECONDS must be between 1 and 86400")
        self.store = store
        self.url = base_url.rstrip("/") + "/internal/confirmed-cases"
        self._token = token
        self.interval = interval
        self.page_size = page_size
        self.max_pages = max_pages
        self._client = client
        self._run_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._last = None
        self._stop = threading.Event()
        self._thread = None

    @classmethod
    def from_env(cls, store):
        if os.environ.get("REPAIR_SYNC_ENABLED", "false").lower() not in {"1", "true", "yes"}:
            return None
        return cls(store, os.environ.get("SPRING_BASE_URL", "http://localhost:8080"),
                   os.environ.get("INTERNAL_SERVICE_TOKEN", ""),
                   interval=float(os.environ.get("REPAIR_SYNC_INTERVAL_SECONDS", "30")))

    def status(self):
        with self._state_lock:
            last = dict(self._last) if self._last else None
        return {"enabled": True, "running": self._run_lock.locked(),
                "interval_seconds": self.interval, "last_run": last,
                "indexed_reports": self.store.internal_case_count()}

    def sync_once(self):
        if not self._run_lock.acquire(blocking=False):
            return {"status": "busy"}
        result = {"status": "completed", "added": 0, "updated": 0,
                  "unchanged": 0, "stale": 0, "failed": 0, "fetched": 0,
                  "started_at": datetime.now(timezone.utc).isoformat()}
        try:
            client = self._client or httpx.Client(timeout=10, follow_redirects=False, trust_env=False)
            try:
                # Full scans also detect revisions of old reports. Never use largest report_id as cursor.
                seen = set()
                for page in range(self.max_pages):
                    if self._stop.is_set():
                        result["status"] = "stopped"
                        break
                    response = client.get(self.url, params={"page": page, "size": self.page_size},
                                          headers={"Authorization": f"Bearer {self._token}",
                                                   "Accept": "application/json"},
                                          follow_redirects=False)
                    response.raise_for_status()
                    if len(response.content) > 8 * 1024 * 1024:
                        raise ValueError("RESPONSE_TOO_LARGE")
                    rows = response.json()
                    if not isinstance(rows, list) or len(rows) > self.page_size:
                        raise ValueError("INVALID_REPORT_PAGE")
                    for raw in rows:
                        result["fetched"] += 1
                        try:
                            doc = report_document(raw)
                            key = (doc["report_id"], doc["report_revision"])
                            if key in seen:
                                continue
                            seen.add(key)
                            action = self.store.upsert_confirmed_case(doc)
                            result[action] += 1
                        except (ValidationError, ValueError):
                            result["failed"] += 1
                            result["error_code"] = "INVALID_OR_CONFLICTING_REPORT"
                    if len(rows) < self.page_size:
                        break
                else:
                    result["status"] = "partial"
                    result["error_code"] = "PAGE_LIMIT_REACHED"
            finally:
                if self._client is None:
                    client.close()
        except httpx.HTTPStatusError as error:
            result.update(status="error", error_code=f"SPRING_HTTP_{error.response.status_code}")
        except httpx.RequestError:
            result.update(status="error", error_code="SPRING_CONNECTION_FAILED")
        except Exception:
            # Never return/log exception strings containing tokens or raw reports.
            result.update(status="error", error_code="SYNC_FAILED")
        finally:
            if result["failed"] and result["status"] == "completed":
                result["status"] = "partial"
            result["finished_at"] = datetime.now(timezone.utc).isoformat()
            with self._state_lock:
                self._last = dict(result)
            self._run_lock.release()
        return result

    def start(self):
        if self._thread is not None:
            return
        self._stop.clear()
        def run():
            while not self._stop.is_set():
                result = self.sync_once()
                logger.info("Confirmed case sync: status=%s added=%s updated=%s",
                            result["status"], result.get("added", 0), result.get("updated", 0))
                if self._stop.wait(self.interval):
                    break
        self._thread = threading.Thread(target=run, name="confirmed-case-sync", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join()
            self._thread = None
        # Drain an immediate-sync tool call before the lifespan closes Qdrant.
        with self._run_lock:
            pass
