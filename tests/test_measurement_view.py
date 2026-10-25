from scripts.measurement_view import Viewer, read_rows


def test_counts_retries_once_and_uses_wall_time():
    out=[]; view=Viewer(out.append)
    base={'event_id':'event-one','task_id':'1','node':'split_text'}
    for event in [
        {'event':'node.started'},
        {'event':'openai.started','call_id':'a'},
        {'event':'openai.started','call_id':'a'},
        {'event':'openai.finished','call_id':'a','status':429},
        {'event':'openai.started','call_id':'b'},
        {'event':'node.finished','duration_ms':3000},
        {'event':'execution.finished','duration_ms':4000,'result_type':'DIAGNOSIS_COMPLETED'},
    ]:view.feed({**base,**event})
    assert '소견 분석 | 2회 | 3.00초' in out
    assert any('전체 API 2회 · API 오류 1회 · 전체 처리 4.00초' in line for line in out)


def test_events_are_separate_even_on_same_task():
    out=[]; view=Viewer(out.append)
    for eid in ['first','second']:
        view.feed({'event':'openai.started','event_id':eid,'task_id':'1','node':'report','call_id':eid})
    assert all(job['calls']==1 for job in view.jobs.values())


def test_partial_line_is_left_for_next_read(tmp_path):
    path=tmp_path/'log.jsonl'
    complete='{"event":"measurement.ready"}\n'
    path.write_text(complete+'{"event":')
    rows,offset=read_rows(path)
    assert len(rows)==1
    assert offset==len(complete)


def test_four_items_distinguish_rag_duplicate_from_first_normalization():
    out=[]; view=Viewer(out.append)
    base={'event_id':'e','task_id':'1'}
    examples=[('split_text','split_text',None,None),
              ('normalize_observation','normalize_observation',None,None),
              ('call_rag_mcp','normalize_observation',None,None),
              ('call_rag_mcp','rag_final_opinion',None,None),
              ('parts_agent_turn','parts_agent_turn','a','summary'),
              ('parts_agent_turn','parts_agent_turn','b','discarded_tool_request')]
    for i,(tool,op,group,usage) in enumerate(examples):
        cid=str(i)
        view.feed({**base,'event':'openai.started','call_id':cid,'tool':tool,'api_operation':op,'parts_call_group':group})
        view.feed({**base,'event':'openai.finished','call_id':cid,'status':200,'duration_ms':1000})
        if usage:view.feed({**base,'event':'parts.response_usage','parts_call_group':group,'usage':usage})
    view.feed({**base,'event':'execution.finished','duration_ms':5000})
    text='\n'.join(out)
    assert '① split_text | 1회 | 1.00초' in text
    assert '② RAG 최종 소견 | 1회 | 1.00초' in text
    assert '④ 부품 확인에서 버려진 응답 | 1회 | 1.00초' in text
    assert '③ RAG 중복 소견 정규화 | 1회 | 1.00초' in text
    assert '유지: 부품 확인 요약' in text


def test_old_log_does_not_guess_rag_call_order():
    out=[]; view=Viewer(out.append)
    view.feed({'event_id':'e','event':'openai.started','call_id':'a','tool':'call_rag_mcp'})
    view.feed({'event_id':'e','event':'execution.finished'})
    assert any('② RAG 최종 소견 | 판별 불가' in line for line in out)


def test_live_numbers_match_summary_with_out_of_order_responses():
    out=[]; view=Viewer(out.append)
    base={'task_id':'1','event_id':'e','node':'rag_mcp','tool':'call_rag_mcp'}
    view.feed({**base,'event':'openai.started','call_id':'a','api_operation':'normalize_observation'})
    view.feed({**base,'event':'openai.started','call_id':'b','api_operation':'rag_final_opinion'})
    for cid in ['b','a']:
        view.feed({**base,'event':'openai.finished','call_id':cid,'duration_ms':1250,'status':200})
    view.feed({**base,'event':'execution.finished','duration_ms':2000})
    assert any('API #02 응답' in line and 'generate_final_opinion' in line and '[② 유지]' in line for line in out)
    assert any(line.startswith('02 |') and 'generate_final_opinion' in line for line in out)
    assert any('API #01 응답' in line and 'normalize_observations' in line for line in out)


def test_parts_usage_is_announced_after_response():
    out=[]; view=Viewer(out.append)
    base={'event_id':'e','task_id':'1','node':'check_parts'}
    view.feed({**base,'event':'openai.started','call_id':'a','tool':'parts_agent_turn','parts_call_group':'g'})
    view.feed({**base,'event':'openai.finished','call_id':'a','duration_ms':600,'status':200})
    view.feed({**base,'event':'parts.response_usage','parts_call_group':'g','usage':'discarded_tool_request'})
    assert any('API #01 응답' in line and '0.60초' in line and '용도 판정 대기' in line for line in out)
    assert any('API #01 판정' in line and '[후보 ④]' in line for line in out)


def test_simple_prints_each_call_once_with_late_parts_label():
    from scripts.measurement_view import SimpleViewer
    out=[]; v=SimpleViewer(out.append)
    base={'event_id':'x','task_id':'1','node':'check_parts'}
    v.feed({**base,'event':'openai.started','call_id':'a','tool':'parts_agent_turn','parts_call_group':'g'})
    v.feed({**base,'event':'openai.finished','call_id':'a','duration_ms':620,'status':200})
    v.feed({**base,'event':'parts.response_usage','parts_call_group':'g','usage':'discarded_tool_request'})
    v.feed({**base,'event':'execution.finished','result_type':'DIAGNOSIS_COMPLETED','duration_ms':1000})
    assert sum('01.' in line for line in out)==1
    assert any('0.62초' in line and '개선 후보 ④' in line for line in out)
    assert not any('시작' in line or '누적' in line for line in out)
