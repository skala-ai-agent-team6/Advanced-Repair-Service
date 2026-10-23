"""Product isolation with real Qdrant filters; LLM/embedding outputs are test doubles."""
import copy
import json

import pytest
from fastmcp import Client
from pydantic import ValidationError

from repair_mcp.models import SearchRequest, AgentCase
from repair_mcp.normalize import normalize_observations
from repair_mcp.opinion import FinalOpinion, generate_final_opinion
from repair_mcp.retrieval import retrieve_context
from repair_mcp.servers import create_server
from repair_mcp.sync import report_document
from test_confirmed_sync import report, store_at, public_index, synchronizer
from test_normalize_openai import fake_openai
from test_opinion_openai import install_fake_client, sample_evidence

TYPES = ['vacuum', 'washing_machine', 'air_conditioner']


def appliance_report(kind, report_id=42):
    return {**report(report_id), 'product_type': kind}


def test_public_and_internal_cases_never_cross_products(tmp_path):
    path = str(tmp_path / 'qdrant')
    store = store_at(path)
    public_index(store)
    try:
        for number, kind in enumerate(TYPES, 101):
            store.upsert_confirmed_case(report_document(appliance_report(kind, number)))
        # All records score identically for this embedding; only metadata can separate them.
        for kind in TYPES:
            results = store.search('repair_cases', 'motor', min_score=-1, product_type=kind)
            assert results and {r['product_type'] for r in results} == {kind}
            assert len(results) == (2 if kind == 'vacuum' else 1)
        assert store.search('repair_cases', 'motor', min_score=-1) == []
    finally:
        store.close()
    reopened = store_at(path)
    try:
        results = reopened.search('repair_cases', 'motor', product_type='air_conditioner')
        assert [r['document_id'] for r in results] == ['internal:report:103']
    finally:
        reopened.close()


def test_unknown_reports_and_missing_categories_are_not_inferred():
    raw = report()
    del raw['product_type']
    doc = report_document(raw)
    assert doc['product_type'] == 'unknown'
    assert '청소기' not in doc['text']
    store = store_at()
    public_index(store)
    try:
        store.upsert_confirmed_case(doc)
        assert store.search('repair_cases', 'motor', product_type='washing_machine') == []
        known = report_document({**raw, 'product_type': 'washing_machine'})
        assert store.upsert_confirmed_case(known) == 'updated'
        assert store.upsert_confirmed_case(known) == 'unchanged'
        changed = copy.deepcopy(known)
        changed['confirmed_cause_ko'] = 'changed source facts'
        with pytest.raises(ValueError, match='CONFIRMED_REVISION'):
            store.upsert_confirmed_case(changed)
    finally:
        store.close()


def test_legacy_report_metadata_upgrades_without_duplicate_or_source_edit():
    store = store_at()
    doc = report_document(appliance_report('washing_machine'))
    legacy = {**doc, 'product_domain': 'vacuum', 'product_category': 'Vacuum'}
    legacy.pop('product_type')
    try:
        store.upsert_confirmed_case(legacy)
        assert store.upsert_confirmed_case(doc) == 'updated'
        assert store.internal_case_count() == 1
        assert store.upsert_confirmed_case(doc) == 'unchanged'
        other = report_document(appliance_report('air_conditioner'))
        with pytest.raises(ValueError, match='CONFIRMED_REVISION'):
            store.upsert_confirmed_case(other)
        other['report_revision'] = 2
        assert store.upsert_confirmed_case(other) == 'updated'
    finally:
        store.close()


def test_spring_sync_preserves_category_and_rejects_invalid_category():
    store = store_at()
    rows = [appliance_report('washing_machine'), appliance_report('air_conditioner', 43),
            appliance_report('WASHER', 44)]
    sync = synchronizer(store, rows)
    try:
        result = sync.sync_once()
        assert result['added'] == 2 and result['failed'] == 1
        assert sync.sync_once()['unchanged'] == 2
    finally:
        sync._client.close()
        store.close()


