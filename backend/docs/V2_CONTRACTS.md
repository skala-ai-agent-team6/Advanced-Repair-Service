# V2 화면·Kafka·RAG·편집자 연동 계약

Swagger /v3/api-docs 및 docs/openapi.json이 HTTP 계약이다. bigint ID는 기존대로 JSON 문자열, revision/cursor는 정수다. 기존 엔드포인트는 유지했다. 요청 예시는 docs/examples/v2-consumer-center.json과 v2-consumer-field.json을 참고한다.

## 화면 담당자

소비자: GET /public/intake-options → POST /public/cases multipart(data JSON + files) → 반환된 caseNumber/lookupKey를 안전하게 보관 → GET /public/cases/{number}에 ConsumerKey Bearer. 키는 URL·로그에 넣지 않는다. 사진 다운로드/초기 재촬영도 같은 키를 요구한다. 접수만으로 진단 시작 안 함.

```json
{"caseNumber":"C-발급UUID","lookupKey":"발급된43자조회키","expiresAt":"서버발급만료시각","status":"RECEIVED","attachmentIds":["101"],"requiresTechnicianReview":true}
```

기사: 기존 접수 목록의 intake_source와 service_type으로 인계 → GET /api/repairs/{id}/work-report → 첨부별 quality GET → 최신 WARNING 확인 → 기존 diagnoses에 attachmentIds. /assignment는 본사만 호출한다. preparation.missing은 배정/연락처/주소 미확인을 표시하며 예약·지도 기능은 없다. /auth/me의 operationsEnabled로 운영 메뉴를 구분한다. 이 값은 UI 표시용이며 서버도 독립 검증한다.

품질 상태: PENDING/RUNNING/ERROR이면 진단 보류. COMPLETED/PASS 사용 가능. COMPLETED/WARNING은 현재 기사와 정확한 latest.id 확인 필요. 교체·재검사 시 이전 확인 금지. LEGACY_UNCHECKED는 이전 자료이며 신규 검사 대기와 구분한다. SSE PHOTO_QUALITY_COMPLETED/ERROR 후 GET 결과를 최신 기준으로 삼는다. 문제 코드와 한국어 안내는 PHOTO_QUALITY.md의 기존 계약 그대로다. 소비자 조회는 상태·issues만 보여 주며 기사 확인 endpoint를 제공하지 않는다.

고객 공개: POST /api/repairs/{id}/customer-report(expectedVersion,kind,causeSummary,plannedWork,sourceRevision)로 초안 → /publish(version). ESTIMATE는 예상 원인·계획, CONFIRMED는 현재 확정 sourceRevision에 근거한 내용이다. /public/cases 응답의 report=null은 미공개이며 내부 초안을 가져와 채우면 안 된다. 공개 진행 상태는 RECEIVED/UNDER_REVIEW/REPAIRING/COMPLETED/CANCELLED다.

실제 보고서: 기존 ReportContent에 replacedParts:[{partId,quantity}] 선택 필드를 추가했다. 없으면 빈 목록. 실제 원인/조치는 필수다. 교체 수량1~100, 최대20줄, 중복 partId·제품 비호환 부품은 거부한다.

## Kafka schemaVersion=2

PR #6 제품 유형 추가 계약과 증분 재조회 절차는 [PRODUCT_TYPE.md](PRODUCT_TYPE.md)를 참고한다.

기존 토픽·키(taskId)·Outbox·eventId 중복 방지를 유지한다. 계약 재생성은 backend에서 `python3 scripts/generate_kafka_contract.py --sync-shared`로 수행한다. backend/docs/kafka-event.schema.json과 kafka-examples.json을 갱신했다. 공유 contract/의 스키마·예시에도 검토한 동일 계약 변경을 반영했다. worker 구현은 변경하지 않았으며 Agent 팀은 엄격해진 출력을 확인해야 한다.

