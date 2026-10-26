"""실시간 단계별 OpenAI 호출 수·실행 시간을 사람이 읽는 형태로 출력한다."""
import argparse
import json
from pathlib import Path
import time

NAMES = {
    'load_input': '입력 준비', 'load_photos': '사진 불러오기',
    'classify_photos': '사진 분류', 'split_text': '소견 분석',
    'pick_mcps': '분석 도구 선택', 'pcb_mcp': 'PCB 분석',
    'mech_mcp': '기계·찌그러짐 분석', 'rag_mcp': 'RAG 사례 검색',
    'decide': '진단 판단', 'judge': '진단 판단',
    'check_parts': '부품·재고 확인', 'report': '리포트 생성',
    'request_photo': '추가 사진 요청', 'request_input': '추가 자료 요청',
}


class Viewer:
    def __init__(self, write=print):
        self.write = write
        self.jobs = {}
        self.calls = {}
        self.seen_ends = set()
        self.details = {}
        self.parts_usage = {}

    def feed(self, row):
        event = row.get('event', '')
        eid = row.get('event_id')
        if not eid:
            if event == 'openai.started':
                self.write('[작업 미지정] OpenAI 요청 1회 — 작업별 합계에서 제외')
            return
        if eid not in self.jobs:
            self.jobs[eid] = {'task': row.get('task_id', '?'), 'nodes': {}, 'calls': 0, 'errors': 0}
            self.write(f"\n━━ 작업 {row.get('task_id', '?')} | 이벤트 {eid[:8]} ━━")
        job = self.jobs[eid]
        node = row.get('node') or 'unknown'
        tag = f"[작업 {job['task']} · {eid[:8]}]"
        if event == 'openai.started':
            cid = row['call_id']
            if cid in self.calls:
                return
            self.calls[cid] = (eid, node)
            self.details[cid] = {'tool': row.get('tool', '이름 미기록'), 'model': row.get('model', '?'), 'ms': None, 'status': '진행 중', 'operation': row.get('api_operation'), 'group': row.get('parts_call_group'), 'number': job['calls'] + 1}
            stage = job['nodes'].setdefault(node, {'calls': 0, 'ms': 0, 'runs': 0})
            stage['calls'] += 1
            job['calls'] += 1
            detail = self.details[cid]
            self.write(f"{tag}   API #{detail['number']:02} 시작 | {NAMES.get(node, node)} / {self.call_name(detail)}")
        elif event == 'parts.response_usage':
            self.parts_usage[row['parts_call_group']] = row['usage']
            for cid, detail in self.details.items():
                if detail['group'] == row['parts_call_group'] and self.calls[cid][0] == eid:
                    self.write(f"{tag}   API #{detail['number']:02} 판정 | {self.candidate(detail)[1]}")
        elif event in ('openai.finished', 'openai.failed'):
            cid = row['call_id']
            if cid in self.seen_ends:
                return
            self.seen_ends.add(cid)
            if cid in self.details:
                detail = self.details[cid]
                detail.update(ms=row.get('duration_ms'), status=row.get('status') or row.get('error_type', '?'))
                call_node = self.calls[cid][1]
                seconds = f"{detail['ms']/1000:.2f}초" if detail['ms'] is not None else '시간 미기록'
                mark = ('용도 판정 대기' if detail['tool'] == 'parts_agent_turn' and detail['group'] not in self.parts_usage else self.candidate(detail)[1])
                self.write(f"{tag}   API #{detail['number']:02} 응답 | {NAMES.get(call_node, call_node)} / {self.call_name(detail)} | {seconds} | {mark}")
            if event == 'openai.failed' or (row.get('status') or 0) >= 400:
                job['errors'] += 1
                self.write(f"{tag}   API 오류: {row.get('status') or row.get('error_type', '알 수 없음')}")
        elif event == 'node.started':
            job['nodes'].setdefault(node, {'calls': 0, 'ms': 0, 'runs': 0})
            self.write(f"{tag} 시작  {NAMES.get(node, node)}")
        elif event == 'node.finished':
            stage = job['nodes'].setdefault(node, {'calls': 0, 'ms': 0, 'runs': 0})
            stage['ms'] += row.get('duration_ms', 0)
            stage['runs'] += 1
            self.write(f"{tag} 종료  {NAMES.get(node, node)} | API 누적 {stage['calls']}회 | 이번 단계 {row.get('duration_ms', 0)/1000:.2f}초")
        elif event == 'tool.retry':
            self.write(f"{tag} 재시도  {row.get('tool')} · {row.get('next_attempt')}번째 시도")
        elif event in ('node.failed', 'node.paused'):
            self.write(f"{tag} {'오류' if event == 'node.failed' else '입력 대기'}  {NAMES.get(node, node)}")
        elif event in ('execution.finished', 'execution.failed'):
            self.write(f"\n{tag} 결과: {row.get('result_type') or row.get('error_type') or event}")
            self.write('단계 | OpenAI 요청 수 | 단계 실행 시간(누적)')
            self.write('─' * 55)
            for name, stage in job['nodes'].items():
                duration = f"{stage['ms']/1000:.2f}초" if stage['runs'] else '완료 시간 없음'
                self.write(f"{NAMES.get(name, name)} | {stage['calls']}회 | {duration}")
            self.write('─' * 55)
            self.write(f"전체 API {job['calls']}회 · API 오류 {job['errors']}회 · 전체 처리 {row.get('duration_ms', 0)/1000:.2f}초")
            self.write('※ 재시도·계측된 MCP 내부 요청 포함. 병렬 단계 시간의 합은 전체 시간과 다릅니다.')
            self.write('\n호출별 상세 — 단계 전체 시간이 아닌 각 API 요청 시간')
            self.write('번호 | 단계 / 호출 | API 시간 | 검토 표시')
            number = 0
            candidates = {key: [] for key in ('split_text', 'rag_final_opinion', 'rag_normalization', 'discarded_parts')}
            unknown = set()
            for cid, (call_eid, call_node) in self.calls.items():
                if call_eid != eid:
                    continue
                number += 1
                detail = self.details[cid]
                seconds = f"{detail['ms']/1000:.2f}초" if detail['ms'] is not None else '응답 대기'
                key, mark = self.candidate(detail)
                if key:
                    candidates[key].append(detail)
                if detail['tool'] == 'call_rag_mcp' and not detail['operation']:
                    unknown.update(('rag_final_opinion', 'rag_normalization'))
                if detail['tool'] == 'parts_agent_turn' and detail['group'] not in self.parts_usage:
                    unknown.add('discarded_parts')
                self.write(f"{number:02} | {NAMES.get(call_node, call_node)} / {self.call_name(detail)} | {seconds} | {mark}")
            self.write('\n①~③ 및 별첨(*) 항목별 API 시간 (* 보류·유지·② 팀원 개선 포함)')
            labels = {'split_text': '① split_text', 'rag_final_opinion': '* RAG 최종 소견',
                      'rag_normalization': '② RAG 중복 소견 정규화',
                      'discarded_parts': '③ 부품 확인에서 버려진 응답'}
            for key, items in candidates.items():
                if key in unknown:
                    self.write(f"{labels[key]} | 판별 불가: 이전 로그에 식별 정보 없음")
                else:
                    elapsed = sum(item['ms'] or 0 for item in items)
                    pending = sum(item['ms'] is None for item in items)
                    self.write(f"{labels[key]} | {len(items)}회 | {elapsed/1000:.2f}초" + (f" (미완료 {pending}회 제외)" if pending else ''))
            known = [item for key, items in candidates.items() if key not in unknown for item in items]
            self.write(f"표시 항목 합계 (절감량 아님): {len(known)}회 · API 시간 {sum(item['ms'] or 0 for item in known)/1000:.2f}초 (미확인·미완료 시간 제외)")
            self.write('※ ③ 정상 요약은 유지. 요약 호출로 대체하면 호출 수가 줄지 않을 수 있습니다.')
            self.write('※ 같은 이름도 요청별로 별도 표시. 이 시간의 합을 그대로 절감 시간으로 볼 수는 없습니다.\n')


    @staticmethod
    def call_name(detail):
        if detail['operation'] == 'rag_final_opinion':
            return 'generate_final_opinion (RAG 최종 소견)'
        if detail['tool'] == 'call_rag_mcp' and detail['operation'] == 'normalize_observation':
            return 'normalize_observations (RAG 내부 정규화)'
        return detail['tool']

    def candidate(self, detail):
        if detail['tool'] == 'split_text':
            return 'split_text', '[후보 ①] 불필요한 소견 분리'
        if detail['operation'] == 'rag_final_opinion':
            return 'rag_final_opinion', '[* 보류·유지] RAG 최종 소견'
        if detail['tool'] == 'call_rag_mcp' and detail['operation'] == 'normalize_observation':
            return 'rag_normalization', '[② 팀원 개선] RAG 중복 소견 정규화'
        if detail['tool'] == 'parts_agent_turn':
            usage = self.parts_usage.get(detail['group'])
            if usage == 'discarded_tool_request':
                return 'discarded_parts', '[후보 ③] 한도 도달 후 버려진 응답'
            if usage == 'summary':
                return None, '유지: 부품 확인 요약'
            if usage == 'tool_request':
                return None, '유지: 부품 도구 선택'
            return None, '판별 불가: 이전 로그'
        return None, '유지'


