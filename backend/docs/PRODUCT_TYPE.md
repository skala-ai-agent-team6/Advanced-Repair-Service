# PR #6 제품 유형 전달

2026-10-23. 작업 저장소 Final_Robot-Vacuum-Repair-Agent, 브랜치 backend/feat/product-type. 시작 시 작업 트리는 깨끗했다. Rag_mcp/docs/product_types.md, worker/products.py·graph.py·tools.py·enrichment.py와 Rag_mcp/src/repair_mcp/products.py·sync.py·retrieval.py의 실제 소비 위치를 확인했다.

## 값과 출처

| 기존 구조화 제품 정보 | 전송 값 |
|---|---|
| VACUUM_CLEANER / VACUUM / vacuum | vacuum |
| WASHING_MACHINE / washing_machine | washing_machine |
| AIR_CONDITIONER / air_conditioner | air_conditioner |
| 누락·null·빈 값·UNKNOWN·그 외 미지원 값 | unknown |

Java 코드의 대문자·주변 공백은 정규화하지만 washer, robot_vacuum, robot vacuum, 한글 제품명 등 별칭을 임의 추론하지 않는다. 모델명·증상·소견·AI 결과로 유형을 판단하지 않는다. 기존 product_model.appliance_type을 사용하고 제품 조회/Catalog에서 product_type을 제공한다. 소비자·기사 접수 모두 같은 Catalog 매핑을 저장한다. 클라이언트가 보낸 임의 유형으로 덮어쓰지 않는다.

## 전달·보존

V9__freeze_product_type.sql에서 repair_case.product_type을 추가하고 네 허용값을 CHECK한다. 접수 당시 값을 저장하므로 이후 모델 메타데이터가 바뀌어도 같은 접수의 재개·재시도·실제 확정 사례 유형은 유지된다. 기존 접수는 스냅샷의 product_type → productType → appliance_type → 연결된 모델의 appliance_type 순서로 확인한다. 명시된 미지원/unknown 값은 다른 소견으로 추측해 채우지 않는다. 원본 스냅샷은 바꾸지 않는다.

새 모델에서 분류를 생략하면 vacuum으로 지정되지 않도록 product_model.appliance_type 기본값을 UNKNOWN으로 변경한다. 기존 모델 분류는 일괄 덮어쓰지 않는다. 명백한 개발용 청소기 R1/R2 seed에는 VACUUM_CLEANER를 명시했다. 신규 테이블은 없다. 운영 DB에 이번 작업 중 V9를 실행하지 않았으며 Testcontainers에서만 검증한다.

Kafka schemaVersion=2 유지. DIAGNOSIS_REQUESTED/DIAGNOSIS_RESUMED 공통 입력에서 아래 정식 위치를 제공한다.

```json
{"payload":{"repair":{"product_type":"washing_machine","product_snapshot":{"product_type":"washing_machine","appliance_type":"WASHING_MACHINE"}}}}
```

위 JSON은 발췌다. 나머지 기존 필수 필드는 그대로다. Agent가 함께 검사하는 스냅샷 product_type/productType도 응답 사본에서 정식 값과 일치시켜 모순을 방지한다. 원본 DB 스냅샷은 보존한다. 새 자동 재시도 명령은 같은 접수의 고정값을 읽는다. 수동 Outbox 재처리는 원래 payload/eventId를 그대로 유지하고 RESULT 재처리는 원래 이벤트와 접수 연결을 유지한다.

이미 발행했거나 발행을 시도한 기존 Outbox JSON은 변경하지 않는다. 같은 eventId의 내용을 변경하면 Agent 중복 처리 계약을 위반할 수 있기 때문이다. 제품값이 없는 구형 명령은 PR #6 Agent 규칙대로 unknown으로 읽힌다. 이후 새 resume/retry 명령에는 V9 접수 값이 들어간다.

