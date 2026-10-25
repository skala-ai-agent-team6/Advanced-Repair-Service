# 실제 API 부품 한도 경계 테스트

## 최적화 항목 번호 — 2026-10-25 기준 정정

| 번호 | 호출 | 이번 작업 범위 |
|---|---|---|
| ① | 워커 `split_text` 소견 분리 GPT | 내가 제거할 대상. observation MCP는 유지 |
| ② | RAG 내부 중복 소견 정규화 GPT | 팀원 개선 항목. 최신 dev는 기존 정규화 결과를 재사용하며, V1 전체 진단에는 중복 호출이 남아 있음 (부품만 테스트는 미실행) |
| ③ | 부품 조회 한도 뒤 버려지는 GPT 도구 요청 응답 | 내가 개선할 대상. 필요한 최종 요약은 유지하므로 API 1회 감소를 보장하지 않음 |

**별첨(*) — RAG 최종 소견 GPT:** 기존에는 제거 후보였으나 현재는 유지한다. 최신 코드에서 리포트 입력에 전달되므로 제거 효과·품질을 별도 검증하기 전까지 이번 최적화 대상에서 제외한다.

호출 앞의 `01.`, `02.`는 실행 순서이고, ①~③ 및 별첨(*)은 위 항목 번호다.
항목 번호를 ①~③으로 통일하고 RAG 최종 소견은 별첨(*)으로 분리했다. API 횟수·시간·원본 JSONL은 변경하지 않았다. 최적화 코드는 아직 적용하지 않았다.


실행: 2026-10-24T18:56:07+09:00

**실제 OpenAI API와 실행 중인 업무 MCP를 호출했다. 모의 응답은 사용하지 않았다.**

## 재현 조건

- 기존 check_parts 루프와 4회 한도를 유지했다.
- 이 별도 테스트 프로세스에서만 tool_choice=get_part_availability, parallel_tool_calls=false를 지정했다. 매번 실제 모델이 도구 인자를 생성한다.
- 따라서 자연스러운 운영 입력에서 우연히 발생한 사례가 아니라, 도구 요청을 강제한 실제 API 경계 테스트다.
- 정상 완료했던 작업 10의 저장된 사진 분석 근거를 재사용했다. 사진 분석·소견·RAG를 새로 실행한 전체 E2E 측정은 아니다.
- 후속 리포트는 실제 LLM으로 생성했다. 사례 DB 저장은 껐으며 Spring에 새 진단을 등록하지 않았다.
- 운영 프롬프트·루프·최적화는 변경하지 않았다.

## 결과

- 실제 부품 GPT 요청: 5회
- 실제 업무 MCP 조회: 4회
- 한도 때문에 버려진 응답: 1회
- 리포트 등을 포함한 실제 OpenAI 요청: 6회
- API 오류: 0회
- 전체 테스트 시간: 7.37초
- 최종 결과: DIAGNOSIS_COMPLETED

## 실제 호출 로그

| 단계 | 실제 요청 | API 시간 | HTTP 상태 | 응답 사용 |
|---|---:|---:|---:|---|
| check_parts | 1 | 0.930초 | 200 | tool_request |
| check_parts | 2 | 0.609초 | 200 | tool_request |
| check_parts | 3 | 0.631초 | 200 | tool_request |
| check_parts | 4 | 0.724초 | 200 | tool_request |
| check_parts | 5 | 0.688초 | 200 | discarded_tool_request |
| report | 6 | 3.284초 | 200 | 리포트 생성 |

## 해석

5번째 실제 GPT 응답도 도구를 요청했지만 기존 루프는 이미 도구 4회를 사용해 이를 폐기했다. 후보 ③의 실제 응답 시간이 위 표의 discarded_tool_request 행이다.
최적화 후 마지막 호출을 정상 요약으로 대체하면 5회→5회일 수 있다. 이 테스트로 API 횟수 감소나 전체 절감 시간을 주장하지 않는다.
① split_text와 * RAG 최종 소견은 이번 부품 집중 테스트 범위가 아니다.

## 원본 증거

- [API 원본 JSONL](api.jsonl)
- [업무 MCP 반환 결과](tool-events.json)

## 재실행

```bash
cd /Users/beeyaaa/Workspace/SK-SKALA/Advanced-Repair-Service-checkpoint
uv run --env-file .env python scripts/reproduce_parts_limit_live.py
```
