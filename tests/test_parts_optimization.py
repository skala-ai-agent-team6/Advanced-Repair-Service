import asyncio
from unittest.mock import AsyncMock
import pytest
from langchain_core.messages import AIMessage
from worker import graph, tools, config as C

@pytest.mark.parametrize('batch', [1, 2])
def test_exhausted_budget_forces_summary_without_extra_tool(monkeypatch, batch):
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
    assert request.await_count == 4//batch+1
    assert choices == [None, 'none']
    assert result['findings'][-1]['output']['note'] == '조회한 부품의 재고를 확인했습니다.'


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
