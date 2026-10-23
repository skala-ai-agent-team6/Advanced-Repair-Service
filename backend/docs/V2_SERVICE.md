# V2 백엔드 실행·연동 안내

2026-10-23. Java 21 / Spring Boot 4.1.1 / 기존 세션·CSRF / PostgreSQL / 로컬 원본 파일 / Kafka v2·Outbox·SSE를 유지했다. 브랜치 backend/feat/v2-service-expansion. 최초 작업 트리는 깨끗했고 기존 V6(Agent 처리 추적), V7(사진 품질)을 변경하지 않았다. 신규 스키마는 V8__service_expansion.sql이다. 프런트·Agent·RAG 실행 코드는 덮어쓰지 않았다.

## 요구사항 대조

| 범위 | 시작 시 상태 | 이번 구현 |
|---|---|---|
| 직원 인증·센터 접근·Kafka·Outbox·SSE | 충족 | 출장 명시 배정 접근과 별도 운영 capability 확장 |
| 사진 품질 | 충족 | 기존 계산·조회·SSE·최신 WARNING 확인을 소비자 접수에도 재사용, V7 번호 문서 정정 |
| 소비자 접수·조회 자격 | 신규 | 기존 repair_case/attachment 사용, 출처·고객 연락 데이터 분리, 해시 키·만료·요청 제한 |
| 구매일·보증 | 신규 | 모델별 불변 정책·판정 스냅샷·정책 미확인 |
| 센터/출장·방문 준비 | 일부 | 서비스 유형, 본사 배정/재배정 이력, 통합 기사용 조회, 미확인 연락처/주소 표시 |
| 고객 리포트 | 신규 | 별도 DTO·초안/공개/이전 버전, 예상/확정 출처 구분 |
| 실제 수리·통계 | 대부분 충족 | 실제 원인·조치 서비스 검증, 0~20 교체 부품 이력, 최신 확정 통계 재사용 |
| RAG | 기존 전체 목록 polling | 비식별 전체 목록 호환 유지, commit 순서 증분 journal·고정 window·결과 receipt·adapter/mock |
| 편집자 AI | 상세 계약 없음 | 원본/제안/수락 초안·반려·대상 버전·작성 주체 이력 |
| Kafka 검증·재처리 | 일부 | 출력 검증, bounded Outbox, 독립 운영 권한과 원래 이벤트 연결 수동 시도 |
| 실제 제조사 보증·Vue·AI/RAG 통합 | 외부/미정 | 팀별 인계 문서와 검증 목표 명시, 실제 성공 기록 안 함 |

제품 모델에 appliance_type을 추가했다. 초기 값은 VACUUM_CLEANER이며 초기 검증은 청소기이며 PR #6 제품 유형별 RAG 전달은 [PRODUCT_TYPE.md](PRODUCT_TYPE.md)를 따른다. 다른 가전용 모델을 새로 만들지 않았다. 새 도구 실행 agentType은 PCB/SURFACE/BUSINESS/RAG다. 과거 MOTOR/SW DB 기록과 MOTOR 촬영 부위는 유지한다. 모터 단독 성능·독립 SW 분석 MCP는 신규로 호출하지 않는다.

## 실행과 설정

backend에서 기존 .env의 DB/Kafka/파일 경로/서비스 토큰을 준비한다. 실제 비밀값을 저장소나 출력 로그에 넣지 않는다.

```bash
set -a
source .env
set +a
./gradlew bootRun --args='--spring.profiles.active=dev'
```

Swagger: http://localhost:8080/swagger-ui.html, JSON: /v3/api-docs. 공개 소비자 API는 직원 로그인 없이 호출한다. 직원 쓰기는 기존 CSRF, 내부 연동은 기존 SERVICE Bearer 인증이다.

| 설정 | 기본값 | 설명 |
|---|---|---|
| PHOTO_QUALITY_ENABLED | true | 신규 사진 검사·서버 gate; 비활성화 시 기존 우회 정책 |
| CONSUMER_KEY_DAYS | 90 | 조회 키 유효기간, 1~365일 |
| CONSUMER_RATE_PER_MINUTE | 30 | 서버 인스턴스별 실제 remote IP당 공개 요청/분 |
| WARRANTY_ALLOW_DEVELOPMENT | false | true일 때만 DEMO 정책 적용 |
| RAG_SYNC_ENABLED | false | 증분 조회/receipt 활성화. 활성화만으로 성공하지 않음 |
| DIAGNOSIS_AUTO_RETRY | false | 일시적 실패 코드만 자동 재진단 허용 |
| app.outbox.max-attempts | 8 | 자동 발행 상한; 초과 시 terminal_failure |
| app.operations.max-manual-attempts | 3 | 원래 이벤트당 수동 시도 상한 |