class SimpleViewer(Viewer):
    """호출당 한 줄. 단계 전체 시간·내부 식별자는 상세 모드에만 표시."""
    def __init__(self, write=print):
        super().__init__(lambda _: None)
        self.output = write
        self.printed = set()
        self.heading = None
        self.started_jobs = set()

    def show_call(self, cid):
        if cid in self.printed or cid not in self.seen_ends:
            return
        eid, node = self.calls[cid]
        d = self.details[cid]
        if d['tool'] == 'parts_agent_turn' and d['group'] and d['group'] not in self.parts_usage:
            return
        if self.heading != (eid, node):
            self.output(f"\n[{NAMES.get(node, node)}]")
            self.heading = (eid, node)
        names = {'split_text':'소견 분리','normalize_observation':'소견 정규화',
                 'write_report':'진단 리포트 생성','translate_cases':'사례 한국어 번역'}
        name = names.get(d['tool'], d['tool'])
        if d['tool'] == 'call_rag_mcp':
            name = {'rag_final_opinion':'최종 소견 생성','normalize_observation':'검색용 소견 정규화'}.get(d['operation'],'RAG 내부 호출(이전 로그)')
        if d['tool'] == 'parts_agent_turn':
            name = {'summary':'부품 확인 요약','tool_request':'조회 도구 선택',
                    'discarded_tool_request':'추가 조회 요청'}.get(self.parts_usage.get(d['group']),'부품 확인(용도 미확인)')
        key, _ = self.candidate(d)
        mark = {'split_text':' ← 제거 후보 ①','rag_final_opinion':' ← * 보류·유지',
                'rag_normalization':' ← ② 팀원 개선: 중복 정규화',
                'discarded_parts':' ← 개선 후보 ③: 한도 초과로 폐기'}.get(key,'')
        error = '' if d['status'] == 200 else f" · 응답 {d['status']}"
        self.output(f"  {d['number']:02}. {name}  {d['ms']/1000:.2f}초{mark}{error}")
        self.printed.add(cid)

    def feed(self, row):
        super().feed(row)
        eid = row.get('event_id')
        if not eid:
            return
        if eid not in self.started_jobs:
            self.output(f"\n━━ 작업 {self.jobs[eid]['task']} ━━")
            self.started_jobs.add(eid)
        if row.get('event') in ('openai.finished','openai.failed'):
            cid=row['call_id']
            if cid in self.calls:
                self.show_call(cid)
        elif row.get('event') == 'parts.response_usage':
            for cid, d in self.details.items():
                if d['group'] == row['parts_call_group']:
                    self.show_call(cid)
        elif row.get('event') in ('execution.finished','execution.failed'):
            for cid,(event_id,_) in self.calls.items():
                if event_id == eid:
                    self.show_call(cid)
            job=self.jobs[eid]
            status={'DIAGNOSIS_COMPLETED':'완료','PHOTO_REQUESTED':'추가 사진 대기','DIAGNOSIS_FAILED':'진단 실패'}.get(row.get('result_type'),'실행 실패')
            self.output(f"\n{status} · OpenAI {job['calls']}회 · 전체 {row.get('duration_ms',0)/1000:.2f}초 · API 오류 {job['errors']}회")