@pytest.mark.parametrize('kind', TYPES)
def test_category_enters_normalization_prompt_and_output(fake_openai, kind):
    requests = fake_openai({'observations': [], 'unmapped_fragments': ['물이 안 빠져요']})
    result = normalize_observations('물이 안 빠져요', product_type=kind)
    assert kind in requests[0]['input'][0]['content']
    assert result['product_type'] == kind
    assert result['unmapped_fragments'] == ['물이 안 빠져요']


def test_opinion_retains_product_and_unmapped_symptoms_with_partial_codes(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-key-not-real')
    calls = install_fake_client(monkeypatch, FinalOpinion(opinion_ko='배수 경로와 전원 연결을 점검합니다.',
                                                        supporting_case_ids=[]))
    obs, pcb, damage, cases, guidance = sample_evidence()
    obs.update(product_type='washing_machine', unmapped_fragments=['물이 안 빠져요'])
    generate_final_opinion(obs, pcb, damage, [], guidance)
    evidence = json.loads(calls[0]['input'][1]['content'])
    assert evidence['product_type'] == 'washing_machine'
    assert evidence['product_name'] == '세탁기'
    assert evidence['unmapped_fragments'] == ['물이 안 빠져요']


@pytest.mark.parametrize('kind', [None, '', 'washer', 'WASHING_MACHINE', 'robot_vacuum'])
def test_unknown_spelling_rejected(kind):
    with pytest.raises(ValidationError):
        SearchRequest(product_type=kind)
    with pytest.raises(ValidationError):
        report_document(appliance_report(kind))
    with pytest.raises(ValidationError):
        AgentCase(case_id='draft1', product_type=kind)


async def test_mcp_categories_and_scoped_retrieval_with_models_missing(monkeypatch):
    seen = []
    def normalize(text, origin, confirmed, product_type):
        seen.append(product_type)
        return {'raw_text': text, 'observations': [], 'unmapped_fragments': [text]}
    monkeypatch.setattr('repair_mcp.retrieval.normalize_observations', normalize)
    monkeypatch.setattr('repair_mcp.servers.normalize_observations', normalize)
    def opinion(observation, pcb, damage, cases, guidance):
        assert observation['product_type'] == 'washing_machine'
        assert {c['product_type'] for c in cases} == {'washing_machine'}
        return {'text': '보고된 증상을 점검합니다.', 'supporting_case_ids': [], 'engine': 'test', 'model': 'test'}
    monkeypatch.setattr('repair_mcp.retrieval.generate_final_opinion', opinion)
    for service, tool, payload in [
        ('observation', 'normalize_observation', {'raw_text': 'motor'}),
        ('pcb', 'interpret_pcb', {'labels': ['open_circuit']}),
        ('damage', 'interpret_damage', {'labels': ['scratches']}),
    ]:
        async with Client(create_server(service)) as client:
            result = (await client.call_tool(tool, {**payload, 'product_type': 'washing_machine'})).data
            # Normalization is stubbed above; real output propagation is tested separately.
            if service != 'observation':
                assert result['product_type'] == 'washing_machine'
    store = store_at()
    public_index(store)
    store.upsert_confirmed_case(report_document(appliance_report('washing_machine')))
    try:
        async with Client(create_server('rag', store)) as client:
            result = (await client.call_tool('retrieve_repair_context', {'request': {
                'product_type': 'washing_machine', 'raw_text': 'motor',
                'pcb_labels': None, 'damage_labels': None}})).data
            assert result['product_type'] == 'washing_machine'
            assert result['pcb']['input_state'] == 'result_unavailable'
            assert result['case_search_status'] == 'candidates_found'
            direct = (await client.call_tool('search_repair_cases', {
                'product_type': 'air_conditioner', 'query': 'motor'})).data
            assert direct['repair_cases'] == []
            unknown = (await client.call_tool('search_repair_cases', {'query': 'motor'})).data
            assert unknown['case_search_status'] == 'product_type_required'
            assert unknown['repair_cases'] == []
        assert seen == ['washing_machine', 'washing_machine']
    finally:
        store.close()
