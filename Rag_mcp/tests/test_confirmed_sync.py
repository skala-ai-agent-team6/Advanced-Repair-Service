import asyncio
import json

import httpx
import numpy as np
import pytest
from fastmcp import Client
from qdrant_client import QdrantClient

from repair_mcp.retrieval import DenseStore, brief_cases, retrieve_context
from repair_mcp.models import SearchRequest
from repair_mcp.servers import create_server
from repair_mcp.sync import ConfirmedCaseSync, report_document


class Tokenizer:
    def encode(self, text, **kwargs):
        return list(text.encode())

    def decode(self, tokens, **kwargs):
        return bytes(tokens).decode(errors="replace")


class Encoder:
    tokenizer = Tokenizer()

    def __init__(self):
        self.calls = 0

    def encode(self, texts, **kwargs):
        self.calls += 1
        return np.array([[1., 0.] if "motor" in text else [0., 1.] for text in texts])


def report(report_id=42, revision=1, text="motor contact", outcome="FIXED"):
    return {"product_type": "vacuum", "report_id": report_id, "case_id": report_id + 100,
            "confirmed_revision": revision, "confirmed_at": "2026-10-22T00:00:00Z",
            "content": {"actualCause": text, "actualAction": "contact repaired",
                        "technicianOpinion": text, "repairSuccessful": outcome == "FIXED",
                        "outcome": outcome, "authorEmail": "must-not-copy@example.org"}}


def store_at(path=":memory:"):
    return DenseStore(client=QdrantClient(path=path) if path != ":memory:" else QdrantClient(":memory:"),
                      encoder=Encoder())


def public_index(store):
    store.documents = {"repair_cases": [
        {"document_id": "dustup:public1", "text": "filter blocked", "original_text": "filter blocked",
         "product_type": "vacuum", "source_repair_status": "Fixed", "source_type": "external_community_repair_record"}],
        "pcb_documents": [], "damage_documents": []}
    store.index()


def source(rows, status=200):
    def handle(request):
        assert request.url.path == "/internal/confirmed-cases"
        assert request.headers["Authorization"] == "Bearer test-internal-token"
        page, size = int(request.url.params["page"]), int(request.url.params["size"])
        return httpx.Response(status, json=rows[page * size:(page + 1) * size])
    return httpx.Client(transport=httpx.MockTransport(handle))


def synchronizer(store, rows, **kwargs):
    return ConfirmedCaseSync(store, "http://spring.test", "test-internal-token", client=source(rows), **kwargs)


def test_document_preserves_outcome_and_does_not_invent_intake_or_models():
    raw = report(outcome="NOT_FIXED")
    raw["content"]["technicianOpinion"] = "멈춤. 연락 010-1234-5678 a@example.com"
    doc = report_document(raw)
    assert doc["source_repair_status"] == "Not fixed"
    assert doc["source_document_confirmed"]
    assert doc["model_code"] is None
    assert "reported_symptom_ko" not in doc and "pcb_labels" not in doc
    assert "010-1234-5678" not in json.dumps(doc, ensure_ascii=False)
    assert "a@example.com" not in json.dumps(doc)
    assert "authorEmail" not in doc
    assert report_document(report(outcome="NO_FAULT_FOUND"))["source_repair_status"] == "No fault found"
    inconsistent = report(outcome="NOT_FIXED")
    inconsistent["content"]["repairSuccessful"] = True
    with pytest.raises(ValueError):
        report_document(inconsistent)


def test_nested_public_summary_can_be_displayed_alongside_internal_case():
    briefs = brief_cases([{"document_id": "dustup:curated", "source_type": "external_community_repair_record",
                           "korean_summary": {"reported_symptom_ko": "전원 불량", "reported_action_ko": "접점 수리"}},
                          report_document(report())])
    assert briefs[0]["summary"] == "전원 불량; 접점 수리"
    assert briefs[0]["source_label"] == "공개 사례"
    assert briefs[1]["source_label"] == "사내 확정 사례"


def test_pagination_dedup_revisions_and_failure_outcomes():
    store = store_at()
    rows = [report(), report(43, outcome="NOT_FIXED"), report(44, outcome="NO_FAULT_FOUND")]
    sync = synchronizer(store, rows, page_size=2)
    try:
        result = sync.sync_once()
        assert result["added"] == 3 and result["status"] == "completed"
        calls = store.encoder.calls
        assert sync.sync_once()["unchanged"] == 3
        assert store.encoder.calls == calls  # No repeated embeddings.
        assert store.internal_case_count() == 3
        rows[0] = report(revision=2, text="filter dirty")
        assert sync.sync_once()["updated"] == 1
        rows[0] = report(revision=1)
        assert sync.sync_once()["stale"] == 1
        rows[0] = report(revision=2, text="conflicting text")
        assert sync.sync_once()["failed"] == 1
        assert store.internal_case_count() == 3
    finally:
        sync._client.close()
        store.close()


