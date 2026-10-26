import asyncio
import copy
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from worker import config as C, context_policy as policy, enrichment, harness, main, report, tools
from worker.journal import Journal, VALIDATOR
from worker.tool_policy import ToolResponseError, check_object, check_response
from test_integration import command, fixture_tools, Producer

REAL_WRITE_REPORT = tools.write_report

PII = '이름: 테스트고객; 전화 010-1234-5678 이메일 sample@example.com 주민번호 900101-1234567 주소: 서울시 테스트로 1; 전원 불량'


def test_masking_preserves_repair_clues_and_contract_identifiers():
    raw = {'raw_text': PII, 'attachmentId': '01012345678', 'sourceUri': 'https://example.com/document/900101-1234567',
           'details': [{'excerpt': PII}]}
    saved = copy.deepcopy(raw)
    safe = policy.masked(raw)
    for private in ('테스트고객', '010-1234-5678', 'sample@example.com', '900101-1234567', '서울시 테스트로 1'):
        assert private not in safe['raw_text']
    assert '전원 불량' in safe['raw_text'] and safe['attachmentId'] == raw['attachmentId']
    assert safe['sourceUri'] == raw['sourceUri'] and raw == saved
    assert policy.masked(safe) == safe


def test_byte_clipping_is_valid_korean_and_keeps_tail():
    text = '시작 ' + '가나다🙂' * 3000 + ' 끝에서 전원 이상'
    result = policy.prepare_text(text)
    assert policy.text_tokens(result) <= C.OBSERVATION_CONTEXT_BYTES
    assert result.startswith('시작') and result.endswith('끝에서 전원 이상')
    assert '생략' in result and '\ufffd' not in result


def finding(kind='PCB', found=True, attachment='1'):
    return {'source': kind, 'attachmentId': attachment, 'found': found,
            'output': {'is_defective': found, 'defects': [{'type': 'short', 'confidence': .7}] if found else [],
                       'annotated_image': '/tmp/boxed.jpg'}}


def test_large_tool_copy_preserves_defect_types_and_counts_without_mutating_source():
    raw = finding()
    raw['output']['defects'] *= 3000
    saved = copy.deepcopy(raw)
    compact, changed = policy.bounded_finding(raw)
    assert changed and compact['attachmentId'] == '1'
    assert compact['output']['defect_counts'] == {'short': 3000}
    assert compact['output']['defects'] == [{'type': 'short', 'confidence': .7}]
    assert policy.text_tokens(policy.dump(compact)) <= C.TOOL_CONTEXT_BYTES
    assert raw == saved


def test_context_compaction_keeps_positive_old_photo_recent_photo_and_rag_source(monkeypatch):
    monkeypatch.setattr(C, 'REPORT_FINDINGS_BYTES', 1300)
    findings = [finding(found=(i == 0), attachment=str(i+1)) for i in range(30)]
    findings.append({'source': 'RAG', 'found': False, 'attachmentId': None, 'output': {
        'hits': [{'kind': 'CASE', 'citation': 'case:123', 'sourceUri': 'https://example.com/case/123', 'excerpt': '점검 사례'}]}})
    result, changed = policy.prepare_findings(findings)
    assert changed and policy.text_tokens(policy.dump(result)) <= 1300
    assert any(f['attachmentId'] == '1' and f['found'] for f in result)
    assert any(f['attachmentId'] == '30' for f in result)
    assert any(f['output'].get('hits', [{}])[0].get('citation') == 'case:123' for f in result)


def test_large_rag_retains_sources_and_valid_json():
    f = {'source': 'RAG', 'found': False, 'attachmentId': None, 'output': {'hits': [
        {'kind': 'CASE', 'citation': f'case:{i}', 'sourceUri': f'https://example.com/{i}',
         'excerpt': '점검 전원 문제 ' * 5000 + PII} for i in range(30)]}}
    reduced, changed = policy.bounded_finding(f)
    assert changed and len(reduced['output']['hits']) == 8
    assert reduced['output']['hits'][0]['citation'] == 'case:0'
    assert policy.text_tokens(policy.dump(reduced)) <= C.TOOL_CONTEXT_BYTES
    assert 'sample@example.com' not in policy.dump(reduced)
    assert json.loads(policy.dump(reduced)) == reduced


@pytest.mark.parametrize('structured', [False, True])
def test_oversized_mcp_rejected_before_json_forwarding(monkeypatch, structured):
    monkeypatch.setattr(C, 'MAX_MCP_RESPONSE_BYTES', 256)
    with pytest.raises(ToolResponseError):
        if structured:
            check_object({'text': 'X' * 300}, 'rag')
        else:
            check_response(SimpleNamespace(is_error=False, structured_content=None,
                                           content=[SimpleNamespace(text='X' * 300)]), 'pcb')


