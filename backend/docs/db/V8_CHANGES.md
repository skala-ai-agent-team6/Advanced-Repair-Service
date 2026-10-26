# V8 서비스 확장

V1~V7을 수정하지 않고 V8__service_expansion.sql 추가. 신규10테이블과 기존 확장 목록은 [V2_ERD.md](../V2_ERD.md), 접근 권한은 [V2_SERVICE.md](../V2_SERVICE.md)를 참고한다. docs/db/schema.sql에도 동일 SQL을 반영했고 Flyway와 컬럼·제약·인덱스 parity 테스트를 통과했다.

기존 자료는 STAFF/CENTER, 운영 권한 false, purchase_date null 기본값을 유지한다. 소비자 접수의 technician_id/uploader_id는 직원 확인 전 null을 허용한다. 실제 조회 키 원문은 DB에 저장하지 않는다. 과거 보고서 revision은 변경하지 않으며 새 RAG 증분 조회 때 확정 자료를 최대500건씩 bootstrap한다. 기존 품질 마이그레이션은 V7, Agent 처리 추적은 V6다.

운영 DB에 이번 작업 중 V8을 적용하지 않았다. 운영 배포 시 백업·환경 설정을 준비한 뒤 기존 Flyway 기동 절차로 적용한다. 새 테이블/컬럼을 임의 DROP하는 롤백 SQL을 제공하지 않는다. 보증/동기화 정책은 실행 문서의 명시적 설정을 사용한다.