def read_rows(path):
    rows = []
    with path.open() as stream:
        while True:
            offset = stream.tell()
            line = stream.readline()
            if not line or not line.endswith('\n'):
                return rows, offset
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', nargs='?')
    parser.add_argument('--detail', action='store_true', help='단계별 시간·원본 함수명·전체 집계 표시')
    parser.add_argument('--watch', action='store_true', help='새 로그를 실시간으로 계속 표시')
    parser.add_argument('--task-id', help='특정 작업만 표시')
    parser.add_argument('--all', action='store_true', help='기존 모든 작업 표시 (기본: 최근 이벤트)')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    path = Path(args.file) if args.file else Path((root/'logs/measurements/latest.path').read_text().strip())
    print(f'측정 로그: {path}\nAPI는 OpenAI HTTP 요청 시도 수입니다. 모델을 호출하지 않는 단계는 0회입니다.', flush=True)
    viewer = (Viewer if args.detail else SimpleViewer)(lambda text: print(text, flush=True))
    rows, offset = read_rows(path)
    filtered = [r for r in rows if not args.task_id or str(r.get('task_id')) == args.task_id]
    last = next((r.get('event_id') for r in reversed(filtered) if r.get('event_id')), None)
    for row in filtered:
        if args.all or args.task_id or row.get('event_id') == last:
            viewer.feed(row)
    if not args.watch:
        return
    print('새 진단 대기 중… (Ctrl+C: 로그 보기만 종료)', flush=True)
    try:
        with path.open() as stream:
            stream.seek(offset)
            while True:
                position = stream.tell()
                line = stream.readline()
                if not line or not line.endswith('\n'):
                    stream.seek(position)
                    time.sleep(0.3)
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not args.task_id or str(row.get('task_id')) == args.task_id:
                    viewer.feed(row)
    except KeyboardInterrupt:
        print('\n로그 보기 종료. 서버는 계속 실행 중입니다.')


if __name__ == '__main__':
    main()
