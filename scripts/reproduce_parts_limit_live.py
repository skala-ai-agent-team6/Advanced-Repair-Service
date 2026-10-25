"""실제 OpenAI·업무 MCP 한도 경계 검증. 모의 응답은 사용하지 않는다."""
import os, sys, json, asyncio, copy, uuid, time
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'instrumentation')]
OUT=ROOT/'reports'/(datetime.now(ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d_%H%M%S')+'_부품확인만_실제API_한도테스트')
OUT.mkdir(parents=True)
os.environ.update(REPAIR_MEASURE='1',REPAIR_MEASURE_FILE=str(OUT/'api.jsonl'),REPAIR_MEASURE_SESSION=OUT.name,REPAIR_MEASURE_VERSION='v1-forced-boundary-live')
import repair_measurement as measure
measure.install()
from worker import graph, tools, config as C, report, harness

async def main():
    baseline=json.loads((ROOT/'worker/reports/task-10_revision-1_고장리포트.json').read_text())
    cmd=copy.deepcopy(baseline['command'])
    cmd.update(taskId=OUT.name,eventId=str(uuid.uuid4()))
    state={'command':cmd,'text':cmd['payload']['repair']['symptom'],'findings':[],'photos':[]}
    for e in baseline['result']['payload']['evidence']:
        if e['type']=='PHOTO':
            a=e['annotation'];state['findings'].append({'source':'PCB' if 'pcb' in a['image'].lower() else 'MECH','attachmentId':e.get('attachmentId'),'found':bool(a['defects']),'output':{**a,'annotated_image':a['image'],'is_defective':bool(a['defects'])}})
    events=[]
    async def emit(kind,payload):events.append({'kind':kind,'payload':payload})
    config={'configurable':{'emit':emit}}
    original=tools.parts_agent_llm
    def force_one_real_tool(specs):
        # 실제 모델에게 매 응답에서 도구 1개를 요구한다. 모델 응답·인자는 생성하지 않는다.
        return original(specs).bind(tool_choice={'type':'function','function':{'name':'get_part_availability'}},parallel_tool_calls=False)
    started=time.perf_counter()
    with measure.scope(event_id=cmd['eventId'],task_id=cmd['taskId']):
        measure.emit('execution.started')
        with patch.object(tools,'parts_agent_llm',side_effect=force_one_real_tool),patch.object(C,'SAVE_REPAIR_CASES',False):
            result=await harness.observed(graph.check_parts)(state,config)
            state['findings']+=result['findings']
            final=await harness.observed(graph.report)(state,config)
        measure.emit('execution.finished',duration_ms=round((time.perf_counter()-started)*1000,2),result_type=final['result']['eventType'])
    with patch.object(report,'OUT',OUT): report.save(cmd,final['result'])
    (OUT/'tool-events.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
    rows=[json.loads(l) for l in (OUT/'api.jsonl').read_text().splitlines()]
    starts={r['call_id']:r for r in rows if r['event']=='openai.started'}
    ends={r['call_id']:r for r in rows if r['event'] in ('openai.finished','openai.failed')}
    usages={r['parts_call_group']:r for r in rows if r['event']=='parts.response_usage'}
    part_calls=[r for r in starts.values() if r.get('node')=='check_parts']
    actual_tools=[e for e in events if e['kind']=='TOOL_EXECUTED' and e['payload'].get('mcpServer')=='business-mcp']
    discarded=[r for r in usages.values() if r['usage']=='discarded_tool_request']
    errors=[r for r in ends.values() if r['event']=='openai.failed' or (r.get('status') or 0)>=400]
    assert len(part_calls)==5,(len(part_calls),'unexpected model attempts')
    assert len(actual_tools)==4
    assert not any(e['payload']['output'].get('error') for e in actual_tools), 'MCP returned errors'
    assert len(discarded)==1
    assert not errors
    lines=['# 실제 API 부품 한도 경계 테스트','',
           f"실행: {datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds')}",'',
           '**실제 OpenAI API와 실행 중인 업무 MCP를 호출했다. 모의 응답은 사용하지 않았다.**','',
           '## 재현 조건','',
           '- 기존 check_parts 루프와 4회 한도를 유지했다.',
           '- 이 별도 테스트 프로세스에서만 tool_choice=get_part_availability, parallel_tool_calls=false를 지정했다. 매번 실제 모델이 도구 인자를 생성한다.',
           '- 따라서 자연스러운 운영 입력에서 우연히 발생한 사례가 아니라, 도구 요청을 강제한 실제 API 경계 테스트다.',
           '- 정상 완료했던 작업 10의 저장된 사진 분석 근거를 재사용했다. 사진 분석·소견·RAG를 새로 실행한 전체 E2E 측정은 아니다.',
           '- 후속 리포트는 실제 LLM으로 생성했다. 사례 DB 저장은 껐으며 Spring에 새 진단을 등록하지 않았다.',
           '- 운영 프롬프트·루프·최적화는 변경하지 않았다.','',
           '## 결과','',f'- 실제 부품 GPT 요청: {len(part_calls)}회',
           f'- 실제 업무 MCP 조회: {len(actual_tools)}회',f'- 한도 때문에 버려진 응답: {len(discarded)}회',
           f'- 리포트 등을 포함한 실제 OpenAI 요청: {len(starts)}회',f'- API 오류: {len(errors)}회',
           f"- 전체 테스트 시간: {(time.perf_counter()-started):.2f}초",f"- 최종 결과: {final['result']['eventType']}",'',
           '## 실제 호출 로그','', '| 단계 | 실제 요청 | API 시간 | HTTP 상태 | 응답 사용 |','|---|---:|---:|---:|---|']
    for i,(cid,r) in enumerate(starts.items(),1):
        end=ends[cid]; usage=usages.get(r.get('parts_call_group'),{}).get('usage','리포트 생성')
        lines.append(f"| {r.get('node')} | {i} | {end['duration_ms']/1000:.3f}초 | {end.get('status')} | {usage} |")
    lines+=['','## 해석','',
            '5번째 실제 GPT 응답도 도구를 요청했지만 기존 루프는 이미 도구 4회를 사용해 이를 폐기했다. 후보 ④의 실제 응답 시간이 위 표의 discarded_tool_request 행이다.',
            '최적화 후 마지막 호출을 정상 요약으로 대체하면 5회→5회일 수 있다. 이 테스트로 API 횟수 감소나 전체 절감 시간을 주장하지 않는다.',
            '① split_text와 ② RAG 최종 소견은 이번 부품 집중 테스트 범위가 아니다.','',
            '## 원본 증거','', '- [API 원본 JSONL](api.jsonl)','- [업무 MCP 반환 결과](tool-events.json)','',
            '## 재실행','', '```bash',f'cd {ROOT}', 'uv run --env-file .env python scripts/reproduce_parts_limit_live.py','```']
    (OUT/'실제API_부품한도_검증리포트.md').write_text('\n'.join(lines)+'\n')
    print(str(OUT/'실제API_부품한도_검증리포트.md'),flush=True)
    print(json.dumps({'openai':len(starts),'parts_openai':len(part_calls),'mcp':len(actual_tools),'discarded':len(discarded),'errors':len(errors)},ensure_ascii=False),flush=True)

if __name__=='__main__':asyncio.run(main())