def test_observation_evidence_is_validated_against_sanitized_request(monkeypatch):
    async def call(url, name, args):
        assert 'sample@example.com' not in args['raw_text']
        return {'raw_text': args['raw_text'], 'observations': [{'evidence_text': '전원 불량'}]}
    monkeypatch.setattr(enrichment, 'call', call)
    assert asyncio.run(enrichment.normalize_observation(PII))['observations']


def test_reservation_checks_before_model_retry_and_parallel_calls(monkeypatch):
    size = policy.text_tokens(policy.dump(tools.Report.model_json_schema())) + 1024 + C.MAX_OUTPUT_TOKENS + 1
    monkeypatch.setattr(C, 'MAX_RUN_TOKENS', size * 2)
    async def run():
        budget = harness.Budget('test', 20)
        token = harness.current.set(budget)
        try:
            async def reserve():
                policy.reserve_llm(tools.Report, 'x')
            results = await asyncio.gather(*(reserve() for _ in range(3)), return_exceptions=True)
            assert sum(isinstance(r, harness.LimitExceeded) for r in results) == 1
            assert budget.tokens_reserved == size * 2 and budget.llm_calls == 2
        finally:
            harness.current.reset(token)
    asyncio.run(run())


def test_usage_tracker_records_actual_counts_without_prompt_or_model_body():
    usage = {'input_tokens': 100, 'output_tokens': 20, 'total_tokens': 120}
    token = harness.current.set(harness.Budget('test', 10))
    try:
        response = LLMResult(generations=[[ChatGeneration(message=AIMessage(content=PII, usage_metadata=usage))]])
        policy.UsageTracker().on_llm_end(response)
        assert dict(harness.current.get().llm_usage) == usage
        assert 'sample@example.com' not in str(harness.current.get().llm_usage)
    finally:
        harness.current.reset(token)


@pytest.mark.parametrize('limit,code', [('MAX_CONTEXT_TOKENS', 'CONTEXT_LIMIT'), ('MAX_RUN_TOKENS', 'TOKEN_BUDGET_EXCEEDED')])
def test_budget_exhaustion_writes_failure_json_and_report_before_llm(fixture_tools, monkeypatch, tmp_path, limit, code):
    monkeypatch.setattr(C, limit, 1)
    monkeypatch.setattr(C, 'USE_GPT', True)
    monkeypatch.setattr(tools, 'write_report', REAL_WRITE_REPORT)
    model = AsyncMock()
    monkeypatch.setattr(tools, 'gpt', model)
    async def run():
        journal = Journal(tmp_path/'state.db')
        try:
            result = await main.handle(command(), Producer(), journal)
            assert result == {'eventType': 'DIAGNOSIS_FAILED', 'payload': {'errorCode': code}}
            assert model.call_count == 0
            path = next(report.OUT.glob('*.json'))
            assert json.loads(path.read_text())['result'] == result
            assert code in path.with_suffix('.md').read_text()
        finally:
            journal.close()
    asyncio.run(run())


def test_long_pii_input_large_rag_creates_masked_report_and_keeps_all_photo_evidence(fixture_tools, monkeypatch, tmp_path):
    monkeypatch.setattr(C, 'USE_GPT', True)
    monkeypatch.setattr(tools, 'write_report', REAL_WRITE_REPORT)
    rag = {'hits': [{'kind': 'CASE', 'citation': 'case:1', 'excerpt': PII + '참조 근거 ' * 10000}], 'status': 'ok'}
    tools.call_rag_mcp.return_value = rag
    received = []
    async def invoke(prompt):
        received.append(prompt)
        assert 'sample@example.com' not in prompt and '010-1234-5678' not in prompt
        assert len(prompt.encode()) < C.MAX_CONTEXT_TOKENS
        return tools.Report(summary=PII, repairMethod='점검', candidates=[tools.Candidate(cause='short', confidence=.7, explanation='모델 근거')])
    monkeypatch.setattr(tools, 'gpt', lambda schema: SimpleNamespace(ainvoke=invoke))
    async def run():
        journal, cmd, producer = Journal(tmp_path/'state.db'), command(), Producer()
        cmd['payload']['repair']['symptom'] = PII + ' 점검 요청' * 4000
        original = copy.deepcopy(cmd)
        try:
            result = await main.handle(cmd, producer, journal)
            assert result['eventType'] == 'DIAGNOSIS_COMPLETED'
            assert len([e for e in result['payload']['evidence'] if e['type'] == 'PHOTO']) == 1
            assert '문맥 제한:' in result['payload']['summary']
            saved = next(report.OUT.glob('*.json'))
            assert 'sample@example.com' not in saved.read_text()
            assert '010-1234-5678' not in saved.with_suffix('.md').read_text()
            for event in producer.events:
                VALIDATOR.validate(event)
                assert 'sample@example.com' not in json.dumps(event)
            assert json.loads(saved.read_text())['result'] == result and cmd == original
            # 이 레포는 유사사례 번역 LLM 호출이 하나 더 있다. 리포트 프롬프트만 센다.
            reports = [x for x in received if x.startswith('입력된 가전제품의 수리 기사')]
            assert len(reports) == 1 and len(rag['hits'][0]['excerpt']) > 10000
        finally:
            journal.close()
    asyncio.run(run())


