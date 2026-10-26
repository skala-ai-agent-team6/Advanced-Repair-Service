"""외부 API 없이 실제 check_parts 제어 흐름의 최대 차례·버려진 응답을 재현한다."""
# V1 실험 재현 코드다. V2의 현재 제어 흐름에 옛 기대값을 적용하지 않는다.
if __name__ == "__main__":
    from pathlib import Path as _Path
    import json as _json
    import sys as _sys
    _root = _Path(__file__).resolve().parents[1]
    if "split_text" not in _json.loads((_root / "prompts/manifest.json").read_text())["prompts"]:
        _sys.exit("V1 전용 실험입니다. V1 폴더에서 실행하세요. V2 자동 검증: .venv/bin/python -m pytest tests/test_parts_optimization.py -q. V2 실제 전체 진단은 V2_실행방법.md를 참고하세요.")
import asyncio
import copy
from datetime import datetime
from zoneinfo import ZoneInfo
import json
from pathlib import Path
import sys
import time
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from langchain_core.messages import AIMessage
from worker import config as C, graph, tools, report
from worker.send_test import COMMAND


async def scenario(final_summary=False):
    logs=[]
    def record(event, **fields):
        logs.append({'event': event, **fields})
    class FixedModel:
        count=0
        async def ainvoke(self, messages):
            self.count+=1
            start=time.perf_counter()
            response=(AIMessage(content='[모의] 조회한 네 부품의 재고 확인 완료.')
                      if final_summary and self.count==5 else
                      AIMessage(content='',tool_calls=[{'id':f'tool-{self.count}',
                        'name':'get_part_availability','args':{'part_id':str(self.count)}}]))
            record('simulation.model_response', turn=self.count,
                   response='summary' if not response.tool_calls else 'tool_request',
                   local_ms=round((time.perf_counter()-start)*1000,4))
            return response
    async def business(name,args):
        record('simulation.business_tool',tool=name,part_id=args['part_id'])
        return {'part_id':args['part_id'],'available':False,'quantity':0}
    model=FixedModel()
    cmd=copy.deepcopy(COMMAND)
    cmd['taskId']='parts-limit-simulation'
    cmd['payload']['repair']['product_snapshot']['compatibleParts']=[
        {'id':str(i),'name':name} for i,name in enumerate(['모터','PCB','배터리','센서','필터'],1)]
    state={'command':cmd,'text':'[모의] 여러 부품의 재고를 순서대로 확인','findings':[],'photos':[]}
    fake_report=tools.Report(summary='[모의 테스트] 부품 조회 한도 후 리포트 생성 확인',repairMethod='실제 수리 판정이 아닌 제어 흐름 테스트',candidates=[tools.Candidate(cause='모의 원인',confidence=0.1,explanation='스키마 검증용 고정 응답이며 실제 판정이 아님')])
    started=time.perf_counter()
    with patch.object(C,'USE_GPT',True), patch.object(C,'MAX_PART_TOOL_CALLS',4), patch.object(C,'SAVE_REPAIR_CASES',False), \
         patch.object(tools,'business_tool_specs',AsyncMock(return_value=[])), \
         patch.object(tools,'parts_agent_llm',return_value=model), \
         patch.object(tools,'call_business_tool',side_effect=business), \
         patch.object(graph.measurement,'emit',side_effect=record), \
         patch.object(tools,'write_report',AsyncMock(return_value=fake_report)), \
         patch.object(tools,'translate_cases',AsyncMock(return_value=[])):
        result=await graph.check_parts(state,{'configurable':{'emit':AsyncMock()}})
        state['findings']=result['findings']
        final=await graph.report(state,{'configurable':{'emit':AsyncMock()}})
    elapsed=round((time.perf_counter()-started)*1000,3)
    discarded=sum(r.get('usage')=='discarded_tool_request' for r in logs)
    summaries=sum(f['output'].get('tool')=='parts_agent' for f in state['findings'])
    tool_count=sum(r['event']=='simulation.business_tool' for r in logs)
    assert model.count==5 and tool_count==4
    assert discarded==(0 if final_summary else 1)
    assert summaries==(1 if final_summary else 0)
    assert final['result']['eventType']=='DIAGNOSIS_COMPLETED'
    return {'mode':'SIMULATION_NO_EXTERNAL_API','model_turns':model.count,'business_calls':tool_count,
            'actual_openai_requests':0,'discarded':discarded,'summaries':summaries,
            'local_elapsed_ms':elapsed,'logs':logs,'final':final,'command':cmd}


