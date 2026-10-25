"""JSONL에서 실제 요청 수와 시간 집계. 프롬프트/응답 본문은 읽거나 출력하지 않는다."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path


def summarize(rows):
    calls = {r['call_id']: r for r in rows if r['event'] == 'openai.started'}
    ends = {r['call_id']: r for r in rows if r['event'] in ('openai.finished', 'openai.failed')}
    executions = [r for r in rows if r['event'] in ('execution.finished', 'execution.failed')]
    groups = defaultdict(lambda: {'requests': 0, 'sdk_retries': 0, 'http_errors': 0, 'transport_errors': 0, 'unfinished': 0, 'request_ms_sum': 0})
    for key, start in calls.items():
        label = f"{start.get('task_id', 'UNASSIGNED')} / {start.get('node', 'unknown')} / {start.get('tool', 'unknown')} / {start.get('model')}"
        g = groups[label]
        g['requests'] += 1
        g['sdk_retries'] += int(str(start.get('sdk_retry', '0')) not in ('0', '', 'None'))
        end = ends.get(key)
        if not end:
            g['unfinished'] += 1
            continue
        g['transport_errors'] += int(end['event'] == 'openai.failed')
        g['http_errors'] += int((end.get('status') or 0) >= 400)
        g['request_ms_sum'] += end['duration_ms']
    return {'actual_openai_attempts': len(calls), 'groups': dict(groups),
            'execution_results': executions,
            'node_times': [r for r in rows if r['event'] == 'node.finished'],
            'harness_retries': sum(r['event'] == 'tool.retry' for r in rows),
            'instrumented_processes': [r for r in rows if r['event'] == 'measurement.ready'],
            'note': '관측된 프로세스만 집계. UNASSIGNED는 작업별 귀속 불가. 요청시간 합계는 병렬 실행의 전체 시간이 아님.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('file', nargs='?')
    parser.add_argument('--task-id')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    path = Path(args.file) if args.file else Path((root/'logs/measurements/latest.path').read_text().strip())
    rows = []
    for line in path.read_text().splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue  # 실행 중 마지막 줄 쓰기가 끝나지 않은 경우
        if not args.task_id or row.get('task_id') == args.task_id or row['event'] == 'measurement.ready':
            rows.append(row)
    print(json.dumps(summarize(rows), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
