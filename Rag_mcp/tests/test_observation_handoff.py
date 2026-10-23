"""Observation -> RAG contract; mocked SDK transport, no paid API calls."""
import pytest
from fastmcp import Client
from pydantic import ValidationError

from repair_mcp.models import SearchRequest
from repair_mcp.retrieval import prepare_query
from repair_mcp.servers import create_server
from test_mcp import EmptyStore
from test_normalize_openai import fake_openai, observation


async def test_normalize_once_then_rag_reuses_exact_response(fake_openai, monkeypatch):
    text = "필터는 막히지 않았어요. 흡입구에 먼지가 많은 것 같아요"
    requests = fake_openai({"observations": [
        observation("FILTER_BLOCKED", "필터는 막히지 않았어요", polarity="absent", certainty="reported"),
        observation(),
    ], "unmapped_fragments": []})
    opinions = []
    def opinion(obs, *args):
        opinions.append(obs)
        return {"text": "흡입구와 회로 패턴을 점검합니다.", "supporting_case_ids": [], "engine": "test", "model": "test"}
    monkeypatch.setattr("repair_mcp.retrieval.generate_final_opinion", opinion)
    async with Client(create_server("observation")) as client:
        normalized = (await client.call_tool("normalize_observation", {
            "raw_text": text, "product_type": "vacuum", "technician_confirmed": True})).data
    async with Client(create_server("rag", EmptyStore())) as client:
        result = (await client.call_tool("retrieve_repair_context", {"request": {
            "raw_text": text, "product_type": "vacuum", "technician_confirmed": True,
            "normalized_observation": normalized, "error_codes": ["E01"],
            "pcb_labels": ["mouse_bite"], "damage_labels": ["crazing"],
        }})).data
    assert len(requests) == 1
    assert result["observation"] == normalized
    assert opinions[0] == {**normalized, "error_codes": ["E01"]}
    assert len(opinions) == 1
    assert "suspected: dust accumulation at suction inlet" in result["query"]
    assert "not observed: blocked filter" in result["query"]
    assert "reported: blocked filter" not in result["query"]
    assert "에러코드 E01" in result["query"]
    assert result["pcb_guidance"][0]["label"] == "mouse_bite"
    assert result["damage_guidance"][0]["label"] == "crazing"


@pytest.fixture
def normalized():
    return {"raw_text": "처음 보는 현상", "product_type": "washing_machine", "origin": "technician",
            "technician_confirmed": True, "engine": "openai-structured-output-v1", "model": "test",
            "observations": [], "unmapped_fragments": ["처음 보는 현상"], "diagnosis_confirmed": False}


def test_empty_success_is_not_missing_or_reextracted(normalized, monkeypatch):
    monkeypatch.setattr("repair_mcp.normalize.OpenAI", lambda **kw: pytest.fail("RAG must not extract"))
    query, obs, *_ = prepare_query(SearchRequest(**{k: normalized[k] for k in (
        "raw_text", "product_type", "origin", "technician_confirmed")}, normalized_observation=normalized))
    assert obs == normalized and query == normalized["raw_text"]
    assert obs["engine"] == "openai-structured-output-v1"


@pytest.mark.parametrize("change", [
    {"raw_text": "다른 접수"}, {"product_type": "vacuum"}, {"origin": "ai_image"},
    {"technician_confirmed": False}, {"unmapped_fragments": ["없는 근거"]},
    {"diagnosis_confirmed": True}, {"error": "failed"},
])
def test_invalid_handoff_rejected_without_api(normalized, change, monkeypatch):
    monkeypatch.setattr("repair_mcp.normalize.OpenAI", lambda **kw: pytest.fail("No automatic repair of invalid results"))
    with pytest.raises(ValidationError):
        SearchRequest(raw_text=normalized["raw_text"], product_type=normalized["product_type"],
                      technician_confirmed=True, normalized_observation={**normalized, **change})


@pytest.mark.parametrize("term", [
    {"code": "INVENTED", "label_ko": "가짜", "search_hint_en": "fake", "evidence_text": "처음 보는 현상"},
    {"code": "POWER_NO_START", "label_ko": "임의 변조", "search_hint_en": "fake", "evidence_text": "처음 보는 현상"},
])
def test_unregistered_or_changed_terms_rejected(normalized, term):
    with pytest.raises(ValidationError):
        SearchRequest(raw_text=normalized["raw_text"], product_type=normalized["product_type"], technician_confirmed=True,
                      normalized_observation={**normalized, "observations": [{**term, "polarity": "present", "certainty": "reported"}]})


def test_missing_observation_searches_remaining_inputs_without_api(monkeypatch):
    monkeypatch.setattr("repair_mcp.normalize.OpenAI", lambda **kw: pytest.fail("RAG must not extract"))
    query, obs, pcb, damage, warnings = prepare_query(SearchRequest(
        raw_text="전원이 켜지지 않아요", product_type="vacuum", pcb_labels=None, damage_labels=["crazing"]))
    assert obs["engine"] == "raw_text_only" and obs["observations"] == []
    assert obs["unmapped_fragments"] == ["전원이 켜지지 않아요"]
    assert "전원이 켜지지 않아요" in query and "crazing" in query
    assert pcb["input_state"] == "result_unavailable"
    assert damage["input_state"] == "labels_received"
    assert any("재변환하지 않았습니다" in warning for warning in warnings)
