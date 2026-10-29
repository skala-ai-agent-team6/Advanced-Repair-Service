# Backend 아키텍처와 개발 규칙

2026-10-28. 단일 Gradle 모듈·Spring Boot·PostgreSQL을 유지한다. 현재 규모에서는
배포 단위를 늘리기보다 업무 규칙과 데이터 변경 책임을 명확히 하는 편이 유리하다.
팀 규모·운영 트래픽·장애 이력은 코드만으로 확인되지 않았으며, 독립 확장 필요성은 추정하지 않는다.

## 패키지 구조

`com.skala.backend.repair` 바로 아래에는 업무 Java 파일을 두지 않는다. 관련 컨트롤러·서비스·Repository·작업자는 같은 업무 패키지에 모은다.
여러 업무를 연결하는 기존 통합 컨트롤러와 공통 입력 DTO는 api에 유지한다.

```text
com.skala.backend
├── BackendApplication
├── docs                     # Swagger 제공
└── repair
    ├── api                  # 기존 통합·내부 API 진입점
    │   └── dto              # Inputs, V2Inputs
    ├── casework             # 접수·수리 건·조회·고객 공개 보고서 관리
    ├── consumer             # 소비자 API·자동 처리·rate limit·자동 진단 정책
    ├── diagnosis            # 진단 생성·명령·이벤트·Kafka 발행/수신·SSE
    ├── photoquality         # 사진 API·검사기·정책·작업자·저장소
    ├── report               # 기사 보고서·편집·통계·확정 사례 RAG 동기화
    ├── inventory            # 재고·발주·예약 만료·조달 작업자
    ├── fieldservice         # 출장 API·일정·방문 준비·출장 예약 흐름
    ├── warranty             # 보증 정책·판정
    ├── catalog              # 제품·부품 조회 및 제품 유형
    ├── security             # 사용자·인증·업무 접근 범위
    ├── storage              # 첨부 파일 저장·유형 검사
    ├── operations           # 운영 재처리
    ├── integration/mcp      # 업무 MCP 계약·HTTP 구현·개발용 구현
    ├── bootstrap            # 개발 데이터 초기화
    └── shared               # DB 지원·JSON·오류·응답 ID 변환
```

사진 검사 구현과 API를 photoquality에 함께 배치했다. 테스트도 photoquality·catalog의 업무 테스트와
integration의 DB/HTTP/Kafka 종합 테스트로 구분했다. 패키지 이동을 위해 사용자 엔티티 필드를 public으로 열지 않고
읽기 접근자를 추가했다. Outbox 재시도 상한도 변경 가능한 필드 대신 생성자 설정으로 전달한다.

Messaging.java 및 BusinessMcp.java, ApiError.java에 함께 선언돼 있던 최상위 클래스는 각각의 이름을 가진 파일로 분리했다.
Spring 내부 설정·수신 작업자는 가능한 package-private로 유지한다. 패키지 간 실제로 호출하는 업무 연산은 명시적인 public 진입점으로 둔다.
이 구조는 코드 탐색과 책임 구분을 위한 것이며, 별도 배포 모듈이나 완전히 독립된 도메인 경계를 의미하지 않는다.

## 현재 적용한 경계

| 책임 | 구현 | 경계 |
|---|---|---|
| 기사 접수·권한·선택 검증 | RepairService | 기존 HTTP 계약과 오류 코드를 유지 |
| 고객 자동 처리·배정·선택 정책 | ConsumerPipeline / ConsumerDiagnosisPolicy | 자동 처리 허용과 경고 사진 허용을 각각 설정 |
| 최초 진단 생성 | DiagnosisStartService | 기존 업무 트랜잭션 필수. 사진 고정·상태 변경·명령·UI 이벤트를 함께 저장 |
| 진단 명령 작성 | DiagnosisCommands | v2 Kafka 계약 유지. 명령 저장 시 기존 트랜잭션 필수 |
| 공통 재고 잔액 | inventory.InventoryService | 발주와 출장 예약이 같은 예약·취소·출고 연산을 사용 |
| 재고 SQL·행 잠금 | inventory.InventoryRepository | 수량 조건부 갱신과 version 증가 |
| 예약 만료 | inventory.ReservationExpiryService | 30초 주기 및 재고 변경 전 실행. GET에서는 실행하지 않음 |
| 보증 제안 | WarrantyService.preview / FieldService.warranty | 조회는 현재 정책을 계산하되 판정 이력을 추가하지 않음 |
| 보증 판정 기록 | WarrantyService.record / FieldService.decide | 접수·명시적 재평가·기사 결정 시 기록 |
| Kafka 발행 | OutboxPublisher | 한 주기 최대 10건, 발행 직전 한 건씩 확보. 시도 번호와 lease로 늦은 완료 갱신 차단 |

