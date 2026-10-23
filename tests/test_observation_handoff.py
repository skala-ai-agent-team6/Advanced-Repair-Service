import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from worker import enrichment, graph, tools
from worker.context_policy import prepare_text
from test_integration import command, fixture_tools

REAL_RAG = tools.call_rag_mcp


def test_graph_forwards_observation_and_model_labels_with_separate_error_codes(fixture_tools):
    cmd = command()
    cmd['payload']['repair']['product_type'] = 'washing_machine'
    cmd['payload']['repair']['error_codes'] = ['E01']
    cmd['payload']['attachments'].append({'id': '2', 'target': 'MOTOR'})
    tools.call_mech_mcp.return_value = {**fixture_tools, 'defects': [{'type': 'crazing', 'confidence': .7}]}
    result = asyncio.run(graph.build_graph().ainvoke({'command': cmd}, {'configurable': {'emit': AsyncMock()}}))
    args = tools.call_rag_mcp.await_args
    normalized = args.kwargs['normalized_observation']
    assert normalized == result['normalized_observation']
    assert normalized['raw_text'] == prepare_text(args.args[0])
    assert normalized['product_type'] == 'washing_machine'
    assert 'tool' not in normalized and 'E01' not in args.args[0]
    assert args.kwargs['error_codes'] == ['E01']
    assert args.args[1:3] == (['short'], ['crazing'])
    assert enrichment.normalize_observation.await_count == 1
    assert tools.call_rag_mcp.await_count == 1


def test_failed_observation_still_calls_rag_with_raw_text(fixture_tools):
    enrichment.normalize_observation.side_effect = RuntimeError('unavailable')
    result = asyncio.run(graph.build_graph().ainvoke({'command': command()}, {'configurable': {'emit': AsyncMock()}}))
    args = tools.call_rag_mcp.await_args
    assert args.args[0] and args.kwargs['normalized_observation'] is None
    assert result['normalized_observation'] is None
    assert tools.write_report.await_count == 1
    assert enrichment.normalize_observation.await_count == 1


@pytest.mark.parametrize('raw', ['전원이 안 켜져요', '전화 010-1234-5678 ' + '전원 이상 ' * 1500])
def test_worker_adapter_preserves_full_result_and_sanitized_source(monkeypatch, raw):
    captured = []
    safe = prepare_text(raw)
    normalized = {'product_type': 'vacuum', 'raw_text': safe, 'origin': 'technician',
                  'technician_confirmed': True, 'engine': 'openai-structured-output-v1', 'model': 'test',
                  'observations': [], 'unmapped_fragments': [safe], 'diagnosis_confirmed': False}
    class Client:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def call_tool(self, name, arguments):
            captured.append(arguments['request'])
            return SimpleNamespace(is_error=False, content=[], structured_content={
                'repair_cases': [], 'label_definitions': [], 'pcb_references': [], 'case_search_status': 'no_candidates',
                'observation': normalized, 'integrated_assessment': {'final_opinion': '전원 연결을 점검합니다.'}})
    monkeypatch.setattr(tools, 'Client', Client)
    result = asyncio.run(REAL_RAG(raw, ['short'], ['crazing'], product_type='vacuum',
                                 normalized_observation=normalized, error_codes=['E01']))
    assert captured[0]['raw_text'] == normalized['raw_text']
    assert captured[0]['normalized_observation'] == normalized
    assert captured[0]['error_codes'] == ['E01']
    assert result['observation'] == normalized
    assert result['integrated_assessment']['final_opinion'] == '전원 연결을 점검합니다.'
    assert '010-1234-5678' not in str(captured)