def test_llm_sets_output_cap(monkeypatch):
    import langchain_openai
    model = SimpleNamespace(with_structured_output=lambda schema: schema)
    calls = []
    monkeypatch.setattr(langchain_openai, 'ChatOpenAI', lambda **kwargs: calls.append(kwargs) or model)
    tools.gpt(tools.Report)
    assert calls[0]['max_completion_tokens'] == C.MAX_OUTPUT_TOKENS
    assert isinstance(calls[0]['callbacks'][0], policy.UsageTracker)


def test_oversized_final_result_generates_small_failure_report(fixture_tools, monkeypatch, tmp_path):
    monkeypatch.setattr(C, 'MAX_EVENT_BYTES', 1000)
    tools.write_report.return_value.summary = '큰 결과' * 500
    async def run():
        journal = Journal(tmp_path/'state.db')
        try:
            result = await main.handle(command(), Producer(), journal)
            assert result['payload']['errorCode'] == 'OUTPUT_SIZE_LIMIT'
            path = next(report.OUT.glob('*.json'))
            assert json.loads(path.read_text())['result'] == result
            assert 'OUTPUT_SIZE_LIMIT' in path.with_suffix('.md').read_text()
        finally:
            journal.close()
    asyncio.run(run())


def test_omitted_photo_defect_types_are_aggregated(monkeypatch):
    monkeypatch.setattr(C, 'REPORT_FINDINGS_BYTES', 1500)
    findings = [finding(attachment=str(i)) for i in range(30)]
    for i, f in enumerate(findings):
        f['output']['defects'][0]['type'] = 'short' if i != 0 else 'open_circuit'
    prepared, changed = policy.prepare_findings(findings)
    assert changed
    summary = next(f['output'] for f in prepared if f['source'] == 'CONTEXT_SUMMARY')
    types = {d['type'] for d in summary['defect_summary']} | {
        d['type'] for f in prepared for d in f['output'].get('defects', [])}
    assert types == {'short', 'open_circuit'}
    assert sum(d['count'] for d in summary['defect_summary']) == summary['omitted_findings']


@pytest.mark.parametrize('text', ['a' * 5000, '전원 불량 ' * 1000, '🙂' * 5000])
def test_text_respects_team_mcp_2000_character_contract_and_byte_cap(text):
    result = policy.prepare_text(text)
    assert len(result) <= 2000 and policy.text_tokens(result) <= C.OBSERVATION_CONTEXT_BYTES
    assert '생략' in result


def test_rag_query_uses_same_masked_bounded_text_as_observation(monkeypatch):
    captured = []
    class Client:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def call_tool(self, name, arguments):
            captured.append(arguments['request']['raw_text'])
            return SimpleNamespace(is_error=False, content=[], structured_content={
                'repair_cases': [], 'label_definitions': [], 'case_search_status': 'ok'})
    monkeypatch.setattr(tools, 'Client', Client)
    text = PII + ' 점검 요청' * 2000
    asyncio.run(tools.call_rag_mcp(text, ['short']))
    assert captured == [policy.prepare_text(text)] and len(captured[0]) <= 2000


def test_punctuation_heavy_text_can_be_masked_without_changing_it():
    text = '*' * 100000
    assert policy.mask_text(text) == text


def test_large_interpretation_preserves_domain_mismatch_policy():
    raw = {'source': 'INTERPRETATION', 'attachmentId': None, 'found': False, 'output': {
        'tool': 'interpret_damage', 'domain_mismatch': True, 'diagnosis_confirmed': False,
        'generation_policy': '자동차 부위는 청소기에 적용하지 말 것',
        'detections': [{'part': 'roof', 'domain_compatible': False, 'description': '자료 ' * 3000}]}}
    result, changed = policy.bounded_finding(raw)
    assert changed and result['output']['domain_mismatch'] is True
    assert result['output']['diagnosis_confirmed'] is False
    assert result['output']['detections'][0]['domain_compatible'] is False
    assert result['output']['generation_policy'] == raw['output']['generation_policy']


def test_event_cap_uses_actual_journal_serialization_size(monkeypatch):
    from worker.journal import encode
    value = {'data': [0] * 100}
    monkeypatch.setattr(C, 'MAX_EVENT_BYTES', policy.text_tokens(policy.dump(value)))
    assert len(encode(value).encode()) > C.MAX_EVENT_BYTES
    with pytest.raises(harness.LimitExceeded) as error:
        policy.check_event_size(value)
    assert error.value.code == 'OUTPUT_SIZE_LIMIT'