개발 프로필은 기존 dev 비밀번호 설정을 사용하며 field-tech(센터2 TECHNICIAN), ops(센터1 TECHNICIAN + operations_enabled)를 추가한다. SEED-2는 출장·field-tech 배정, 기존 SEED 접수에는 개발용 구매일이 들어간다. DEMO-ONLY-12M은 가상 12개월 정책이며 기본으로 판정에 적용되지 않는다. 삼성/제조사의 실제 정책을 뜻하지 않는다. 소비자 CENTER/FIELD 예제는 docs/examples/v2-consumer-*.json이다. files에는 실제 JPEG/PNG를 함께 보내야 하며 사진 없는 접수는 완료되지 않는다. 자동 테스트에서도 양쪽 소비자 접수와 보증·배정 데이터를 생성한다.

개발 서버에 실제 가상 접수2건을 생성하려면 `python3 scripts/demo_v2_consumer.py --photo /절대경로/정상사진.jpg`를 명시적으로 실행한다. 이 스크립트는 이번 작업에서 실제 실행하지 않았다. 조회 키는 기본 `.local/v2-consumer-keys.json`에0600 권한으로 저장하고 터미널에 출력하지 않는다. 같은 출력 파일을 덮어쓰지 않는다.

## 소비자 조회 자격·개인정보

POST /public/cases는 필수 증상·구매일·시리얼·모델·센터·유형·사진을 검증한다. 알려진 제품은 모델과 일치해야 하고 신규 시리얼은 등록된 모델에만 연결한다. 접수번호는 비밀값이 아니다. 직원 메모 대신 symptom에 소비자가 입력한 증상을 두고 연락처·이름·주소는 consumer_access에 분리한다. 현재 화면/DTO에 정확한 필수 연락 항목이 없으므로 선택 입력이다. FIELD의 미확인 항목은 기사용 preparation.missing에 표시한다. 방문 예약/지도/본인 인증/발송은 추가하지 않았다.

응답의 lookupKey는 SecureRandom 32바이트 Base64url(43자)이며 SHA-256 해시만 저장한다. key와 접수번호를 함께 가진 요청에 한해 조회·사진 접근을 허용한다. `Authorization: Bearer <lookupKey>`로 전달하며 URL/query에 넣지 않는다. 만료는 서버 발급 시각 기준 90일(설정 가능). 발급 응답은 한 번만 제공하고 비밀값을 audit/log에 남기지 않는다. 알 수 없는 접수·키 불일치·만료·다른 첨부는 동일 404다.

익명 재발급/연장은 지원하지 않는 것이 현재 정책이다. 유실·만료 시 센터의 기존 직원 업무로 안내한다. SMS·이메일 또는 외부 본인확인 계약 없이 제3자에게 키를 재발급하거나 발송하지 않는다. 보관·파기 기간과 실제 본인 확인 후 재발급 절차는 운영 계약 결정 사항이다.

공개 요청량은 분 단위·인스턴스별 제한이며 IP bucket 최대 10,000개로 메모리를 제한한다. X-Forwarded-For는 신뢰하지 않는다. 다중 서버·프록시 환경의 전역 제한/실제 클라이언트 IP 처리는 ingress에서 합의해야 한다. 기존 파일당10MiB/요청50MiB와 최대10장, 접수별 초기 재촬영 포함20장 제한을 적용한다. 소비자 업로드는 서버가 인증된 접수에만 연결하고 requestId/다른 caseId를 받지 않는다. 진단 시작 후에는 기사 추가 사진 흐름으로 인계한다.

## 보증 판정

모델별 정책은 QUALITY_MANAGER가 등록하며 version은 변경하지 않는다. 구매일이 effective_from 이상, effective_to 미만인 정책 중 effective_from이 가장 최신인 정책을 적용한다. 같은 모델/시작일의 중복 등록은 거부한다. 정책 변경은 새 version/시작일로 등록하고 과거 판정은 유지한다. 개발 정책은 별도 opt-in이다.

기준일은 Asia/Seoul의 판정일. 만료 경계는 purchase_date.plusMonths(duration_months)이며 [구매일, 만료일)로 계산한다. 말일은 Java LocalDate.plusMonths 보정 규칙이다. 구매일·정책 ID/버전·판정일·만료 경계·결과·이유를 매번 저장한다. 미등록/누락은 UNKNOWN, 미래/잘못된 날짜는 입력 오류다. WITHIN_PERIOD는 무상 수리 확정이 아니다. 실제 제조사 정책(구매 증빙·품목·소모품·면책 등)은 별도 확인해야 한다.