def test_restart_and_public_corpus_change_preserve_internal_reports(tmp_path, monkeypatch):
    path = str(tmp_path / "qdrant")
    store = store_at(path)
    store.upsert_confirmed_case(report_document(report()))
    name = store.internal_collection
    old_public_names = store.names
    store.close()
    monkeypatch.setattr("repair_mcp.retrieval.load_documents", lambda: {"repair_cases": [], "pcb_documents": [], "damage_documents": []})
    reopened = store_at(path)
    try:
        assert reopened.names != old_public_names
        assert reopened.internal_collection == name
        assert reopened.internal_case_count() == 1
        assert reopened.upsert_confirmed_case(report_document(report())) == "unchanged"
        assert reopened.encoder.calls == 0
        public_index(reopened)
        assert reopened.search("repair_cases", "motor", product_type="vacuum", min_score=.9)[0]["document_id"] == "internal:report:42"
        assert reopened.upsert_confirmed_case(report_document(report(revision=2, text="filter"))) == "updated"
        assert reopened.search("repair_cases", "motor", product_type="vacuum", min_score=.9) == []
        assert reopened.internal_case_count() == 1
    finally:
        reopened.close()


def test_unconfirmed_invalid_and_auth_error_do_not_delete_existing():
    store = store_at()
    store.upsert_confirmed_case(report_document(report()))
    draft = report(55)
    draft["confirmed_at"] = None
    sync = synchronizer(store, [draft])
    try:
        assert sync.sync_once()["failed"] == 1
        assert store.internal_case_count() == 1
        with source([], status=401) as client:
            denied = ConfirmedCaseSync(store, "http://spring.test", "test-internal-token", client=client)
            result = denied.sync_once()
            assert result["error_code"] == "SPRING_HTTP_401"
            assert "test-internal-token" not in json.dumps(denied.status())
        assert store.internal_case_count() == 1
    finally:
        sync._client.close()
        store.close()


def test_failed_write_retries_without_advancing_revision(monkeypatch):
    store = store_at()
    store.upsert_confirmed_case(report_document(report()))
    rows = [report(revision=2, text="filter")]
    sync = synchronizer(store, rows)
    original = store.client.upsert
    def fail(*args, **kwargs):
        raise RuntimeError("private details must not be logged")
    monkeypatch.setattr(store.client, "upsert", fail)
    try:
        result = sync.sync_once()
        assert result["status"] == "error" and result["updated"] == 0
        assert "private details" not in json.dumps(result)
        monkeypatch.setattr(store.client, "upsert", original)
        assert sync.sync_once()["updated"] == 1
        assert sync.sync_once()["unchanged"] == 1
    finally:
        sync._client.close()
        store.close()


def test_both_sources_and_internal_outcomes_reach_existing_rag(monkeypatch):
    store = store_at()
    public_index(store)
    store.upsert_confirmed_case(report_document(report()))
    store.upsert_confirmed_case(report_document(report(43, outcome="NOT_FIXED")))
    monkeypatch.setattr("repair_mcp.retrieval.normalize_observations",
                        lambda text, *args: {"raw_text": text, "observations": []})
    received = []
    def opinion(observation, pcb, damage, cases, guidance):
        received.extend(cases)
        return {"text": "접점을 점검합니다.", "supporting_case_ids": [cases[0]["document_id"]],
                "engine": "test-stub", "model": "test"}
    monkeypatch.setattr("repair_mcp.retrieval.generate_final_opinion", opinion)
    try:
        result = retrieve_context(SearchRequest(product_type="vacuum", raw_text="motor", min_score=-1), store)
        assert {c["source_label"] for c in result["case_briefs"]} == {"공개 사례", "사내 확정 사례"}
        assert len(received) == 3
        assert result["diagnosis_confirmed"] is False
        assert all(not case["diagnosis_confirmed"] for case in received)
        fixed = store.search("repair_cases", "motor", product_type="vacuum", min_score=.9, repair_status="Fixed")
        assert [c["document_id"] for c in fixed] == ["internal:report:42"]
    finally:
        store.close()


async def test_mcp_periodic_sync_immediate_sync_and_shutdown():
    store = store_at()
    public_index(store)
    rows = []
    sync = synchronizer(store, rows, interval=1)
    try:
        async with Client(create_server("rag", store, sync)) as client:
            tools = {tool.name: tool for tool in await client.list_tools()}
            assert tools["sync_confirmed_cases"].annotations.readOnlyHint is False
            assert tools["search_repair_cases"].annotations.readOnlyHint is True
            rows.append(report())
            for _ in range(50):
                status = (await client.call_tool("get_case_sync_status", {})).data
                if status["indexed_reports"] == 1 and not status["running"]:
                    break
                await asyncio.sleep(.05)
            assert status["indexed_reports"] == 1
            rows[0] = report(revision=2)
            result = (await client.call_tool("sync_confirmed_cases", {})).data
            assert result["updated"] == 1
            found = (await client.call_tool("search_repair_cases", {"query": "motor", "min_score": .9, "product_type": "vacuum"})).data
            assert found["case_briefs"][0]["source_label"] == "사내 확정 사례"
        assert sync._thread is None
    finally:
        sync.stop()
        sync._client.close()
        store.close()


async def test_sync_is_opt_in(monkeypatch):
    monkeypatch.delenv("REPAIR_SYNC_ENABLED", raising=False)
    store = store_at()
    try:
        async with Client(create_server("rag", store)) as client:
            assert "sync_confirmed_cases" not in {tool.name for tool in await client.list_tools()}
            assert (await client.call_tool("get_case_sync_status", {})).data["enabled"] is False
    finally:
        store.close()