- eventId/executionId/correlationId UUID, repairId/taskId 양의 정수 문자열, inputRevision≥1, sequence≥0. correlationId는 접수와 일치해야 한다. sequence=0은 해당 작업에서 첫 적용 이벤트일 때만 허용한다.
- COMPLETED: summary/repairMethod/modelVersion 비어 있지 않음. candidates≥1, cause/explanation 필수, confidence 유한0~1, rank≥1 정수·중복 불가.
- recommendedParts 0~20, partId 제품 호환·중복 불가, quantity 정수1~100. 추천이 있으면 출처 근거도 필요하다. 근거가 없으면 빈 부품 목록으로 보낸다.
- evidence 각각은 해당 접수 attachmentId 또는 비어 있지 않은 sourceUri/citation이 필요하다. 다른 접수 첨부는 거부한다. 문자열 출처의 실제 진실성/검색 성공 여부는 Agent/RAG가 검증해야 하며 Spring이 근거를 만들지 않는다.
- PHOTO_REQUESTED: round는 순서대로1~3, bodyPart는 PCB/MOTOR/GENERAL, description/checkpoint/requestKey 필수. 기존 wheel 등의 자유 문자열은 이제 거부한다. resume는 같은 task, 새 executionId/inputRevision으로 진행한다. checkpoint는 기존 재분석 계약을 유지한다.
- FAILED: 식별 가능한 errorCode 필수, 선택적 summary는 기사용 task.error_message에도 제공하고 전체 수집 결과는 received_event body에 보존한다. INCONCLUSIVE_AFTER_THIRD_PHOTO는 자동 재시도 대상이 아니다.
- 새 TOOL_EXECUTED agentType은 PCB/SURFACE/BUSINESS/RAG. 과거 MOTOR/SW 기록 조회는 보존한다. MOTOR는 촬영 부위 호환값이며 모터 성능 전용 모델을 뜻하지 않는다.
- confidence·검색 유사도는 실제 고장 확률이 아니다. UI가 확률로 라벨링하면 안 된다. 검색 결과가 없으면 근거를 만들어 성공시켜서는 안 된다.

worker는 SQLite inbox/outbox와 완료 중복 replay, 실행1800초 상한·최종 processing-status를 이미 제공한다. heartbeat/작업회수 메시지 계약은 없으므로 새 heartbeat 프로토콜을 만들지 않았다. Agent 미기동·실제 장애의 장기 관찰은 별도 통합 검증 대상이다.

## RAG 증분 adapter

RAG_SYNC_ENABLED=true인 Spring에서 기존 SERVICE Bearer로 호출한다. RAG 기존 scheduler 기본30초 주기를 재사용할 수 있다. 기존 GET /internal/confirmed-cases는 안전한 필드만 반환하도록 호환 유지했지만 변경 receipt를 기록하지 않으므로 새 상태를 완료 처리하지 않는다.

1. GET /internal/rag/confirmed-changes?after=0&size=100. 첫 응답의 until을 고정한다.
2. items의 document를 documentId(`internal:report:<id>`) 기준으로 실제 임베딩/Qdrant upsert한다. revision 낮은 갱신은 거부하고 같은 버전은 멱등 처리한다.
3. 실제 검색 준비 완료 후 POST /internal/rag/confirmed-changes/{id}/receipt:

```json
{"requestKey":"처리결과멱등UUID","reportId":"1","revision":2,"status":"SUCCEEDED"}
```

실패 시 status=ERROR,errorCode=QDRANT_UNAVAILABLE 같은 비민감 코드만 보낸다. 다음 시도는 새 requestKey, 동일 요청 재전송은 같은 requestKey를 쓴다. GET 성공·설정 활성화만으로 SUCCEEDED를 보내면 안 된다.

4. nextCursor와 같은 until로 다음 페이지를 조회한다. hasMore=false 후 nextCursor를 durable checkpoint로 저장한다. 다음 polling은 until을 빼고 새로운 고정 window를 시작한다. 실패 시 cursor를 앞당기지 않고 다시 읽는다.

journal writer와 최초 high-water 조회는 같은 transaction advisory lock을 사용한다. ID 순서와 commit 순서를 일치시켜 먼저 할당된 미커밋 ID 누락을 방지한다. confirmed_at이 같아도 ID로 정렬한다. 새 확정은 다음 window에 포함된다. 기존 확정 자료는 조회 시 최대500건씩 bootstrap하므로 대량 초기 이관은 여러 주기를 사용한다. report/revision UNIQUE, 동일 report의 documentId 고정. 늦은 이전 버전 receipt는 그 이력만 갱신하고 최신 버전 완료를 바꾸지 않는다. 성공 후 늦은 ERROR도 성공을 취소하지 않는다.

