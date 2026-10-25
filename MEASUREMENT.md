# V1 체크포인트 버전 측정

## 최적화 항목 번호 — 2026-10-25 기준 정정

| 번호 | 호출 | 이번 작업 범위 |
|---|---|---|
| ① | 워커 `split_text` 소견 분리 GPT | 내가 제거할 대상. observation MCP는 유지 |
| ② | RAG `generate_final_opinion` 최종 소견 GPT | 유지. 이번 제거 대상에서 제외 |
| ③ | RAG 내부 중복 소견 정규화 GPT | 팀원 개선 항목. 최신 dev는 기존 정규화 결과를 재사용하며, 이 V1 측정에는 중복 호출이 남아 있음 |
| ④ | 부품 조회 한도 뒤 버려지는 GPT 도구 요청 응답 | 내가 개선할 대상. 필요한 최종 요약은 유지하므로 API 1회 감소를 보장하지 않음 |

호출 앞의 `01.`, `02.`는 실행 순서이고, ①~④는 위 항목 번호다.
기존 로그의 ‘후보 ③(버려진 부품 응답)’은 ④로 정정했다. API 횟수·시간·원본 JSONL은 변경하지 않았다. 최적화 코드는 아직 적용하지 않았다.


기준 커밋: `0333554`. 브랜치: `agent/feat/v1-api-measurement`.
진단·체크포인트·부품 판단은 바꾸지 않고 측정만 추가했다. split_text 제거와 부품 루프 최적화는 아직 적용하지 않았다.

## 기록하는 것

| 항목 | 로그 | 의미 |
|---|---|---|
| 실제 OpenAI 요청 | `openai.started` | HTTP 전송 시도 1회마다 기록. 429 이후 재전송도 각각 1회 |
| 응답·실패·시간 | `openai.finished`, `openai.failed` | HTTP 상태, 모델, 걸린 시간, 오류 종류. 429/503은 finished의 status로 확인 |
| SDK 재시도 | `sdk_retry` | SDK 재전송 번호. 0은 첫 시도 |
| Agent 재시도 | `tool.retry`, `attempt` | 하네스가 함수를 재실행한 횟수. SDK 재시도와 구분 |
| 노드별 시간 | `node.finished.duration_ms` | 사진 분류·소견·분석·RAG·리포트 등 기존 노드별 시간 |
| 그래프 실행 시간 | `run.finished.duration_ms` | 하네스가 그래프 실행을 감싼 구간 |
| 이벤트 처리 시간 | `execution.finished.duration_ms` | handle 진입부터 결과 전송 후 반환까지. 대기열 체류·화면 표시 시간은 제외 |
| 작업 연결 | `task_id`, `event_id` | 추가 입력은 같은 작업의 별도 이벤트. 사람의 제출 대기시간은 제외 |
| 계측 프로세스 | `measurement.ready` | 계측이 실제로 활성화된 Python 프로세스 |

HTTP 전송 시도 수는 서버가 처리·과금한 횟수와 같다고 보장할 수 없다. 네트워크 연결 실패도 시도에 포함한다.
병렬 API/노드 시간의 합은 전체 처리 시간이 아니다. urllib 및 스트리밍 요청은 응답 헤더 도착 시간만 측정하며 `latency_scope=response_headers`로 구분한다.
기존 리포트의 `llm.calls`는 예산 예약 카운터이므로 실제 요청 수 비교에는 새 JSONL을 사용한다.
프롬프트, 사진, 응답 본문, API 키, 인증 헤더는 새 측정 로그에 기록하지 않는다.

## 실행

현재 다른 폴더에서 실행 중인 서버와 섞어 측정하지 않는다. 먼저 그 실행 환경을 정상 종료하고 아래 명령을 실행한다. 실행 중인 워커만 새로 띄우면 기존 MCP의 내부 OpenAI 요청은 측정되지 않는다.

```bash
cd /Users/beeyaaa/Workspace/SK-SKALA/Advanced-Repair-Service-checkpoint
DEMO_FORCE_PHOTO=0 ./measure.sh v1 bash run.sh
```

위 명령은 기존 run.sh를 그대로 사용한다. 이 스크립트는 사진 재요청 시 자료를 자동 제출하는 `auto_photo.py`도 실행한다. 직접 재입력 시간을 확인하려면 자동 제출 프로세스를 종료한 상태에서 진행해야 한다. V1/V2 비교 시 강제 사진 요청·자동 제출 여부를 동일하게 맞춘다.

새 터미널에서 실시간 로그:

```bash
cd /Users/beeyaaa/Workspace/SK-SKALA/Advanced-Repair-Service-checkpoint
tail -f "$(cat logs/measurements/latest.path)"
```

화면에서 동일한 사진·소견으로 신규 접수하고 진단을 진행한다. 완료 후 집계:

```bash
.venv/bin/python scripts/measurement_summary.py
# 한 작업만 보기
.venv/bin/python scripts/measurement_summary.py --task-id 실제작업ID
```

`actual_openai_attempts`가 관측된 실제 요청 시도 수다. `groups`는 작업·노드·도구·모델별 집계다. `execution_results`에서 처리 시간·결과를 확인한다. 로그는 매번 새 파일로 생성되며 `latest.path`는 가장 최근 실행을 가리킨다.

진단 리포트는 기존대로 `worker/reports/`의 `task-…_고장리포트.md`와 `.json`에 저장한다. JSONL은 리포트와 별도다.

## MCP 포함 범위