기존 청소기 전용 시작 차단은 PR #6의 PCB·외형 공통 분석/제품별 RAG 전달에 맞춰 제거했다. 세탁기·에어컨 메타데이터와 unknown도 전달할 수 있지만 새로운 제품 전용 AI 모델을 구현하거나 그 정확도를 검증한 것은 아니다. unknown이면 RAG 사례 검색은 product_type_required로 비우고 기존 공통 처리 계약을 따른다.

## 확정 사례와 RAG 증분

GET /internal/confirmed-cases 및 기존 /internal/fault-cases 별칭은 각 배열 항목 최상위 product_type을 제공한다. content 안에만 넣지 않는다.

```json
[{"report_id":"101","case_id":"50","product_type":"air_conditioner","confirmed_revision":1,"confirmed_at":"2026-10-23T03:00:00Z","content":{"actualCause":"가상 원인","actualAction":"가상 조치","repairSuccessful":true,"outcome":"FIXED"}}]
```

증분 GET /internal/rag/confirmed-changes는 items[*].product_type 및 items[*].document.product_type에 같은 값을 제공한다. 신규 journal은 document에도 저장한다. 구형 journal에서 필드가 빠졌으면 응답에 접수 고정값을 보완하고 저장된 원문·receipt·cursor ID를 변경하지 않는다.

배포 전 journal을 이미 읽은 증분 클라이언트는 after=0부터 한 번 재조회하여 제품 메타데이터를 보완해야 한다. 이것은 새 수정 보고서가 아니라 동일 버전 메타데이터 보완이며 PR #6 RAG의 missing/unknown 업그레이드 규칙을 사용한다. 이미 알려진 유형이나 원문을 바꿀 때는 PR #6대로 새 확정 revision이 필요하다. 실제 검색 준비 완료 후 기존 receipt를 기록한다. 과거 동기화 상태만으로 새 제품 필터 색인이 완료됐다고 판단하지 않는다. 현재 RAG의 기본 전체 목록 polling도 다음 조회에서 최상위 필드를 읽는다.

## 계약·검증·실행

Swagger /v3/api-docs의 ProductType, Product/Repair, ConfirmedCase, RagChange/RagDocument를 갱신했다. HTTP 경로 수는76개로 유지한다. Kafka schema/examples는 backend/docs와 공유 contract에 일치시켰다.

```bash
cd backend
python3 scripts/generate_openapi.py
python3 scripts/generate_kafka_contract.py --sync-shared
DOCKER_HOST=unix://$HOME/.docker/run/docker.sock ./gradlew test bootJar
python3 -m unittest discover -s scripts -p 'test_*.py'
```

V2ServiceTests의8개 제품·접수 출처 조합이 실제 DB 저장 → 진단 명령 → 추가 사진/재개 → 자동 재시도 → 수동 Outbox 재처리 → 내부 확정 API → RAG 증분을 검증한다. 중간에 모델 분류를 바꿔도 값이 유지되는지 확인한다. ProductTypesTests는 미지원/누락/별칭을, ProductTypeMigrationTests는 스냅샷 우선 이관·새 모델 기본값·기존 발행 JSON 불변을 검증한다. SchemaMigrationTests는 V9와 schema.sql 일치도 검사한다.

scripts/test_product_type_handoff.py는 실제 worker.products 함수를 실행하고 RAG ProductType Literal과 Swagger/Kafka enum의 일치를 확인한다. 실제 Agent·MCP·Qdrant 통합 실행 또는 검색 품질 검증은 하지 않았다. RAG Python 실행 환경이 없어 RAG runtime 테스트는 실행하지 않았으며 정적 계약 확인과 백엔드 전달 테스트를 구분한다. 커밋·push·배포는 하지 않았다.

최종 실제 결과: Java90개 실패·오류·생략0, Python7개 통과, test/bootJar BUILD SUCCESSFUL(55s). 결과는 build/test-results/test 및 build/reports/tests/test/index.html에 있다.