검색 payload는 증상·실제 원인·조치·교체 부품·결과와 사내 출처다. 연락처·주소·내부 소견 필드를 포함하지 않고 저장된 고객 이름/연락처/주소 문자열과 이메일/휴대전화 패턴을 제거한다. 자유 텍스트에 임의로 쓴 미등록 개인정보의 모든 표현을 판별하는 도구는 아니므로 작성 시 개인정보를 쓰지 않는 업무 규칙도 필요하다.

scripts/rag_sync_adapter.py는 실제 HTTP transport와 주입형 indexer 계약을 제공한다. indexer가 searchReady=true를 반환해야 성공 receipt를 쓴다. 기본/가짜 indexer를 붙여 실제 성공을 주장하지 않는다. scripts/test_rag_sync_adapter.py의 mock은 계약 검증 전용이다. checkpoint 영속화와 indexer 구현은 RAG 팀 책임이다. 목표: 확정10건 각각120초 이내 실제 검색 결과에서 최신 revision 확인. 실제 RAG 연결 전 미검증이다.

## 편집자 AI 최소 계약·미정 항목

POST /internal/reports/{id}/edit-proposals에 requestKey,targetRevision,authorService,proposed(ReportContent)를 보낸다. authorService는 기존 공유 SERVICE 토큰으로 인증된 호출자가 제공한 작성 주체 메타데이터이며 별도 서비스별 신원 인증이 아니다. GET /api/reports/{id}/edit-proposals로 원본·제안·상태를 조회한다. POST /api/reports/{id}/edit-proposals/{proposalId}/decision의 action=ACCEPT/REJECT는 기사만 호출한다. ACCEPT는 새 초안이며 확정·고객 공개·RAG 갱신은 별도다. targetRevision이 최신이 아니면409다.

미정: 모델/입력 프롬프트·AI 원본 표현, 호출 트리거, timeout/재시도·비용, 수정 가능 필드, 내용 안전성·인적 검토 책임, 서비스별 인증, 개인정보 보관 정책. 이번에는 외부 AI를 구현하거나 호출하지 않았다.

## 운영 재처리

GET /api/operations/reprocessing는 실패 작업·DLT 이벤트·Outbox 시도/다음 시각/최종 상태를 보여 준다. QUALITY_MANAGER만으로 접근할 수 없고 app_user.operations_enabled=true가 별도로 필요하다. 기존 사용자에 자동 부여하지 않는다.

수동 RESULT retry는 원래 received_event의 DLT와 현재 task/execution/revision/실패 상태를 검증한다. 원본을 고치지 않고 별도 reprocess_attempt를 먼저 기록한다. replay 중에만 중복 방지 disposition을 전환하고 정상 반영되면 APPLIED, 원래 DLT는 original_disposition에 남긴다. 실패하면 원래 상태를 롤백하고 시도만 ERROR로 기록한다. requestKey 멱등 및 이벤트별 동시 직렬화로 같은 효과를 두 번 반영하지 않는다. 잘못된 AI 결과를 운영자가 강제로 통과시킬 수 없다.

OUTBOX retry는 terminal_failure와 현재 execution/revision을 확인하고 같은 eventId의 발행을 재개한다. SUCCEEDED인 수동 시도는 재큐잉 관리 작업이 완료됐다는 뜻이며 Kafka 전달 성공은 published_at으로 확인한다. 각 발행 주기 자동8회, 수동은 원래 이벤트당3회 상한. 재처리 생성 뒤 프로세스가 중단되어 QUEUED면 조회 이력의 같은 requestKey로 요청을 재개한다. 무조건 새 key를 만들어 상한을 우회하지 않는다.

자동 재진단은 기본 꺼짐. 켜면 AGENT_TEMPORARY_FAILURE/SERVICE_UNAVAILABLE만 대상으로 기존 최대4작업(재진단3회)을 유지한다. 원본 선택 첨부·정확한 검사/확인 스냅샷과 photo_request_count를 보존한다. 사진이 제외/교체/재검사되었으면 자동 재진단하지 않는다. 의미상 최종 실패나 잘못된 계약을 자동으로 반복하지 않는다.

형식이 깨져 eventId/taskId를 식별할 수 없는 메시지는 기존 Kafka DLT/수신 로그로 추적하며 정상 업무 이벤트처럼 수동 적용하지 않는다. 생산 측 계약을 수정하고 식별 가능한 올바른 이벤트로 전달해야 한다.