재고 모듈은 다른 업무 서비스를 참조하지 않는다. 기존 Store/ApiError/Json은 당분간 공통 지원 코드로 사용한다.
새로운 재고 증감 SQL은 InventoryRepository에 작성한다. 기존 발주·출장 테이블의 업무 상태와 감사 이력은 각 업무 서비스가 관리한다.
진단은 사진 선택·권한의 진입 정책은 분리하고 실제 최초 생성 연산은 공유한다. 재개와 실패 후 재시도는
새 최초 진단과 의미가 다르므로 기존 입력 revision·execution·사진 요청 예산 보존 로직을 유지한다.

### 자동 처리 정책

- `app.consumer.auto-pipeline`: 자동 처리 자체의 활성화. 기본 false, dev는 true.
- `app.consumer.allow-warning-photos`: 최초 자동 진단에서 WARNING 사진 사용. 기본 false, dev는 기존 시연 동작 보존을 위해 true.
- 경고 허용 시 기존 사진 확인 레코드의 기사 귀속은 유지하되 `CONSUMER_WARNING_POLICY_APPLIED` 감사 이벤트에
  실제 자동 처리 주체(`consumer-pipeline`), 정책, 귀속 기사 ID를 함께 남긴다. 실제 사람이 확인했다는 증거로 해석하지 않는다.
- 추가 사진을 받아 재개할 때는 기존대로 PASS만 선택한다. ERROR·미완료 사진은 자동 사용하지 않는다.
- dev 설정을 운영 정책으로 사용하지 않는다. 운영에서 예외를 활성화하려면 정책 근거와 감사 의미를 먼저 정의한다.

### 조회와 명령

예약 만료·보증 이력 추가를 GET 부수 효과에서 분리했다. 예약 만료는 정상 스케줄링 상태에서 다음 실행까지 지연될 수 있다.
재고 변경 명령은 만료 처리를 먼저 수행하므로 조회하지 않아도 만료분을 회수한다.
스케줄링을 끈 환경에서는 명시적으로 expireDue를 호출해야 한다.
보증 조회는 저장된 판정이 없거나 UNKNOWN이면 현재 정책을 미리 계산한다. 명시적 기사 결정은 판정 이력을 저장한다.

## 개발 규칙

1. 컨트롤러는 HTTP 입력·응답 변환을 담당한다. 권한·센터/배정 범위 검증은 업무 서비스에서 수행한다.
2. 트랜잭션은 업무 명령 단위로 연다. 사진 고정·작업 생성·Outbox는 같은 트랜잭션에 둔다.
   공통 변경 서비스의 MANDATORY 조건을 유지한다. 내부 메서드 호출로 새 트랜잭션이 생긴다고 가정하지 않는다.
3. MCP 등 외부 네트워크 호출 중 DB 트랜잭션을 유지하지 않는다. 확보→외부 호출→상태 재검증·반영으로 나눈다.
4. 상태 변경에는 허용 이전 상태·실행 주체·중복 요청 결과를 정의한다. 중요한 상태는 enum/record를 우선한다.
   DB CHECK 제약은 유지한다. version 컬럼이 있다는 이유만으로 낙관적 잠금이 적용됐다고 가정하지 않는다.
5. 여러 재고 행은 warehouse_id, part_id 순서로 확보한다. 예약/발주 행을 먼저 잠그고 재고를 변경한다.
   새로운 흐름은 관련 경로와 함께 잠금 순서를 검토하고 경쟁 테스트로 검증한다.
6. 동일 요청 키의 동일 입력은 같은 업무 효과를 반환하고 다른 입력은 충돌시킨다.
   Kafka 수신은 eventId 중복 및 executionId/inputRevision/sequence의 오래된 이벤트를 구분한다.
7. Outbox는 적어도 한 번 전달로 취급한다. Kafka 성공과 DB 기록 사이 종료에 따른 재발행 가능성은 남아 있다.
   생산자 멱등성만으로 전체 업무가 정확히 한 번 실행된다고 주장하지 않는다. 소비자 중복 방지를 유지한다.