## 기사/고객/편집 흐름

GET /api/repairs/{id}/work-report는 제품·증상·최신 task/input_revision·후보/근거/점검법·부품 호환/재고·조달·보증·본사 코멘트·실제 리포트 버전·출장 준비를 통합한다. 없는 보증/재고는 UNKNOWN이다. AI 진단 종료 후 조달은 기존 Spring procurement worker가 담당한다. 승인 때문에 Agent를 계속 실행하지 않는다.

소비자 접수는 기능 비활성화 때에도 자동 Agent 실행을 하지 않는다. 기사가 명시적으로 attachmentIds를 보내 진단을 시작한다. 소비자는 WARNING을 확인할 수 없다. 검사 PENDING/RUNNING/ERROR는 보류, PASS 또는 현재 기사가 최신 WARNING을 확인한 사진만 포함한다. 교체/재검사 시 이전 확인은 재사용하지 않는다. Agent 추가 사진 3회와 품질 재촬영은 별도다. 화면 계약은 PHOTO_QUALITY.md 및 V2_CONTRACTS.md 참조.

고객 리포트는 기사 DTO를 반환하지 않는다. causeSummary/plannedWork와 ESTIMATE/CONFIRMED, version/status를 별도 저장한다. 초안 작성과 publish는 별도 API다. CONFIRMED는 현재 확정 sourceRevision이 필요하다. 미공개 초안·AI 편집 제안은 고객 조회에 나타나지 않는다. 고객 응답은 접수번호·공개 진행 상태·보증·공개 리포트·본인 사진 상태만 반환한다. 내부 코멘트·도구 출력·고객 연락처·공장 정보는 반환하지 않는다.

실제 보고서는 원인·조치가 필수이며 교체 부품은 빈 목록을 허용한다. 확정 시 RAG journal을 로컬 DB에 기록한다. 외부 RAG 연결 실패가 저장/확정을 롤백하지 않는다. 최신 confirmed_revision만 대시보드에서 집계하고 새 초안·AI 추정은 집계하지 않는다. 본사 코멘트는 별도 테이블로 유지한다.

편집 제안은 SERVICE가 targetRevision/proposed를 저장하고 기사가 수락/반려한다. 원본 보고서 content·제안·accepted_revision과 작성 서비스·결정자를 기록한다. 수락은 새 기사 초안이며 확정·고객 공개·통계를 자동 갱신하지 않는다. 실제 AI 원본은 기존 diagnosis_job.result와 repair_report.diagnosis_job_id로 추적한다. 오래된 버전 수락은409다. 모델/프롬프트/호출·timeout·비용 계약은 미정이므로 외부 AI를 호출하지 않는다.

## DB·권한·검증

[V2_ERD.md](V2_ERD.md), [V2_CONTRACTS.md](V2_CONTRACTS.md), [V2_VERIFICATION.md](V2_VERIFICATION.md)를 참고한다. V8은 신규10테이블과 기존 테이블 확장이다. 운영 DB에는 이번 작업 중 마이그레이션을 실행하지 않았고 독립 Testcontainers에서만 검증한다. 기존 데이터는 STAFF/CENTER로 유지하며 구매일은 기존 업무에서 확인 전까지 null이다.

| 주체 | 접근 |
|---|---|
| 소비자 | 조회 키가 유효한 본인 접수의 고객 공개 정보·사진. 직원 API·WARNING 확인 불가 |
| TECHNICIAN | 소속 센터 또는 명시 배정된 FIELD 접수. 리포트/품질 확인/공개본 작성·공개 |
| QUALITY_MANAGER | 기존 전체 조회·코멘트·발주 승인 + 기사 배정·정책 등록. 운영 재처리 권한은 자동 부여하지 않음 |
| operations_enabled=true 직원 | 실패 조회·명시적 수동 재처리. dev ops 외 운영 부여는 관리 절차에서 명시적 DB 변경 필요 |
| SERVICE | 기존 /internal/** + RAG 증분/receipt·편집 제안 입력 |

프런트 개발, 실제 보증 정책 확인, 본인확인/키 재발급 계약, Agent SURFACE·엄격 출력 반영, RAG의 실제 index/searchReady 연동은 외부 팀 인계 항목이다. 10건 각각120초 내 검색 반영은 실제 RAG 연결 후 검증 목표이며 달성을 주장하지 않는다. TC-01~TC-10 원문은 제공된 저장소·첨부 텍스트에서 찾지 못했으므로 검증 문서 대응표는 요구사항에 근거한 임시 매핑이다.
