import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from worker import config as C, enrichment, graph, tools
from worker.products import command_product_type
from test_integration import command, fixture_tools


@pytest.mark.parametrize('path,key', [('repair','product_type'), ('snapshot','product_type'),
                                      ('repair','productType'), ('payload','product_type')])
def test_backend_product_locations_and_java_enum(path,key):
    cmd = command()
    cmd['payload']['repair'].pop('product_type')  # 예시 명령의 기본값(vacuum)을 빼고 위치별로 확인
    obj = cmd['payload'] if path == 'payload' else cmd['payload']['repair']
    if path == 'snapshot': obj = obj['product_snapshot']
    obj[key] = 'WASHING_MACHINE'
    assert command_product_type(cmd) == 'washing_machine'


def test_missing_unknown_invalid_and_conflicting_product():
    cmd = command()
    cmd['payload']['repair'].pop('product_type')  # 값이 없을 때
    assert command_product_type(cmd) == 'unknown'
    cmd['payload']['repair']['product_type'] = 'washer'
    with pytest.raises(ValueError): command_product_type(cmd)
    cmd['payload']['repair']['product_type'] = 'vacuum'
    cmd['payload']['repair']['product_snapshot']['product_type'] = 'air_conditioner'
    with pytest.raises(ValueError, match='Conflicting'): command_product_type(cmd)


@pytest.mark.parametrize('kind', ['vacuum','washing_machine','air_conditioner'])
def test_graph_passes_product_to_all_mcp_wrappers_and_report(fixture_tools, monkeypatch, kind):
    cmd = command()
    cmd['payload']['repair']['product_type'] = kind
    cmd['payload']['attachments'].append({'id':'2','target':'MOTOR'})
    tools.call_mech_mcp.return_value = {**fixture_tools,
        'defects':[{'type':'scratches','confidence':.7}]}
    monkeypatch.setattr(C, 'SAVE_REPAIR_CASES', True)
    saver = AsyncMock(return_value={'saved':True})
    monkeypatch.setattr(tools, 'save_repair_case', saver)
    result = asyncio.run(graph.build_graph().ainvoke({'command':cmd},
                        {'configurable':{'emit':AsyncMock()}}))
    assert tools.call_rag_mcp.await_args.kwargs['product_type'] == kind
    assert enrichment.normalize_observation.await_args.kwargs['product_type'] == kind
    assert enrichment.interpret_pcb.await_args.kwargs['product_type'] == kind
    assert enrichment.interpret_damage.await_args.kwargs['product_type'] == kind
    assert tools.write_report.await_args.kwargs['product_type'] == kind
    assert saver.await_args.args[0]['product_type'] == kind
    assert result['result']['payload']['product_type'] == kind


def test_payload_and_confirmed_case_survive_worker_adapter_and_spring_report(monkeypatch):
    captured=[]
    records=[
      {'document_id':'dustup:1','source_id':'1','source_url':'https://example.org/case',
       'korean_summary':{'reported_symptom_ko':'전원이 꺼짐','reported_action_ko':'접점 수리'},
       'source_type':'external_community_repair_record','product_type':'washing_machine'},
      {'document_id':'internal:report:10','source_uri':'urn:repair-report:10:revision:1',
       'korean_summary':'배수 필터 이물 제거','source_type':'internal_confirmed_repair',
       'source_label':'사내 확정 사례','product_type':'washing_machine','similarity_score':.88},
      {'document_id':'demo:confirmed-report:washer-drain','source_uri':'urn:repair-demo:washer-drain',
       'korean_summary':'필터 청소','source_type':'synthetic_demo_repair','source_label':'가상 확정 사례 (데모)',
       'is_demo':True,'product_type':'washing_machine'},
    ]
    class Client:
        def __init__(self,*args,**kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def call_tool(self,name,arguments):
            captured.append(arguments)
            return SimpleNamespace(is_error=False, content=[], structured_content={
              'repair_cases':records,'label_definitions':[],'pcb_references':[],
              'case_search_status':'candidates_found'})
    monkeypatch.setattr(tools,'Client',Client)
    monkeypatch.setattr(tools,'translate_cases',AsyncMock(side_effect=lambda texts:texts))
    async def run():
        result=await tools.call_rag_mcp('물이 남아요',None,None,product_type='WASHING_MACHINE')
        assert captured[0]['request']['product_type']=='washing_machine'
        assert captured[0]['request']['damage_labels'] is None
        assert captured[0]['request']['pcb_labels'] is None
        assert result['hits'][0]['excerpt']=='전원이 꺼짐; 접점 수리'
        assert result['hits'][1]['origin']=='INTERNAL'
        assert result['hits'][1]['sourceUri']=='urn:repair-report:10:revision:1'
        assert result['hits'][2]['isDemo'] and '가상 데모' in result['hits'][2]['excerpt']
        screen=await graph.screen_fields({'findings':[{'source':'RAG','output':result}]},[])
        assert screen['similarCases'][1]['origin']=='INTERNAL'
        assert screen['similarCases'][2]['isDemo']
        assert screen['similarCases'][1]['similarity']==.88
    asyncio.run(run())


def test_individual_interpreters_transmit_product(monkeypatch):
    captured=[]
    async def call(url, name, arguments):
        captured.append((name,arguments))
        return {'raw_text': arguments.get('raw_text'), 'observations': [], 'detections': []}
    monkeypatch.setattr(enrichment,'call',call)
    async def run():
        await enrichment.normalize_observation('바람이 약해요',product_type='AIR_CONDITIONER')
        await enrichment.interpret_pcb(['short'],product_type='air_conditioner')
        await enrichment.interpret_damage(['crazing'],product_type='air_conditioner')
    asyncio.run(run())
    assert len(captured)==3
    assert all(args['product_type']=='air_conditioner' for _,args in captured)