8. 공개 응답·고정 메시지 계약은 record DTO로 점진적으로 전환한다. AI/도구 원문 등 가변 데이터만 Map/JSON을 허용한다.
   기존 DTO 전환 시 JSON 필드명·숫자/문자열 ID·null·배열 순서를 회귀 검증한다.
9. 기존 적용 Flyway 파일을 수정하지 않는다. 후속 파일을 추가하고 schema.sql·마이그레이션 테스트를 함께 갱신한다.
10. 신규·수정 코드는 한 문장 한 줄, 명시적 import와 생성자 주입을 사용한다. 무관한 전체 포맷 변경은 분리한다.
11. 테스트는 권한·상태 전이·정합성·중복·장애 복구를 우선한다. Repository/잠금은 PostgreSQL 통합 테스트로 검증한다.
12. 계약 변경 시 docs/openapi.json과 Kafka 계약 및 관련 생성 스크립트/검증을 함께 확인한다.
    실제 외부 Agent/MCP/RAG와의 통합 성공은 mock/Testcontainers 결과와 구분한다.

## 장점과 비용

- 단일 배포와 SQL 유지: 기존 정합성·운영 방식을 보존한다. 업무별 경계는 코드 리뷰와 테스트로 계속 관리해야 한다.
- 공통 변경 서비스: 경로별 규칙 차이를 줄인다. 서비스 호출과 작은 파일 수는 늘어난다.
- 선택적 DTO/Repository: 변경 안정성을 높인다. 일괄 전환보다 과도기적 혼합 구조가 남는다.
- 한 건씩 Outbox 확보: 대기 중 lease 만료를 줄인다. 배치 확보보다 DB 왕복 횟수가 늘어난다.
- 독립 예약 만료: GET이 이력을 변경하지 않는다. 주기 실행 지연과 작업 상태를 관찰해야 한다.

## 이후 변경 기준

업무별 패키지 배치를 유지하고, 새 기능의 컨트롤러·서비스·저장소는 해당 업무 패키지에 추가한다.
현재 규모에서는 업무 패키지마다 controller/service/repository 하위 폴더를 반복해서 만들지 않는다.
이후 진단·보고서 SQL을 해당 업무 Repository로 옮기고 고정 API 응답부터 DTO를 추가한다. 모든 서비스에 인터페이스를 만들지는 않는다.
마이크로서비스·별도 조회 DB·이벤트 소싱·전면 JPA 전환은 독립 팀/배포/부하 요구가 확인될 때 재검토한다.
다중 인스턴스 운영 전 파일 공유·세션 저장·분산 rate limit을 결정한다. SSE는 DB 재생 구조와 실제 부하를 먼저 측정한다.
ProcurementWorker의 만료 작업 fencing과 운영 지표(Outbox 대기 시간·DLT·만료 작업 수)는 별도 후속 개선 대상이다.

## 이번 변경 검증

2026-10-28 Asia/Seoul, `./gradlew test bootJar` 성공. JUnit 결과 98개, 실패 0·오류 0·생략 0.
추가한 8개 테스트는 다음을 검증한다.

- 발주·출장 예약의 공통 잔액 및 재고 부족 시 발주 상태 롤백
- 발주 승인과 출장 예약의 동시 경쟁에서 초과 예약 방지
- 조회가 예약을 만료시키지 않으며 명시적 만료는 중복 실행되어도 한 번만 반영
- 외부 업무 트랜잭션 없는 재고 변경 거절
- Outbox 이전 시도의 늦은 성공/실패가 복구된 시도의 상태를 덮어쓰지 않음
- Outbox 다음 항목을 실제 전송 직전에 확보
- 경고 사진 정책의 명시적 분기, 자동 진단 입력 고정·중복 방지·자동 처리 감사
- 보증 조회는 새 정책을 계산해도 이력을 쓰지 않으며 명시적 결정에서 기록

기존 PostgreSQL/Kafka Testcontainers, HTTP 권한·계약, 보고서·진단·품질·마이그레이션 회귀 테스트도 함께 실행했다.
실제 외부 AI/MCP/RAG 연결, 운영 배포, 장기 부하 및 프로세스 강제 종료 검증은 수행하지 않았다.
테스트 결과는 `build/reports/tests/test/index.html`, JAR은 `build/libs/backend-0.0.1-SNAPSHOT.jar`에 생성된다.