async def main():
    out=ROOT/'reports'/(datetime.now(ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d_%H%M%S')+'_부품확인만_모의응답_한도테스트')
    out.mkdir(parents=True,exist_ok=True)
    worst=await scenario(False)
    control=await scenario(True)
    (out/'results.json').write_text(json.dumps({'worst':worst,'control':control},ensure_ascii=False,indent=2))
    (out/'scenario.jsonl').write_text('\n'.join(json.dumps(r,ensure_ascii=False) for r in worst['logs'])+'\n')
    with patch.object(report,'OUT',out):
        report.save(worst['command'],worst['final']['result'])
    lines=['# 부품 확인 한도 도달 재현 리포트','',
           f"- 실행 일시: {datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds')}",
           '- 구분: **모의 응답 기반 제어 흐름 검증. 실제 GPT·MCP·Spring·Kafka 성능 테스트가 아님.**',
           '- 기존 graph.check_parts와 tools.ask_parts_agent, graph.report를 실행했다. 모델 응답·업무 조회·최종 리포트 문장은 고정 응답으로 대체했다.',
           '- 운영 중인 서버와 진단 상태는 변경하지 않았다. 최적화도 적용하지 않았다.','',
           '## 결과','',
           '| 항목 | 한도 후 추가 조회 요청 | 한도 후 정상 요약(대조군) |',
           '|---|---:|---:|',
           f"| 부품 모델 실행 차례 | {worst['model_turns']} | {control['model_turns']} |",
           '| 업무 도구 실행 | 4 | 4 |','| 실제 OpenAI API 요청 | 0 | 0 |',
           '| 버려진 모델 응답 | 1 | 0 |','| 보존된 부품 요약 | 0 | 1 |',
           '| 후속 리포트 노드 | DIAGNOSIS_COMPLETED | DIAGNOSIS_COMPLETED |',
           f"| 로컬 테스트 실행 시간 | {worst['local_elapsed_ms']}ms | {control['local_elapsed_ms']}ms |",'',
           '**시간은 모의 응답을 처리한 로컬 코드 실행 시간이며 GPT 지연 시간이나 절감 시간으로 사용할 수 없다.**','',
           '## 재현 로그','', '```text']
    for row in worst['logs']:
        if row['event']=='simulation.model_response':
            lines.append(f"[모의 모델] {row['turn']}번째 응답: 추가 도구 조회 요청 (로컬 {row['local_ms']}ms)")
        elif row['event']=='parts.response_usage':
            lines.append(f"[실제 제어 코드] {row['parts_turn']}번째 응답 용도: {row['usage']}")
        elif row['event']=='simulation.business_tool':
            lines.append(f"[모의 업무 도구] {row['tool']} · 부품 {row['part_id']} 조회 실행")
    lines+=['[검증] 모델 차례 5 / 업무 도구 실행 4 / 버려진 응답 1 / 부품 요약 0',
            '[검증] 후속 리포트 노드 완료 및 JSON·Markdown 저장 확인','```','',
            '## 해석','',
            '4회의 업무 도구 호출을 소진한 뒤 5번째 모델 응답도 도구를 요청했다. 기존 분기가 이를 실행하지 않고 종료해, 해당 응답과 부품 요약이 최종 근거에 남지 않는 경로를 재현했다.',
            '후보 ③은 이 경우 1회다. 반면 동일하게 5회까지 모델을 호출했더라도 마지막이 정상 요약이면 후보 ③은 0회다.',
            '최적화 A처럼 마지막을 요약 전용으로 바꾸면 5회→5회일 수 있다. 호출 수 감소를 보장하는 최적화가 아니라 무효 응답을 유효한 요약으로 바꾸는 개선이다.',
            '전체 진단 최대 API 횟수를 측정한 것은 아니다. 이 결과는 부품 확인 루프의 정상 응답 기준 최대 5차례다. 하네스 재시도와 다른 노드 호출은 별도다.',
            '후보 ① split_text와 * RAG 최종 소견은 이 집중 테스트에서 실행하지 않았다.','',
            '## 재실행','', '```bash',
            f'cd {ROOT}', '.venv/bin/python scripts/reproduce_parts_limit.py','```','',
            '## 증거 파일','', '- `scenario.jsonl`: 모의 모델/업무 도구 로그와 실제 응답 사용 판별 이벤트',
            '- `results.json`: 두 시나리오 결과·검증용 최종 JSON',
            '- `task-parts-limit-simulation_revision-1_고장리포트.md/json`: 모의 진단 리포트']
    path=out/'부품확인_최악경로_검증리포트.md'
    path.write_text('\n'.join(lines)+'\n')
    print(path)
    print(json.dumps({name:{k:v for k,v in data.items() if k not in ('logs','final','command')} for name,data in [('worst',worst),('control',control)]},ensure_ascii=False,indent=2))


if __name__=='__main__':
    asyncio.run(main())
