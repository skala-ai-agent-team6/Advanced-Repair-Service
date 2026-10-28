# Backend 작업 지침

- 아키텍처 근거와 상세 규칙은 `docs/ARCHITECTURE.md`를 따른다.
- 단일 Spring Boot/Gradle 모듈과 SQL 중심 저장 구조를 유지한다. 업무 코드는 casework/consumer/diagnosis/photoquality/report/inventory/fieldservice/warranty 등 해당 패키지에 모으고 repair 루트에 추가하지 않는다.
- 관련 컨트롤러·서비스·저장소·작업자는 같은 업무 패키지에 둔다. 여러 업무의 기존 통합 진입점은 api, 공통 입력은 api.dto에 둔다. 작은 업무에 계층별 하위 폴더를 반복해서 만들지 않는다.
- 패키지 경계를 넘기 위해 엔티티 필드나 내부 상태를 public으로 열지 않는다. 실제 호출되는 서비스 연산과 읽기 접근자만 공개한다.
- 재고 잔액 변경은 `repair.inventory.InventoryService`를 사용한다. 업무 서비스에 재고 증감 SQL을 추가하지 않는다.
- 최초 진단 생성은 `DiagnosisStartService`, 명령 Outbox 작성은 `DiagnosisCommands`를 사용한다.
- 권한/센터/배정 검증과 사진 선택 정책은 각 업무 진입 서비스에 둔다. 자동 처리와 사람의 확인을 감사 기록에서 구분한다.
- GET에서 예약 만료나 보증 판정 이력을 기록하지 않는다.
- 업무 상태 변경과 Outbox를 같은 트랜잭션으로 처리하고 외부 호출은 DB 트랜잭션 밖에서 수행한다.
- 이벤트 중복 방지, 입력 revision/execution 검증, 보고서 이력, DB 제약과 잠금을 보존한다.
- 적용된 Flyway 파일을 수정하지 않는다. 공개 API/Kafka 계약 변경 시 문서와 계약 테스트를 함께 갱신한다.
- 수정한 경로의 테스트를 실행한다. 정합성/트랜잭션/공통 서비스 변경은 `./gradlew test bootJar`로 전체 검증한다.
- 실제 외부 서비스 통합 결과와 Testcontainers/mock 검증 결과를 구분해 보고한다.