measure.sh에서 시작한 Python 프로세스에 sitecustomize를 주입해 httpx/httpx2/urllib 요청을 관측한다. 기존 프로그램의 API 요청·응답을 변경하거나 추가 API를 호출하지 않는다.
HTTP `/mcp` 요청에 작업 식별 헤더를 붙이고, FastMCP 내부 OpenAI 호출은 그 식별자를 읽어 기록한다. 별도 실행한 MCP, 원격 MCP, 다른 HTTP 라이브러리·별도 OpenAI 호스트는 자동 측정 범위 밖이다. 사용자 지정 호스트는 `OPENAI_BASE_URL`이 일치해야 한다.
Spring을 거쳐 별도로 시작한 업무 MCP 요청처럼 식별자가 전달되지 않은 호출은 `UNASSIGNED`로 남는다. 전체 세션 카운트에는 포함하지만 특정 진단에 임의로 배정하지 않는다. 따라서 실행 세션에는 비교할 진단만 수행하는 것이 좋다.

## 검증 및 현재 제한

- HTTP 모의 응답으로 실제 OpenAI SDK의 429→재시도→200 요청 횟수 검증.
- 동기·비동기·urllib 호출, 연결 실패, 병렬 작업 구분, MCP 수신 헤더, 자식 프로세스 활성화, 민감정보 미기록 검증.
- 측정 활성화 상태에서 체크포인트·재개 테스트 실행. 모델은 모의 응답이므로 실제 API 요청 0회가 정상.
- 실제 모델 성능 수치는 아직 측정하지 않았다. 현재 실행 중인 다른 폴더의 서비스와 혼합하지 않았다.
- 원본 테스트에도 processing-status 이벤트를 diagnosis 이벤트로 검증하는 실패가 존재한다. 측정 패치와 분리해서 기록하며, 테스트 전체 통과로 표현하지 않는다.

검증 결과: 측정·체크포인트·재개 선택 테스트 26개 통과. 측정 활성화 체크포인트·재개 테스트 17개 통과. 전체 비교는 원본 123 통과/15 실패, 최초 측정 테스트 5개 추가 시 128 통과/동일한 15 실패였다. 이후 추가한 측정 테스트 4개도 선택 테스트에 포함해 통과했다.

## 사진·소견 자동 접수

백엔드 품질검사가 켜져 있으면 접수만으로 진단이 시작되지 않는다. demo.py는 품질검사 대기 → 사진 선택 → 진단 시작 API를 호출한다.

```bash
# 샘플 사진으로 신규 접수. PCB 샘플의 저해상도 경고를 확인하고 그대로 사용한다.
.venv/bin/python -u integration/demo.py complete --accept-quality-warnings
# 이미 접수된 건을 이어서 실행. 기존 진단이 있으면 다시 시작하지 않고 결과를 조회한다.
.venv/bin/python -u integration/demo.py complete --repair-id 6 --accept-quality-warnings
```

`--accept-quality-warnings`를 생략하면 경고 사진이 있을 때 안내 후 종료한다. 오류·미완료 검사에는 경고 확인 옵션이 적용되지 않는다. 정상 품질의 사진은 확인 옵션 없이 진행한다.

## 보기 쉬운 실시간 로그 (권장)

```bash
.venv/bin/python scripts/measurement_view.py --watch
```

JSON 대신 `단계 | OpenAI 요청 수 | 단계 실행 시간`을 표시하고, 종료 시 전체 API 횟수·오류 횟수·처리 시간을 출력한다. 시작할 때 최근 이벤트를 보여준 뒤 새 이벤트를 따라간다. `--task-id 3`으로 작업을 지정하거나 `--all`로 과거 전체를 볼 수 있다. 서버를 다시 시작해 측정 파일이 바뀌면 뷰어도 재실행한다. `Ctrl+C`는 뷰어만 종료한다. OpenAI를 호출하지 않는 이미지 모델 분석 단계는 API 0회로 표시되며, 이는 분석 미실행이라는 뜻이 아니다.

### 최적화 후보 표시

- 후보 ① `split_text` GPT 요청.
- ② 유지: RAG의 `generate_final_opinion` GPT 요청. HTTP 계측 시 실제 호출 스택의 함수명으로 식별한다. RAG 내부 정규화와 구분한다.
- ③ 팀원 개선: RAG 내부 중복 정규화. 워커의 첫 정규화와 구분한다.
- 후보 ④ 부품 도구 호출 한도를 이미 소진한 뒤 GPT가 도구 요청을 반환해 사용되지 않은 응답. `parts.response_usage`로 판별하며 정상 요약·정상 도구 선택은 유지로 표시한다.

①~④의 실제 HTTP 요청 횟수·API 시간을 표시한다. ②는 유지, ③은 팀원 개선으로 구분하며 표시 항목 합계는 제거 대상 합계가 아니다. 과거 로그에 함수/응답 사용 정보가 없으면 판별 불가로 표시한다. 후보 시간 합은 예상 총 처리시간 절감량이 아니다. 특히 ④를 도구 없는 요약 호출로 바꾸면 호출 횟수가 동일할 수도 있다. 호출 제거·루프 변경은 아직 하지 않았다.

### 간단 로그 기본값

`measurement_view.py --watch`는 호출당 한 줄(한국어 작업명·API 시간·후보 표시)과 마지막 전체 요약만 출력한다. 기존 내부 함수명·단계 시간 표가 필요하면 `--detail`을 추가한다. API 0회인 사진 분석은 간단 모드의 호출 목록에 표시하지 않으며, 해당 단계 실행 여부는 상세 모드에서 확인한다.
