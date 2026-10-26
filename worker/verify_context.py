"""문맥/예산 장애 시연. 합성 MCP·로컬 입출력, --live-llm은 리포트 LLM만 실제 호출한다."""
import argparse
import asyncio
import copy
import json
import uuid
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from . import config as C, context_policy as policy, enrichment, harness, main, report, tools
from .journal import Journal
from .send_test import COMMAND
from .verify_live import LocalOutput


async def run(live_llm=False):
    if live_llm and not C.USE_GPT:
        raise ValueError('OPENAI_API_KEY is required for --live-llm')
    rows = []
    for scenario in ('CONTEXT_LIMIT', 'TOKEN_BUDGET_EXCEEDED', 'OUTPUT_SIZE_LIMIT', 'large-context'):
        cmd = copy.deepcopy(COMMAND)
        task = str(uuid.uuid4().int % 100000000 + 1)
        cmd.update(eventId=str(uuid.uuid4()), taskId=task, repairId=task,
                   executionId=str(uuid.uuid4()), correlationId=str(uuid.uuid4()))
        cmd['payload']['task']['id'] = cmd['payload']['repair']['id'] = task
        output, journal = LocalOutput(), Journal(C.ROOT/'.local/context-check.sqlite3')
        try:
            with ExitStack() as stack:
                if scenario != 'large-context':
                    setting = {'CONTEXT_LIMIT': 'MAX_CONTEXT_TOKENS', 'TOKEN_BUDGET_EXCEEDED': 'MAX_RUN_TOKENS',
                               'OUTPUT_SIZE_LIMIT': 'MAX_EVENT_BYTES'}[scenario]
                    stack.enter_context(patch.object(C, setting, 300 if scenario == 'OUTPUT_SIZE_LIMIT' else 1))
                    async def invoke(*args, **kwargs):
                        if scenario == 'OUTPUT_SIZE_LIMIT':
                            policy.check_event_size({'summary': 'large' * 500})
                        policy.reserve_llm(tools.Report, 'test')
                        raise AssertionError('Expected an execution limit')
                    stack.enter_context(patch.object(main, 'GRAPH', SimpleNamespace(ainvoke=invoke)))
                else:
                    # 원본 그래프와 리포트 함수를 실행한다. MCP·사진 다운로드만 합성한다.
                    private = '이름: 테스트고객; 전화 010-1234-5678 이메일 sample@example.com; '
                    cmd['payload']['repair']['symptom'] = private + '전원이 켜지지 않습니다. ' * 500
                    image = C.SAMPLE_PHOTOS[0]
                    attachment = cmd['payload']['attachments'][0]['id']
                    image_result = {'is_defective': True, 'annotated_image': image,
                                    'defects': [{'type': 'short', 'confidence': .7}] * 3000}
                    rag_result = {'status': 'ok', 'hits': [
                        {'kind': 'CASE', 'citation': f'synthetic-case:{i}',
                         'sourceUri': 'https://example.com/synthetic-fixture',
                         'excerpt': private + 'PCB 전원 회로 점검 사례. ' * 300} for i in range(8)]}
                    replacements = [
                        (tools, 'load_photos', [{'attachmentId': attachment, 'path': image, 'target': 'PCB'}]),
                        (tools, 'call_pcb_mcp', image_result), (tools, 'call_rag_mcp', rag_result),
                        (enrichment, 'normalize_observation', {'observations': []}),
                        (enrichment, 'interpret_pcb', {'detections': []})]
                    for module, name, value in replacements:
                        stack.enter_context(patch.object(module, name, AsyncMock(return_value=value)))
                    stack.enter_context(patch.object(C, 'USE_GPT', True))
                    if not live_llm:
                        llm = SimpleNamespace(ainvoke=AsyncMock(return_value=tools.Report(
                            summary='합성 검증 결과', repairMethod='전원 회로 점검', candidates=[
                                tools.Candidate(cause='short', confidence=.7, explanation='합성 검출 근거')])) )
                        stack.enter_context(patch.object(tools, 'gpt', lambda schema: llm))
                result = await main.handle(cmd, output, journal)
        finally:
            journal.close()
        path = report.OUT/f'task-{task}_revision-1_고장리포트.md'
        saved = json.loads(path.with_suffix('.json').read_text())
        assert saved['result'] == result and path.is_file()
        if scenario == 'large-context':
            assert result['eventType'] == 'DIAGNOSIS_COMPLETED'
            assert '문맥 제한:' in result['payload']['summary']
            assert len(result['payload']['evidence'][0]['annotation']['defects']) == 3000
            for text in (path.read_text(), path.with_suffix('.json').read_text(), json.dumps(output.events)):
                assert '010-1234-5678' not in text and 'sample@example.com' not in text
            if live_llm:
                assert saved['execution']['llm']['actual_usage']['total_tokens'] > 0
        else:
            assert result['payload']['errorCode'] == scenario
            assert scenario in path.read_text()
        rows.append({'scenario': scenario, 'result': result['eventType'], 'report': str(path),
                     'execution': saved['execution']})
    summary = report.OUT/'context-check-summary.json'
    summary.write_text(json.dumps({'mode': 'synthetic MCP/local events; ' + ('real report LLM' if live_llm else 'mock LLM'),
                                   'scenarios': rows}, ensure_ascii=False, indent=2))
    print(f'4 context scenarios verified: {summary}')
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--live-llm', action='store_true')
    asyncio.run(run(parser.parse_args().live_llm))
