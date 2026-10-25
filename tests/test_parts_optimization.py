import asyncio
from unittest.mock import AsyncMock
import pytest
from langchain_core.messages import AIMessage
from worker import graph, tools, config as C

@pytest.mark.parametrize('batch', [1, 2, 3, 5])
def test_exhausted_budget_stops_before_extra_llm_call(monkeypatch, batch):
    monkeypatch.setattr(C, 'USE_GPT', True)
    monkeypatch.setattr(C, 'MAX_PART_TOOL_CALLS', 4)
    monkeypatch.setattr(tools, 'business_tool_specs', AsyncMock(return_value=[]))
    tool = AsyncMock(return_value={'quantity': 1})
    monkeypatch.setattr(tools, 'call_business_tool', tool)
    choices=[]
    def model(specs, *, tool_choice=None):
        choices.append(tool_choice)
        return tool_choice
    monkeypatch.setattr(tools, 'parts_agent_llm', model)
    async def ask(llm, messages, turn):
        if llm == 'none':
            return AIMessage(content='조회한 부품의 재고를 확인했습니다.')
        return AIMessage(content='', tool_calls=[{'name':'get_part_availability', 'args':{'part_id':str(turn*batch+i)}, 'id':f'{turn}-{i}'} for i in range(batch)])
    request=AsyncMock(side_effect=ask)
    monkeypatch.setattr(tools, 'ask_parts_agent', request)
    state={'command':{'payload':{'repair':{'product_snapshot':{'compatibleParts':[{'id':'1'}]}}}}, 'text':'소견', 'findings':[]}
    result=asyncio.run(graph.check_parts(state, {'configurable':{'emit':AsyncMock()}}))
    assert tool.await_count == 4
    assert request.await_count == (4+batch-1)//batch
    assert choices == [None]
    assert result['findings'][-1]['output']['status'] == 'limit_reached'
    assert result['findings'][-1]['output']['toolCalls'] == 4
    assert '미확인' in result['findings'][-1]['output']['note']
    assert sum('result' in f['output'] and 'quantity' in f['output']['result'] for f in result['findings']) == 4


def test_completed_early_keeps_summary_without_extra_call(monkeypatch):
    monkeypatch.setattr(C, 'USE_GPT', True)
    monkeypatch.setattr(tools, 'business_tool_specs', AsyncMock(return_value=[]))
    monkeypatch.setattr(tools, 'parts_agent_llm', lambda specs: object())
    request=AsyncMock(return_value=AIMessage(content='추가 조회 불필요'))
    monkeypatch.setattr(tools, 'ask_parts_agent', request)
    state={'command':{'payload':{'repair':{'product_snapshot':{'compatibleParts':[{'id':'1'}]}}}},'text':'소견','findings':[]}
    result=asyncio.run(graph.check_parts(state, {'configurable':{'emit':AsyncMock()}}))
    assert request.await_count == 1
    assert result['findings'][-1]['output']['note']=='추가 조회 불필요'


def test_lookup_failure_is_error_not_zero_inventory(monkeypatch):
    import json
    monkeypatch.setattr(C, 'USE_GPT', True)
    monkeypatch.setattr(tools, 'business_tool_specs', AsyncMock(return_value=[]))
    monkeypatch.setattr(tools, 'parts_agent_llm', lambda specs: object())
    monkeypatch.setattr(tools, 'call_business_tool', AsyncMock(side_effect=ConnectionError('offline')))
    monkeypatch.setattr(tools, 'ask_parts_agent', AsyncMock(side_effect=[
        AIMessage(content='', tool_calls=[{'name':'get_part_availability','args':{'part_id':1},'id':'one'}]),
        AIMessage(content='재고 미확인: 조회 오류로 직접 확인이 필요합니다.')]))
    state={'command':{'payload':{'repair':{'product_snapshot':{'compatibleParts':[{'id':'1'}]}}}},'text':'증상','findings':[]}
    result=asyncio.run(graph.check_parts(state, {'configurable':{'emit':AsyncMock()}}))
    failure=json.loads(result['findings'][0]['output']['result'])
    assert failure['status']=='failed'
    assert failure['failurePolicy']=='optional'
    assert 'available' not in failure and 'quantity' not in failure
    assert '미확인' in result['findings'][1]['output']['note']
